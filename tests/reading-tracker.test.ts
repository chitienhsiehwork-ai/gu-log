/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for src/lib/reading-tracker.ts and src/lib/gist-sync.ts
 *
 * Both modules are browser-side; we set up a global localStorage stub
 * (and fetch stub for gist-sync) and exercise the public API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── localStorage stub ─────────────────────────────────────────────────────
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

beforeEach(() => {
  (globalThis as any).localStorage.clear();
  vi.resetModules();
});

// ════════════════════════════════════════════════════════════════════════════
// reading-tracker
// ════════════════════════════════════════════════════════════════════════════
describe('reading-tracker', () => {
  it('starts empty', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.getReadSlugs()).toEqual([]);
    expect(m.isRead('foo')).toBe(false);
  });

  it('markAsRead persists across reloads', async () => {
    let m = await import('../src/lib/reading-tracker');
    m.markAsRead('gp-1');
    expect(m.isRead('gp-1')).toBe(true);

    vi.resetModules();
    m = await import('../src/lib/reading-tracker');
    expect(m.isRead('gp-1')).toBe(true);
    expect(m.getReadSlugs()).toEqual(['gp-1']);
  });

  it('markAsRead is idempotent (no duplicate slugs)', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('gp-1');
    m.markAsRead('gp-1');
    expect(m.getReadSlugs()).toEqual(['gp-1']);
  });

  it('markAsUnread removes the slug', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('gp-1');
    m.markAsUnread('gp-1');
    expect(m.isRead('gp-1')).toBe(false);
  });

  it('toggleRead returns the new state', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.toggleRead('gp-1')).toBe(true);
    expect(m.toggleRead('gp-1')).toBe(false);
  });

  it('getStats reports total + slugs + lastUpdated', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('a');
    m.markAsRead('b');
    const s = m.getStats();
    expect(s.total).toBe(2);
    expect(s.slugs.sort()).toEqual(['a', 'b']);
    expect(typeof s.lastUpdated).toBe('string');
  });

  it('markAsRead stores the current reader-facing revision', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('gp-1', 'manual_mark_read', 'rev-current');

    const record = m.getReadRecords({ 'gp-1': 'rev-current' })[0];
    expect(record).toMatchObject({
      slug: 'gp-1',
      readRevision: 'rev-current',
      revisionState: 'current',
    });
    expect(typeof record.readAt).toBe('string');
  });

  it('migrates v1 slug lists as unknown revision instead of current', async () => {
    (globalThis as any).localStorage.setItem(
      'gu-log-read-articles',
      JSON.stringify({ version: 1, slugs: ['legacy-gp'], lastUpdated: '2026-04-01T00:00:00.000Z' })
    );
    const m = await import('../src/lib/reading-tracker');

    expect(m.isRead('legacy-gp')).toBe(true);
    expect(m.getReadRecords({ 'legacy-gp': 'rev-now' })[0]).toMatchObject({
      slug: 'legacy-gp',
      readRevision: null,
      revisionState: 'unknown',
    });
  });

  it('reports stale reads separately from current reads', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('current', 'manual_mark_read', 'rev-1');
    m.markAsRead('stale', 'manual_mark_read', 'rev-old');

    const stats = m.getStats({ current: 'rev-1', stale: 'rev-new' });
    expect(stats.current).toBe(1);
    expect(stats.stale).toBe(1);
    expect(stats.total).toBe(2);
  });

  it('exportJson / importJson roundtrips', async () => {
    let m = await import('../src/lib/reading-tracker');
    m.markAsRead('x');
    m.markAsRead('y');
    const json = m.exportJson();

    (globalThis as any).localStorage.clear();
    vi.resetModules();
    m = await import('../src/lib/reading-tracker');
    expect(m.importJson(json)).toBe(true);
    expect(m.getReadSlugs().sort()).toEqual(['x', 'y']);
  });

  it('importJson rejects malformed input without crashing', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.importJson('not json')).toBe(false);
    expect(m.importJson(JSON.stringify({ version: 99 }))).toBe(false);
    expect(m.getReadSlugs()).toEqual([]);
  });

  it('survives corrupted localStorage entry (treats as empty)', async () => {
    (globalThis as any).localStorage.setItem('gu-log-read-articles', '{not valid}');
    const m = await import('../src/lib/reading-tracker');
    expect(m.getReadSlugs()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// gist-sync
// ════════════════════════════════════════════════════════════════════════════
describe('gist-sync', () => {
  it('mergeSync preserves latest per-post read revision', async () => {
    const m = await import('../src/lib/gist-sync');
    const merged = m.mergeSync(
      {
        version: 2,
        slugs: ['a', 'b'],
        records: [
          {
            slug: 'a',
            method: 'manual_mark_read',
            confidence: 'legacy_or_manual',
            readAt: '2026-04-01T00:00:00.000Z',
            lastReadAt: '2026-04-01T00:00:00.000Z',
            readRevision: 'rev-a-old',
            revisionState: 'current',
          },
          {
            slug: 'b',
            method: 'manual_mark_read',
            confidence: 'legacy_or_manual',
            readAt: '2026-04-01T00:00:00.000Z',
            lastReadAt: '2026-04-01T00:00:00.000Z',
            readRevision: 'rev-b',
            revisionState: 'current',
          },
        ],
        lastUpdated: '2026-04-01T00:00:00.000Z',
      },
      {
        version: 2,
        slugs: ['a', 'c'],
        records: [
          {
            slug: 'a',
            method: 'active_scroll_end',
            confidence: 'active_finish',
            readAt: '2026-04-02T00:00:00.000Z',
            lastReadAt: '2026-04-02T00:00:00.000Z',
            readRevision: 'rev-a-new',
            revisionState: 'current',
          },
          {
            slug: 'c',
            method: 'legacy_import',
            confidence: 'legacy_or_manual',
            readAt: '2026-04-01T00:00:00.000Z',
            lastReadAt: '2026-04-01T00:00:00.000Z',
            readRevision: null,
            revisionState: 'unknown',
          },
        ],
        lastUpdated: '2026-04-02T00:00:00.000Z',
      }
    );

    expect(merged.slugs.sort()).toEqual(['a', 'b', 'c']);
    expect(merged.records.find((record) => record.slug === 'a')?.readRevision).toBe('rev-a-new');
    expect(merged.records.find((record) => record.slug === 'b')?.readRevision).toBe('rev-b');
    expect(merged.records.find((record) => record.slug === 'c')?.revisionState).toBe('unknown');
  });

  it('getGitHubToken returns null when neither JWT nor PAT present', async () => {
    const m = await import('../src/lib/gist-sync');
    expect(m.getGitHubToken()).toBeNull();
  });

  it('getGuLogSessionToken returns the stored gu-log JWT', async () => {
    const jwt = 'header.payload.sig';
    (globalThis as any).localStorage.setItem('gu-log-jwt', jwt);
    const m = await import('../src/lib/gist-sync');
    expect(m.getGuLogSessionToken()).toBe(jwt);
    expect(m.getGitHubToken()).toBeNull();
  });

  it('falls through to PAT when JWT lacks token', async () => {
    (globalThis as any).localStorage.setItem('gu-log-github-pat', 'ghp_pat_abc');
    const m = await import('../src/lib/gist-sync');
    expect(m.getGitHubToken()).toBe('ghp_pat_abc');
  });

  it('findOrCreateGist returns cached id on 200', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'cached-id-123');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    expect(await m.findOrCreateGist('tok')).toBe('cached-id-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/gists/cached-id-123',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('findOrCreateGist drops cached id when GET returns non-200, then searches', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'stale');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 }) // GET cached
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 'new', description: 'gu-log Reading Tracker (auto-synced)' }],
      });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    expect(await m.findOrCreateGist('tok')).toBe('new');
    expect(localStorage.getItem('gu-log-gist-id')).toBe('new');
  });

  it('findOrCreateGist creates new when none exist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // list
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'fresh' }) }); // create
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    expect(await m.findOrCreateGist('tok')).toBe('fresh');
    expect(localStorage.getItem('gu-log-gist-id')).toBe('fresh');
  });

  it('pushToGist patches gist with provided slugs', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // findOrCreate hit
      .mockResolvedValueOnce({ ok: true, status: 200 }); // PATCH
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    await m.pushToGist('tok', ['a', 'b']);
    const lastCall = fetchMock.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('https://api.github.com/gists/gid');
    expect(JSON.parse(lastCall[1].body)).toMatchObject({
      files: expect.objectContaining({
        'gu-log-reading-tracker.json': expect.any(Object),
      }),
    });
  });

  it('pullFromGist returns parsed store on success', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    const remote = { version: 1, slugs: ['x', 'y'], lastUpdated: '2026-04-01' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // findOrCreate
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: { 'gu-log-reading-tracker.json': { content: JSON.stringify(remote) } },
        }),
      });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    expect(await m.pullFromGist('tok')).toEqual(remote);
  });

  it('pullFromGist returns null on schema mismatch', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: {
            'gu-log-reading-tracker.json': { content: JSON.stringify({ version: 99 }) },
          },
        }),
      });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    expect(await m.pullFromGist('tok')).toBeNull();
  });

  it('pushToGist throws localized error on 401', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    await expect(m.pushToGist('tok', [])).rejects.toThrow(/Token/);
  });

  it('pushToGist throws localized error on 403 rate-limit', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');
    await expect(m.pushToGist('tok', [])).rejects.toThrow(/速率限制/);
  });
});
