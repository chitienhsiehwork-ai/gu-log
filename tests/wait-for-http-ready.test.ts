import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForHttpReady } from '../scripts/lib/wait-for-http-ready.mjs';

describe('waitForHttpReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a fetch that remains pending for the whole readiness deadline', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true }
        );
      });
    });
    let outcome: boolean | undefined;
    void waitForHttpReady('http://localhost:4321', {
      timeoutMs: 3_000,
      fetchImpl,
    }).then((value) => {
      outcome = value;
    });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after the endpoint becomes ready', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return Promise.resolve({ ok: true } as Response);
    });

    await expect(
      waitForHttpReady('http://localhost:4321', { timeoutMs: 3_000, fetchImpl })
    ).resolves.toBe(true);

    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a success response that settles at the exact deadline', async () => {
    vi.setSystemTime(new Date('2026-07-30T00:00:00.000Z'));
    const deadlineStart = Date.now();
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const readiness = waitForHttpReady('http://localhost:4321', {
      timeoutMs: 50,
      fetchImpl,
    });

    await Promise.resolve();
    vi.setSystemTime(deadlineStart + 50);
    resolveFetch({ ok: true } as Response);

    await expect(readiness).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reset the overall deadline when a retry remains pending', async () => {
    let secondSignal: AbortSignal | undefined;
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => {
        secondSignal = init?.signal;
        return new Promise<Response>(() => {});
      });
    let outcome: boolean | undefined;
    void waitForHttpReady('http://localhost:4321', {
      timeoutMs: 3_000,
      pollIntervalMs: 500,
      fetchImpl,
    }).then((value) => {
      outcome = value;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe(false);
    expect(secondSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a transient failure and returns ready before the deadline', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce({ ok: true } as Response);
    const readiness = waitForHttpReady('http://localhost:4321', {
      timeoutMs: 3_000,
      pollIntervalMs: 500,
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(500);

    await expect(readiness).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
