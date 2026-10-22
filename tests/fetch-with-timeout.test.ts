import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchBytesWithTimeout } from '../scripts/lib/fetch-with-timeout.mjs';

const stalled = () => new Promise<Response>(() => undefined);
const options = { label: 'bulk response', timeoutMs: 10 };

describe('fetchBytesWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries once after a timeout and returns the fresh response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(stalled)
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const { response, wire } = await fetchBytesWithTimeout(
      'https://example.test',
      {},
      { ...options, fetchImpl }
    );

    expect(response.status).toBe(200);
    expect(wire.toString('utf8')).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/timed out after 10ms; retrying/));
  });

  it('fails closed once every attempt has timed out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(stalled);

    await expect(
      fetchBytesWithTimeout('https://example.test', {}, { ...options, fetchImpl, attempts: 3 })
    ).rejects.toThrow(/bulk response timed out after 10ms/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry failures other than a timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      fetchBytesWithTimeout('https://example.test', {}, { ...options, fetchImpl })
    ).rejects.toThrow('fetch failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
