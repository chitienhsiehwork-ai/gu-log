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

  it('records share_intent as a strong reaction without assuming positive polarity', async () => {
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
      reactionStrength: 'strong',
      polarity: 'unknown',
    });
    expect(event).not.toHaveProperty('sentiment', 'positive');
    expect(getHumanSignalEvents()).toEqual([event]);
  });

  it('records abandoned reading as low-confidence suspected boring evidence with engagement metrics', async () => {
    const { recordReadAbandonCandidate, getHumanSignalEvents } =
      await import('../src/lib/human-signals');

    const event = recordReadAbandonCandidate(
      {
        postId: 'sp-456-20260602-boring-post.mdx',
        ticketId: 'SP-456',
        lang: 'zh-tw',
        pathname: '/posts/sp-456-20260602-boring-post/',
        postVersion: 3,
      },
      {
        activeReadMs: 39_000,
        maxScrollPercent: 38,
        finishability: 'abandoned_suspected_boring',
      }
    );

    expect(event).toMatchObject({
      kind: 'read_abandon_candidate',
      postId: 'sp-456-20260602-boring-post.mdx',
      ticketId: 'SP-456',
      postVersion: 3,
      activeReadMs: 39_000,
      maxScrollPercent: 38,
      finishability: 'abandoned_suspected_boring',
      confidence: 'low',
      transport: 'local_storage',
      syncStatus: 'local_only',
    });
    expect(event.activeReadMs).toEqual(expect.any(Number));
    expect(event.maxScrollPercent).toEqual(expect.any(Number));
    expect(getHumanSignalEvents()).toEqual([event]);
  });

  it('upserts repeated pagehide abandon candidates for the same article version instead of spamming duplicates', async () => {
    const { recordReadAbandonCandidate, getHumanSignalEvents } =
      await import('../src/lib/human-signals');
    const snapshot = {
      postId: 'sp-789-20260603-repeated-pagehide.mdx',
      ticketId: 'SP-789',
      lang: 'zh-tw' as const,
      pathname: '/posts/sp-789-20260603-repeated-pagehide/',
      postVersion: 5,
    };

    const first = recordReadAbandonCandidate(snapshot, {
      activeReadMs: 31_000,
      maxScrollPercent: 34,
      finishability: 'abandoned_suspected_boring',
    });
    const second = recordReadAbandonCandidate(snapshot, {
      activeReadMs: 32_500,
      maxScrollPercent: 36,
      finishability: 'abandoned_suspected_boring',
    });

    expect(getHumanSignalEvents()).toEqual([second]);
    expect(second.eventId).toBe(first.eventId);
    expect(second).toMatchObject({
      kind: 'read_abandon_candidate',
      postId: snapshot.postId,
      ticketId: snapshot.ticketId,
      postVersion: 5,
      confidence: 'low',
      activeReadMs: 32_500,
      maxScrollPercent: 36,
    });
  });

  it('keeps abandon candidates for different article versions as separate events', async () => {
    const { recordReadAbandonCandidate, getHumanSignalEvents } =
      await import('../src/lib/human-signals');
    const baseSnapshot = {
      postId: 'sp-789-20260603-repeated-pagehide.mdx',
      lang: 'zh-tw' as const,
      pathname: '/posts/sp-789-20260603-repeated-pagehide/',
    };

    const v1 = recordReadAbandonCandidate(
      { ...baseSnapshot, postVersion: 5 },
      { activeReadMs: 31_000, maxScrollPercent: 34 }
    );
    const v2 = recordReadAbandonCandidate(
      { ...baseSnapshot, postVersion: 6 },
      { activeReadMs: 31_000, maxScrollPercent: 34 }
    );

    expect(getHumanSignalEvents()).toEqual([v1, v2]);
  });
});

describe('reading tracker migration to event-aware store', () => {
  it('preserves v1 read slugs and imports them as legacy-confidence records', async () => {
    (globalThis as any).localStorage.setItem(
      'gu-log-read-articles',
      JSON.stringify({
        version: 1,
        slugs: ['sp-1', 'sp-2'],
        lastUpdated: '2026-06-01T00:00:00.000Z',
      })
    );

    const tracker = await import('../src/lib/reading-tracker');

    expect(tracker.getReadSlugs().sort()).toEqual(['sp-1', 'sp-2']);
    expect(tracker.getStats()).toMatchObject({ total: 2, version: 2 });
    expect(tracker.getReadRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'sp-1',
          method: 'legacy_import',
          confidence: 'legacy_or_manual',
        }),
        expect.objectContaining({
          slug: 'sp-2',
          method: 'legacy_import',
          confidence: 'legacy_or_manual',
        }),
      ])
    );
  });
});
