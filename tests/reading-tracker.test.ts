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
    m.markAsRead('sp-1');
    expect(m.isRead('sp-1')).toBe(true);

    vi.resetModules();
    m = await import('../src/lib/reading-tracker');
    expect(m.isRead('sp-1')).toBe(true);
    expect(m.getReadSlugs()).toEqual(['sp-1']);
  });

  it('markAsRead is idempotent (no duplicate slugs)', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('sp-1');
    m.markAsRead('sp-1');
    expect(m.getReadSlugs()).toEqual(['sp-1']);
  });

  it('markAsUnread removes the slug', async () => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('sp-1');
    m.markAsUnread('sp-1');
    expect(m.isRead('sp-1')).toBe(false);
  });

  it('toggleRead returns the new state', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.toggleRead('sp-1')).toBe(true);
    expect(m.toggleRead('sp-1')).toBe(false);
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
  it('mergeSync union-merges without duplicates', async () => {
    const m = await import('../src/lib/gist-sync');
    expect(m.mergeSync(['a', 'b'], ['b', 'c']).sort()).toEqual(['a', 'b', 'c']);
    expect(m.mergeSync([], ['x'])).toEqual(['x']);
    expect(m.mergeSync(['x'], [])).toEqual(['x']);
  });

  it('getGitHubToken returns null when neither JWT nor PAT present', async () => {
    const m = await import('../src/lib/gist-sync');
    expect(m.getGitHubToken()).toBeNull();
  });

  it('getGitHubToken decodes JWT payload.github_token', async () => {
    const payload = { github_token: 'ghp_test_token_long_enough' };
    const b64 = (s: string) =>
      Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = `header.${b64(JSON.stringify(payload))}.sig`;
    (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
    (globalThis as any).localStorage.setItem('gu-log-jwt', jwt);
    const m = await import('../src/lib/gist-sync');
    expect(m.getGitHubToken()).toBe('ghp_test_token_long_enough');
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
