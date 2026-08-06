import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

function installBrowserStubs() {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
}

function installNeverSettlingFetch() {
  const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
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
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function installStalledBodyFetch() {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => {}),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function expectBoundedTimeout(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<unknown> {
  let outcome: { state: 'fulfilled' } | { state: 'rejected'; error: unknown } | undefined;
  void promise.then(
    () => {
      outcome = { state: 'fulfilled' };
    },
    (error: unknown) => {
      outcome = { state: 'rejected', error };
    }
  );

  await vi.advanceTimersByTimeAsync(timeoutMs);

  expect(outcome).toMatchObject({
    state: 'rejected',
    error: {
      name: 'ReaderSyncApiError',
      code: 'READER_SYNC_TIMEOUT',
      message: '同步逾時，請檢查網路後重試',
    },
  });
  expect(vi.getTimerCount()).toBe(0);
  return outcome && outcome.state === 'rejected' ? outcome.error : undefined;
}

describe('reader sync request deadline', () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    installBrowserStubs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a stalled backend reader-sync request with a typed timeout', async () => {
    storage.set('gu-log-jwt', 'header.payload.sig');
    const fetchMock = installNeverSettlingFetch();
    const module = await import('../src/lib/gist-sync');

    const error = await expectBoundedTimeout(
      module.pullFromReaderSyncApi('https://api.shroomdog.dev'),
      module.READER_SYNC_TIMEOUT_MS
    );

    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('aborts a stalled legacy GitHub Gist request with the same typed timeout', async () => {
    storage.set('gu-log-gist-id', 'cached-id');
    const fetchMock = installNeverSettlingFetch();
    const module = await import('../src/lib/gist-sync');

    const error = await expectBoundedTimeout(
      module.findOrCreateGist('github-token'),
      module.READER_SYNC_TIMEOUT_MS
    );

    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(storage.get('gu-log-gist-id')).toBe('cached-id');
  });

  it('bounds a stalled backend response body, not only response headers', async () => {
    storage.set('gu-log-jwt', 'header.payload.sig');
    const fetchMock = installStalledBodyFetch();
    const module = await import('../src/lib/gist-sync');

    const error = await expectBoundedTimeout(
      module.pullFromReaderSyncApi('https://api.shroomdog.dev'),
      module.READER_SYNC_TIMEOUT_MS
    );

    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('bounds a stalled GitHub Gist response body across the whole operation', async () => {
    const fetchMock = installStalledBodyFetch();
    const module = await import('../src/lib/gist-sync');

    const error = await expectBoundedTimeout(
      module.findOrCreateGist('github-token'),
      module.READER_SYNC_TIMEOUT_MS
    );

    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('shares one deadline across sequential GitHub Gist requests', async () => {
    storage.set('gu-log-gist-id', 'cached-id');
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: true, status: 200 }), 10_000);
          })
      )
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
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
    vi.stubGlobal('fetch', fetchMock);
    const module = await import('../src/lib/gist-sync');
    let outcome: { state: 'fulfilled' } | { state: 'rejected'; error: unknown } | undefined;
    void module.pushToGist('github-token', []).then(
      () => {
        outcome = { state: 'fulfilled' };
      },
      (error: unknown) => {
        outcome = { state: 'rejected', error };
      }
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondSignal = fetchMock.mock.calls[1][1]?.signal;

    await vi.advanceTimersByTimeAsync(module.READER_SYNC_TIMEOUT_MS - 10_001);
    expect(outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({
      state: 'rejected',
      error: {
        name: 'ReaderSyncApiError',
        code: 'READER_SYNC_TIMEOUT',
      },
    });
    expect(secondSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after a successful request', async () => {
    storage.set('gu-log-jwt', 'header.payload.sig');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ store: null }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const module = await import('../src/lib/gist-sync');

    await expect(module.pullFromReaderSyncApi('https://api.shroomdog.dev')).resolves.toBeNull();

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });

  it('preserves a non-timeout network error and clears the deadline', async () => {
    storage.set('gu-log-jwt', 'header.payload.sig');
    const networkError = new TypeError('Network request failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    const module = await import('../src/lib/gist-sync');

    await expect(module.pullFromReaderSyncApi('https://api.shroomdog.dev')).rejects.toBe(
      networkError
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
