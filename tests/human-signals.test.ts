/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('human signals', () => {
  it('records read_finish with article identity, visible version, method, and engagement metrics', async () => {
    const { recordReadFinish, getHumanSignalEvents } = await import('../src/lib/human-signals');

    const event = recordReadFinish(
      {
        postId: 'sp-123-20260601-interesting-post.mdx',
        ticketId: 'SP-123',
        lang: 'zh-tw',
        pathname: '/posts/sp-123-20260601-interesting-post/',
        postVersion: '4',
      },
      {
        method: 'active_scroll_end',
        activeReadMs: 45_000,
        maxScrollPercent: 100,
      }
    );

    expect(event).toMatchObject({
      eventSchemaVersion: 1,
      kind: 'read_finish',
      postId: 'sp-123-20260601-interesting-post.mdx',
      ticketId: 'SP-123',
      lang: 'zh-tw',
      pathname: '/posts/sp-123-20260601-interesting-post/',
      postVersion: 4,
      method: 'active_scroll_end',
      activeReadMs: 45_000,
      maxScrollPercent: 100,
      finishability: 'finished',
      readerTrustTier: 'unknown',
      transport: 'local_storage',
      syncStatus: 'local_only',
    });
    expect(event.eventId).toMatch(/^hs_/);
    expect(typeof event.occurredAt).toBe('string');
    expect(getHumanSignalEvents()).toEqual([event]);
  });

  it('records manual mark-read separately from high-confidence active finish', async () => {
    const { recordManualMarkRead } = await import('../src/lib/human-signals');

    const event = recordManualMarkRead({
      postId: 'sp-1.mdx',
      lang: 'zh-tw',
      pathname: '/posts/sp-1/',
      postVersion: 2,
    });

    expect(event).toMatchObject({
      kind: 'read_finish',
      method: 'manual_mark_read',
      finishability: 'manually_marked_read',
      confidence: 'legacy_or_manual',
      postVersion: 2,
    });
  });

  it('records share_intent with target, result confidence, and version snapshot', async () => {
    const { recordShareIntent, getHumanSignalEvents } = await import('../src/lib/human-signals');

    const event = recordShareIntent(
      {
        postId: 'en-sp-123-20260601-interesting-post.mdx',
        ticketId: 'SP-123',
        lang: 'en',
        pathname: '/en/posts/sp-123-20260601-interesting-post/',
        postVersion: '7',
      },
      { target: 'copy_link', result: 'completed' }
    );

    expect(event).toMatchObject({
      kind: 'share_intent',
      target: 'copy_link',
      result: 'completed',
      resultConfidence: 'completed',
      postVersion: 7,
      sentiment: 'positive',
    });
    expect(getHumanSignalEvents()).toEqual([event]);
  });
});

describe('reading tracker migration to event-aware store', () => {
  it('preserves v1 read slugs and imports them as legacy-confidence records', async () => {
    (globalThis as any).localStorage.setItem(
      'gu-log-read-articles',
      JSON.stringify({ version: 1, slugs: ['sp-1', 'sp-2'], lastUpdated: '2026-06-01T00:00:00.000Z' })
    );

    const tracker = await import('../src/lib/reading-tracker');

    expect(tracker.getReadSlugs().sort()).toEqual(['sp-1', 'sp-2']);
    expect(tracker.getStats()).toMatchObject({ total: 2, version: 2 });
    expect(tracker.getReadRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'sp-1', method: 'legacy_import', confidence: 'legacy_or_manual' }),
        expect.objectContaining({ slug: 'sp-2', method: 'legacy_import', confidence: 'legacy_or_manual' }),
      ])
    );
  });
});
