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

function legacyV2Store(slug = 'legacy-v2') {
  return {
    version: 2,
    slugs: [slug],
    records: [
      {
        slug,
        method: 'manual_mark_read',
        confidence: 'legacy_or_manual',
        lastReadAt: '2026-04-01T00:00:00.000Z',
      },
    ],
    lastUpdated: '2026-04-01T00:00:00.000Z',
  };
}

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

  it('fails closed when marking an article read cannot be persisted', async () => {
    const m = await import('../src/lib/reading-tracker');
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    try {
      expect(m.markAsRead('gp-denied')).toBe(false);
      expect(m.isRead('gp-denied')).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it('fails closed when marking an article unread cannot be persisted', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.markAsRead('gp-existing')).toBe(true);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    try {
      expect(m.markAsUnread('gp-existing')).toBe(false);
      expect(m.isRead('gp-existing')).toBe(true);
    } finally {
      setItem.mockRestore();
    }
  });

  it('returns no toggled state when either storage write is rejected', async () => {
    const m = await import('../src/lib/reading-tracker');
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    try {
      expect(m.toggleRead('gp-unread')).toBeNull();
      expect(m.isRead('gp-unread')).toBe(false);
    } finally {
      setItem.mockRestore();
    }

    expect(m.markAsRead('gp-read')).toBe(true);
    const secondSetItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    try {
      expect(m.toggleRead('gp-read')).toBeNull();
      expect(m.isRead('gp-read')).toBe(true);
    } finally {
      secondSetItem.mockRestore();
    }
  });

  it('does not attempt a mutation when storage cannot be read', async () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('storage denied', 'SecurityError');
    });
    const setItem = vi.spyOn(localStorage, 'setItem');
    const m = await import('../src/lib/reading-tracker');

    try {
      expect(m.markAsRead('gp-read-denied')).toBe(false);
      expect(m.toggleRead('gp-toggle-denied')).toBeNull();
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('replaces corrupt JSON when storage remains readable and writable', async () => {
    localStorage.setItem('gu-log-read-articles', '{not valid}');
    const m = await import('../src/lib/reading-tracker');

    expect(m.markAsRead('gp-recovered')).toBe(true);
    expect(m.isRead('gp-recovered')).toBe(true);
  });

  it('persists a bulk read-state update with one storage write', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.markAsRead('gp-existing')).toBe(true);
    const setItem = vi.spyOn(localStorage, 'setItem');

    try {
      expect(
        m.setReadStates([
          { slug: 'gp-existing', read: false },
          { slug: 'gp-a', read: true, currentRevision: 'rev-a' },
          { slug: 'gp-b', read: true, currentRevision: 'rev-b' },
        ])
      ).toBe(true);
      expect(setItem).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }

    expect(m.getReadSlugs().sort()).toEqual(['gp-a', 'gp-b']);
    expect(m.getReadState('gp-a', 'rev-a')).toBe('current');
  });

  it('keeps the whole prior store when a bulk write is rejected', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.markAsRead('gp-existing', 'manual_mark_read', 'rev-existing')).toBe(true);
    const before = m.exportJson();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage quota exceeded');
    });

    try {
      expect(
        m.setReadStates([
          { slug: 'gp-existing', read: false },
          { slug: 'gp-a', read: true, currentRevision: 'rev-a' },
          { slug: 'gp-b', read: true, currentRevision: 'rev-b' },
        ])
      ).toBe(false);
    } finally {
      setItem.mockRestore();
    }

    expect(m.exportJson()).toBe(before);
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

  it('keeps imported __proto__ slugs as serializable own records', async () => {
    const m = await import('../src/lib/reading-tracker');
    const imported = {
      version: 2,
      slugs: ['__proto__'],
      records: [
        {
          slug: '__proto__',
          method: 'manual_mark_read',
          confidence: 'legacy_or_manual',
          readAt: '2026-07-27T00:00:00.000Z',
          lastReadAt: '2026-07-27T00:00:00.000Z',
          readRevision: 'rev-1',
          revisionState: 'current',
        },
      ],
      lastUpdated: '2026-07-27T00:00:00.000Z',
    };

    expect(m.importJson(JSON.stringify(imported))).toBe(true);
    const records = m.getReadRecordMap();

    expect(Object.getPrototypeOf(records)).toBeNull();
    expect(Object.hasOwn(records, '__proto__')).toBe(true);
    expect(records['__proto__']).toMatchObject({ slug: '__proto__' });
    expect(Object.values(records)).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(records))['__proto__']).toMatchObject({
      slug: '__proto__',
    });
  });

  it('importJson rejects malformed input without crashing', async () => {
    const m = await import('../src/lib/reading-tracker');
    expect(m.importJson('not json')).toBe(false);
    expect(m.importJson(JSON.stringify({ version: 99 }))).toBe(false);
    expect(m.getReadSlugs()).toEqual([]);
  });

  it.each([
    ['array root', []],
    ['unknown version', { version: 99, slugs: [], lastUpdated: '2026-07-27T00:00:00.000Z' }],
    [
      'mixed slug types',
      {
        version: 1,
        slugs: ['valid', { slug: 'poisoned' }],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    [
      'duplicate slugs',
      {
        version: 1,
        slugs: ['duplicate', 'duplicate'],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    [
      'non-array records',
      {
        version: 2,
        slugs: ['poisoned'],
        records: 'not-an-array',
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    ['missing fields', { version: 1, slugs: ['poisoned'] }],
    [
      'invalid store timestamp',
      { version: 1, slugs: ['poisoned'], lastUpdated: 'not-a-timestamp' },
    ],
    [
      'invalid record timestamp',
      {
        version: 2,
        slugs: ['poisoned'],
        records: [
          {
            slug: 'poisoned',
            method: 'manual_mark_read',
            confidence: 'legacy_or_manual',
            readAt: 'not-a-timestamp',
            lastReadAt: '2026-07-27T00:00:00.000Z',
            readRevision: null,
            revisionState: 'unknown',
          },
        ],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    [
      'mismatched current record timestamps',
      {
        version: 2,
        slugs: ['poisoned'],
        records: [
          {
            slug: 'poisoned',
            method: 'manual_mark_read',
            confidence: 'legacy_or_manual',
            readAt: '2026-07-27T00:00:00.000Z',
            lastReadAt: '2026-07-27T00:00:01.000Z',
            readRevision: null,
            revisionState: 'unknown',
          },
        ],
        lastUpdated: '2026-07-27T00:00:01.000Z',
      },
    ],
    [
      'missing record fields',
      {
        version: 2,
        slugs: ['poisoned'],
        records: [{ slug: 'poisoned', readAt: '2026-07-27T00:00:00.000Z' }],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    [
      'record-only slug',
      {
        version: 2,
        slugs: [],
        records: [
          {
            slug: 'poisoned',
            method: 'manual_mark_read',
            confidence: 'legacy_or_manual',
            readAt: '2026-07-27T00:00:00.000Z',
            lastReadAt: '2026-07-27T00:00:00.000Z',
            readRevision: null,
            revisionState: 'unknown',
          },
        ],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    [
      'slug without record',
      {
        version: 2,
        slugs: ['poisoned'],
        records: [],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
  ])('strict parser rejects %s and import leaves existing state unchanged', async (_, input) => {
    const m = await import('../src/lib/reading-tracker');
    m.markAsRead('existing', 'manual_mark_read', 'rev-existing');
    const before = m.exportJson();

    expect(m.parseReadStore(input)).toBeNull();
    expect(m.importJson(JSON.stringify(input))).toBe(false);
    expect(m.exportJson()).toBe(before);
  });

  it('strict parser accepts complete v1 and v2 stores', async () => {
    const m = await import('../src/lib/reading-tracker');
    const v1 = {
      version: 1 as const,
      slugs: ['legacy'],
      lastUpdated: '2026-07-27T00:00:00.000Z',
    };
    const v2 = {
      version: 2 as const,
      slugs: ['current'],
      records: [
        {
          slug: 'current',
          method: 'active_scroll_end' as const,
          confidence: 'active_finish' as const,
          readAt: '2026-07-27T00:00:00.000Z',
          lastReadAt: '2026-07-27T00:00:00.000Z',
          readRevision: 'rev-current',
          revisionState: 'current' as const,
        },
      ],
      lastUpdated: '2026-07-27T00:00:01.000Z',
    };

    expect(m.parseReadStore(v1)).toEqual(v1);
    expect(m.parseReadStore(v2)).toEqual(v2);
  });

  it('migrates the production legacy v2 record shape without losing read state', async () => {
    const legacy = legacyV2Store();
    localStorage.setItem('gu-log-read-articles', JSON.stringify(legacy));
    const m = await import('../src/lib/reading-tracker');

    expect(m.isRead('legacy-v2')).toBe(true);
    expect(m.getReadRecords()).toEqual([
      {
        slug: 'legacy-v2',
        method: 'manual_mark_read',
        confidence: 'legacy_or_manual',
        readAt: '2026-04-01T00:00:00.000Z',
        lastReadAt: '2026-04-01T00:00:00.000Z',
        readRevision: null,
        revisionState: 'unknown',
      },
    ]);
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
  async function backendScopeError(reauthorizeUrl: unknown, apiUrl = 'https://api.shroomdog.dev') {
    (globalThis as any).localStorage.setItem('gu-log-jwt', 'header.payload.sig');
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        detail: {
          code: 'GITHUB_SCOPE_MISSING',
          message: '請重新授權',
          reauthorizeUrl,
        },
      }),
    });
    const module = await import('../src/lib/gist-sync');
    try {
      await module.pullFromReaderSyncApi(apiUrl);
      throw new Error('expected ReaderSyncApiError');
    } catch (error) {
      return { error, module };
    }
  }

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

  it.each([
    'javascript:localStorage.setItem("reader-sync-pwned","1")',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://gu-log.vercel.app/attacker-controlled',
    '//evil.example/auth/github',
    'https://evil.example/auth/github',
    'https://api.shroomdog.dev/not-the-oauth-endpoint',
    'https://user:secret@api.shroomdog.dev/auth/github',
  ])('drops unsafe backend reauthorization URL: %s', async (reauthorizeUrl) => {
    const { error, module } = await backendScopeError(reauthorizeUrl);
    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect((error as { reauthorizeUrl?: string }).reauthorizeUrl).toBeUndefined();
  });

  it.each([
    [
      'absolute',
      'https://api.shroomdog.dev/auth/github?reader_sync=1',
      'https://api.shroomdog.dev/auth/github?reader_sync=1',
    ],
    [
      'same-origin relative',
      '/auth/github?reader_sync=1',
      'https://api.shroomdog.dev/auth/github?reader_sync=1',
    ],
  ])('keeps a valid %s backend reauthorization URL', async (_, reauthorizeUrl, expected) => {
    const { error, module } = await backendScopeError(reauthorizeUrl);
    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect((error as { reauthorizeUrl?: string }).reauthorizeUrl).toBe(expected);
  });

  it.each([
    [
      'absolute',
      'https://api.shroomdog.dev/v1/auth/github?reader_sync=1',
      'https://api.shroomdog.dev/v1/auth/github?reader_sync=1',
    ],
    [
      'same-base relative',
      'auth/github?reader_sync=1',
      'https://api.shroomdog.dev/v1/auth/github?reader_sync=1',
    ],
  ])(
    'keeps a valid %s backend reauthorization URL under an API base path',
    async (_, reauthorizeUrl, expected) => {
      const { error, module } = await backendScopeError(
        reauthorizeUrl,
        'https://api.shroomdog.dev/v1/'
      );
      expect(error).toBeInstanceOf(module.ReaderSyncApiError);
      expect((error as { reauthorizeUrl?: string }).reauthorizeUrl).toBe(expected);
    }
  );

  it('drops an origin-root OAuth URL when the configured API uses a base path', async () => {
    const { error, module } = await backendScopeError(
      '/auth/github?reader_sync=1',
      'https://api.shroomdog.dev/v1/'
    );
    expect(error).toBeInstanceOf(module.ReaderSyncApiError);
    expect((error as { reauthorizeUrl?: string }).reauthorizeUrl).toBeUndefined();
  });

  it.each([
    ['unknown version', { version: 99, slugs: [], lastUpdated: '2026-07-27T00:00:00.000Z' }],
    [
      'non-array records',
      {
        version: 2,
        slugs: ['poisoned'],
        records: 'not-an-array',
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ],
    ['missing fields', { version: 1, slugs: ['poisoned'] }],
    ['invalid timestamp', { version: 1, slugs: ['poisoned'], lastUpdated: 'not-a-timestamp' }],
  ])('pullFromReaderSyncApi rejects %s as an invalid payload', async (_, store) => {
    (globalThis as any).localStorage.setItem('gu-log-jwt', 'header.payload.sig');
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ store }),
    });
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromReaderSyncApi('https://api.shroomdog.dev')).rejects.toMatchObject({
      name: 'ReaderSyncApiError',
      code: 'READER_SYNC_INVALID_PAYLOAD',
    });
  });

  it('pullFromReaderSyncApi accepts complete v1 and v2 stores', async () => {
    (globalThis as any).localStorage.setItem('gu-log-jwt', 'header.payload.sig');
    const stores = [
      {
        version: 1,
        slugs: ['legacy'],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
      {
        version: 2,
        slugs: ['current'],
        records: [
          {
            slug: 'current',
            method: 'manual_mark_read',
            confidence: 'legacy_or_manual',
            readAt: '2026-07-27T00:00:00.000Z',
            lastReadAt: '2026-07-27T00:00:00.000Z',
            readRevision: null,
            revisionState: 'unknown',
          },
        ],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      },
    ];
    (globalThis as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ store: stores[0] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ store: stores[1] }) });
    const m = await import('../src/lib/gist-sync');

    expect(await m.pullFromReaderSyncApi('https://api.shroomdog.dev')).toEqual(stores[0]);
    expect(await m.pullFromReaderSyncApi('https://api.shroomdog.dev')).toEqual(stores[1]);
  });

  it.each([
    ['non-object envelope', []],
    ['missing store field', {}],
    ['invalid JSON', null],
  ])('pullFromReaderSyncApi rejects %s', async (_, payload) => {
    (globalThis as any).localStorage.setItem('gu-log-jwt', 'header.payload.sig');
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json:
        payload === null
          ? async () => {
              throw new SyntaxError('invalid json');
            }
          : async () => payload,
    });
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromReaderSyncApi('https://api.shroomdog.dev')).rejects.toMatchObject({
      name: 'ReaderSyncApiError',
      code: 'READER_SYNC_INVALID_PAYLOAD',
    });
  });

  it('pullFromReaderSyncApi keeps explicit null distinct from a malformed envelope', async () => {
    (globalThis as any).localStorage.setItem('gu-log-jwt', 'header.payload.sig');
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ store: null }),
    });
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromReaderSyncApi('https://api.shroomdog.dev')).resolves.toBeNull();
  });

  it('pullFromReaderSyncApi migrates the production legacy v2 record shape', async () => {
    (globalThis as any).localStorage.setItem('gu-log-jwt', 'header.payload.sig');
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ store: legacyV2Store('api-legacy') }),
    });
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromReaderSyncApi('https://api.shroomdog.dev')).resolves.toMatchObject({
      version: 2,
      slugs: ['api-legacy'],
      records: [
        {
          slug: 'api-legacy',
          readAt: '2026-04-01T00:00:00.000Z',
          lastReadAt: '2026-04-01T00:00:00.000Z',
          readRevision: null,
          revisionState: 'unknown',
        },
      ],
    });
  });

  it('importSyncStore fails closed without changing local reader state', async () => {
    const tracker = await import('../src/lib/reading-tracker');
    tracker.markAsRead('existing', 'manual_mark_read', 'rev-existing');
    const before = tracker.exportJson();
    const m = await import('../src/lib/gist-sync');

    expect(() =>
      m.importSyncStore({
        version: 2,
        slugs: ['poisoned'],
        records: 'not-an-array',
        lastUpdated: '2026-07-27T00:00:00.000Z',
      })
    ).toThrow(
      expect.objectContaining({
        name: 'ReaderSyncApiError',
        code: 'READER_SYNC_INVALID_PAYLOAD',
      })
    );
    expect(tracker.exportJson()).toBe(before);
  });

  it('importSyncStore treats storage failure as failure and leaves existing state unchanged', async () => {
    const tracker = await import('../src/lib/reading-tracker');
    tracker.markAsRead('existing', 'manual_mark_read', 'rev-existing');
    const before = tracker.exportJson();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    const m = await import('../src/lib/gist-sync');

    expect(() =>
      m.importSyncStore({
        version: 1,
        slugs: ['remote'],
        lastUpdated: '2026-07-27T00:00:00.000Z',
      })
    ).toThrow(
      expect.objectContaining({
        name: 'ReaderSyncApiError',
        code: 'READER_SYNC_INVALID_PAYLOAD',
      })
    );
    expect(tracker.exportJson()).toBe(before);
    setItem.mockRestore();
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

  it('pullFromGist migrates the production legacy v2 record shape', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          files: {
            'gu-log-reading-tracker.json': {
              content: JSON.stringify(legacyV2Store('gist-legacy')),
            },
          },
        }),
      });
    (globalThis as any).fetch = fetchMock;
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromGist('tok')).resolves.toMatchObject({
      version: 2,
      slugs: ['gist-legacy'],
      records: [
        {
          slug: 'gist-legacy',
          readAt: '2026-04-01T00:00:00.000Z',
          lastReadAt: '2026-04-01T00:00:00.000Z',
          readRevision: null,
          revisionState: 'unknown',
        },
      ],
    });
  });

  it.each([
    ['array root', []],
    ['null root', null],
    ['missing files', {}],
    ['null files', { files: null }],
    ['file without content', { files: { 'gu-log-reading-tracker.json': {} } }],
  ])('pullFromGist rejects malformed %s envelope', async (_, gist) => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    (globalThis as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => gist });
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromGist('tok')).rejects.toMatchObject({
      name: 'ReaderSyncApiError',
      code: 'READER_SYNC_INVALID_PAYLOAD',
    });
  });

  it('pullFromGist returns null only when a valid files envelope lacks the tracker file', async () => {
    (globalThis as any).localStorage.setItem('gu-log-gist-id', 'gid');
    (globalThis as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ files: {} }) });
    const m = await import('../src/lib/gist-sync');

    await expect(m.pullFromGist('tok')).resolves.toBeNull();
  });

  it('pullFromGist rejects schema mismatch instead of treating it as an absent remote', async () => {
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
    await expect(m.pullFromGist('tok')).rejects.toMatchObject({
      name: 'ReaderSyncApiError',
      code: 'READER_SYNC_INVALID_PAYLOAD',
    });
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
