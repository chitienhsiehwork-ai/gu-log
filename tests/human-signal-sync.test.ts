/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemStorage {
  private store: Record<string, string> = {};
  getItem(k: string) {
    return this.store[k] ?? null;
  }
  setItem(k: string, v: string) {
    this.store[k] = v;
  }
  removeItem(k: string) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

(globalThis as any).localStorage = new MemStorage();

const API = 'https://api.example.test';
const snapshot = {
  postId: 'gp-1.mdx',
  lang: 'zh-tw' as const,
  pathname: '/posts/gp-1/',
  postVersion: 1,
  readerRevision: '0123456789abcdef',
};

async function load() {
  const signals = await import('../src/lib/human-signals');
  const sync = await import('../src/lib/human-signal-sync');
  return { ...signals, ...sync };
}

function recordMany(
  record: (s: typeof snapshot, c: { source: 'first_party' }) => { eventId: string },
  count: number
) {
  return Array.from({ length: count }, () => record(snapshot, { source: 'first_party' }).eventId);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  (globalThis as any).localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('human signal sync', () => {
  it('does not send anything when signed out', async () => {
    const { recordFeedbackComment, syncHumanSignalBatch, getPendingHumanSignalEvents } =
      await load();
    recordFeedbackComment(snapshot, { source: 'first_party', polarity: 'positive' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await syncHumanSignalBatch(API)).toEqual({ status: 'signed_out' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getPendingHumanSignalEvents()).toHaveLength(1);
  });

  it('posts one batch with the bearer token and marks accepted events synced', async () => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const { recordFeedbackComment, syncHumanSignalBatch, getHumanSignalEvents } = await load();
    const ids = recordMany(recordFeedbackComment, 3);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { events: Array<{ eventId: string }> };
      expect(body.events.map((event) => event.eventId)).toEqual(ids);
      return jsonResponse({ accepted: [ids[0]], rejected: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await syncHumanSignalBatch(API)).toEqual({
      status: 'synced',
      changed: 1,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/human-signals`);
    expect(init).toMatchObject({ method: 'POST', keepalive: false });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');

    const byId = Object.fromEntries(getHumanSignalEvents().map((event) => [event.eventId, event]));
    expect(byId[ids[0]]).toMatchObject({ syncStatus: 'synced', transport: 'gu_log_api' });
    // Neither accepted nor rejected → still pending.
    expect(byId[ids[1]]).toMatchObject({ syncStatus: 'local_only', transport: 'local_storage' });
    expect(byId[ids[2]]).toMatchObject({ syncStatus: 'local_only' });
  });

  it('marks rejected events sync_failed and never resends them', async () => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const { recordFeedbackComment, syncHumanSignalBatch, getHumanSignalEvents } = await load();
    const [rejectedId, keptId] = recordMany(recordFeedbackComment, 2);
    const sentIds: string[][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { events: Array<{ eventId: string }> };
        sentIds.push(body.events.map((event) => event.eventId));
        return jsonResponse({
          accepted: [],
          rejected: [{ eventId: rejectedId, reason: 'not_owner' }],
        });
      })
    );

    await syncHumanSignalBatch(API);
    await syncHumanSignalBatch(API);

    expect(sentIds).toEqual([[rejectedId, keptId], [keptId]]);
    expect(getHumanSignalEvents().find((event) => event.eventId === rejectedId)).toMatchObject({
      syncStatus: 'sync_failed',
    });
  });

  it('caps a batch at 50 events and keeps sending while the backend makes progress', async () => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const { recordFeedbackComment, syncPendingHumanSignals, getPendingHumanSignalEvents } =
      await load();
    recordMany(recordFeedbackComment, 60);
    const batchSizes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { events: Array<{ eventId: string }> };
        batchSizes.push(body.events.length);
        return jsonResponse({ accepted: body.events.map((event) => event.eventId), rejected: [] });
      })
    );

    expect(await syncPendingHumanSignals(API)).toEqual({ status: 'idle' });
    expect(batchSizes).toEqual([50, 10]);
    expect(getPendingHumanSignalEvents()).toEqual([]);
  });

  it('stops after one POST when the backend only echoes ids it was never sent', async () => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const { recordFeedbackComment, syncPendingHumanSignals, getPendingHumanSignalEvents } =
      await load();
    recordMany(recordFeedbackComment, 2);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ accepted: ['hs_unknown_1'], rejected: [{ eventId: 'hs_unknown_2' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await syncPendingHumanSignals(API)).toEqual({ status: 'synced', changed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getPendingHumanSignalEvents()).toHaveLength(2);
  });

  it('splits batches by body size so every request fits the keepalive cap', async () => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const {
      HUMAN_SIGNAL_SYNC_MAX_BATCH_BYTES,
      recordFeedbackComment,
      syncPendingHumanSignals,
      getPendingHumanSignalEvents,
    } = await load();
    expect(HUMAN_SIGNAL_SYNC_MAX_BATCH_BYTES).toBeLessThan(64 * 1024);
    for (let index = 0; index < 50; index += 1) {
      recordFeedbackComment(snapshot, {
        source: 'first_party',
        polarity: 'negative',
        commentText: '難'.repeat(280),
      });
    }
    const bodySizes: number[] = [];
    let total = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodySizes.push(new TextEncoder().encode(String(init.body)).length);
        const body = JSON.parse(String(init.body)) as { events: Array<{ eventId: string }> };
        total += body.events.length;
        return jsonResponse({ accepted: body.events.map((event) => event.eventId) });
      })
    );

    await syncPendingHumanSignals(API);

    expect(bodySizes.length).toBeGreaterThan(1);
    expect(Math.max(...bodySizes)).toBeLessThanOrEqual(HUMAN_SIGNAL_SYNC_MAX_BATCH_BYTES);
    expect(total).toBe(50);
    expect(getPendingHumanSignalEvents()).toEqual([]);
  });

  it('uses keepalive only when asked (the pagehide send)', async () => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const { recordFeedbackComment, syncHumanSignalBatch } = await load();
    recordFeedbackComment(snapshot, { source: 'first_party', polarity: 'positive' });
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await syncHumanSignalBatch(API, { keepalive: true });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: true });
  });

  it.each([
    ['404 (endpoint not deployed)', async () => new Response('Not Found', { status: 404 })],
    [
      'network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['non-JSON body', async () => new Response('<html>', { status: 200 })],
  ])('stays silent and keeps events pending on %s', async (_label, impl) => {
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const { recordFeedbackComment, syncPendingHumanSignals, getPendingHumanSignalEvents } =
      await load();
    recordFeedbackComment(snapshot, { source: 'first_party', polarity: 'rewrite_needed' });
    vi.stubGlobal('fetch', vi.fn(impl));

    await expect(syncPendingHumanSignals(API)).resolves.toEqual({ status: 'unavailable' });
    expect(getPendingHumanSignalEvents()).toEqual([
      expect.objectContaining({ syncStatus: 'local_only' }),
    ]);
  });

  it('gives up after the 5 second timeout and aborts the request', async () => {
    vi.useFakeTimers();
    localStorage.setItem('gu-log-jwt', 'jwt-token');
    const {
      HUMAN_SIGNAL_SYNC_TIMEOUT_MS,
      recordFeedbackComment,
      syncHumanSignalBatch,
      getPendingHumanSignalEvents,
    } = await load();
    expect(HUMAN_SIGNAL_SYNC_TIMEOUT_MS).toBe(5_000);
    recordFeedbackComment(snapshot, { source: 'first_party', polarity: 'positive' });
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            });
          })
      )
    );

    const pending = syncHumanSignalBatch(API);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ status: 'unavailable' });
    expect(aborted).toBe(true);
    expect(getPendingHumanSignalEvents()).toHaveLength(1);
  });
});
