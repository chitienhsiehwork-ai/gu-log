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
      { method: 'active_scroll_end', activeReadMs: 45_000, maxScrollPercent: 100 }
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

  it('records feedback comments with article identity and version snapshot', async () => {
    const { recordFeedbackComment, getHumanSignalEvents } =
      await import('../src/lib/human-signals');
    const event = recordFeedbackComment(
      {
        postId: 'sp-commented.mdx',
        ticketId: 'SP-COMMENT',
        lang: 'zh-tw',
        pathname: '/posts/sp-commented/',
        postVersion: '9',
      },
      {
        source: 'giscus',
        commentId: 'discussion-comment-123',
        commentText: '難看死了',
        polarity: 'rewrite_needed',
      }
    );
    expect(event).toMatchObject({
      kind: 'feedback_comment',
      postId: 'sp-commented.mdx',
      ticketId: 'SP-COMMENT',
      pathname: '/posts/sp-commented/',
      postVersion: 9,
      source: 'giscus',
      commentId: 'discussion-comment-123',
      commentText: '難看死了',
      polarity: 'rewrite_needed',
      syncStatus: 'local_only',
    });
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
      { activeReadMs: 39_000, maxScrollPercent: 38, finishability: 'abandoned_suspected_boring' }
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

  it('lists local-only and failed human-signal events as pending sync work', async () => {
    const {
      getPendingHumanSignalEvents,
      markHumanSignalEventSynced,
      markHumanSignalEventFailed,
      recordManualMarkRead,
      recordShareIntent,
    } = await import('../src/lib/human-signals');
    const first = recordManualMarkRead({
      postId: 'sp-pending-1.mdx',
      lang: 'zh-tw',
      pathname: '/posts/sp-pending-1/',
      postVersion: 1,
    });
    const second = recordShareIntent(
      {
        postId: 'sp-pending-2.mdx',
        lang: 'en',
        pathname: '/en/posts/sp-pending-2/',
        postVersion: 1,
      },
      { target: 'copy_link', result: 'attempted' }
    );
    expect(getPendingHumanSignalEvents().map((event) => event.eventId)).toEqual([
      first.eventId,
      second.eventId,
    ]);
    expect(markHumanSignalEventSynced(first.eventId)).toBe(true);
    expect(markHumanSignalEventFailed(second.eventId)).toBe(true);
    expect(getPendingHumanSignalEvents()).toEqual([
      expect.objectContaining({ eventId: second.eventId, syncStatus: 'sync_failed' }),
    ]);
  });

  it('marks human-signal sync status by eventId without changing event semantics', async () => {
    const {
      getHumanSignalEvents,
      markHumanSignalEventFailed,
      markHumanSignalEventSynced,
      recordReadFinish,
    } = await import('../src/lib/human-signals');
    const event = recordReadFinish(
      {
        postId: 'sp-status.mdx',
        ticketId: 'SP-STATUS',
        lang: 'zh-tw',
        pathname: '/posts/sp-status/',
        postVersion: 2,
      },
      { method: 'active_scroll_end', activeReadMs: 10_000, maxScrollPercent: 100 }
    );
    const before = { ...event };
    expect(markHumanSignalEventFailed('missing-event-id')).toBe(false);
    expect(markHumanSignalEventFailed(event.eventId)).toBe(true);
    expect(markHumanSignalEventSynced(event.eventId)).toBe(true);
    expect(getHumanSignalEvents()[0]).toEqual({ ...before, syncStatus: 'synced' });
  });

  it('treats corrupted human-signal storage as an empty pending queue', async () => {
    (globalThis as any).localStorage.setItem('gu-log-human-signals', '{not valid json');
    const { getHumanSignalEvents, getPendingHumanSignalEvents, markHumanSignalEventSynced } =
      await import('../src/lib/human-signals');
    expect(getHumanSignalEvents()).toEqual([]);
    expect(getPendingHumanSignalEvents()).toEqual([]);
    expect(markHumanSignalEventSynced('missing-event-id')).toBe(false);
  });

  it('classifies guest and unknown signals as non-authoritative and owner signals as actionable', async () => {
    const { classifyHumanSignalTrustTier, isAutomationAuthoritativeTrustTier } =
      await import('../src/lib/human-signals');
    expect(classifyHumanSignalTrustTier()).toBe('unknown');
    expect(classifyHumanSignalTrustTier({ reader: 'anonymous' })).toBe('guest_reference');
    expect(classifyHumanSignalTrustTier({ reader: 'gu-owner', ownerReader: 'gu-owner' })).toBe(
      'owner_trusted'
    );
    expect(classifyHumanSignalTrustTier({ reader: 'editor', ownerApproved: true })).toBe(
      'owner_approved'
    );
    expect(isAutomationAuthoritativeTrustTier('unknown')).toBe(false);
    expect(isAutomationAuthoritativeTrustTier('guest_reference')).toBe(false);
    expect(isAutomationAuthoritativeTrustTier('owner_trusted')).toBe(true);
    expect(isAutomationAuthoritativeTrustTier('owner_approved')).toBe(true);
  });

  it('promotes a copied event to an owner trust tier without mutating the original event', async () => {
    const { promoteHumanSignalTrustTier, recordReadFinish } =
      await import('../src/lib/human-signals');
    const original = recordReadFinish(
      { postId: 'sp-99.mdx', lang: 'zh-tw', pathname: '/posts/sp-99/', postVersion: 2 },
      { method: 'active_scroll_end' }
    );
    const promoted = promoteHumanSignalTrustTier(original, 'owner_trusted', 'gu-owner');
    expect(original.readerTrustTier).toBe('unknown');
    expect(original.reader).toBeUndefined();
    expect(promoted).toMatchObject({
      eventId: original.eventId,
      readerTrustTier: 'owner_trusted',
      reader: 'gu-owner',
    });
    expect(promoted).not.toBe(original);
  });

  it('builds a read-only Tribunal packet filtered by post identity and version', async () => {
    const {
      buildHumanSignalTribunalPacket,
      promoteHumanSignalTrustTier,
      recordReadFinish,
      recordShareIntent,
    } = await import('../src/lib/human-signals');
    const ownerFinish = promoteHumanSignalTrustTier(
      recordReadFinish(
        { postId: 'sp-123.mdx', lang: 'zh-tw', pathname: '/posts/sp-123/', postVersion: 4 },
        { method: 'active_scroll_end', activeReadMs: 61_000, maxScrollPercent: 100 }
      ),
      'owner_trusted',
      'gu-owner'
    );
    const guestShare = {
      ...recordShareIntent(
        { postId: 'sp-123.mdx', lang: 'zh-tw', pathname: '/posts/sp-123/', postVersion: 4 },
        { target: 'copy_link', result: 'completed' }
      ),
      readerTrustTier: 'guest_reference' as const,
    };
    const otherVersion = promoteHumanSignalTrustTier(
      recordReadFinish(
        { postId: 'sp-123.mdx', lang: 'zh-tw', pathname: '/posts/sp-123/', postVersion: 3 },
        { method: 'active_scroll_end' }
      ),
      'owner_trusted'
    );
    const samePathDifferentPost = promoteHumanSignalTrustTier(
      recordReadFinish(
        { postId: 'sp-else.mdx', lang: 'zh-tw', pathname: '/posts/sp-123/', postVersion: 4 },
        { method: 'active_scroll_end' }
      ),
      'owner_trusted'
    );
    const packet = buildHumanSignalTribunalPacket(
      { postId: 'sp-123.mdx', pathname: '/posts/sp-123/', postVersion: 4 },
      [ownerFinish, guestShare, otherVersion, samePathDifferentPost]
    );
    expect(packet).toMatchObject({
      packetSchemaVersion: 1,
      postId: 'sp-123.mdx',
      pathname: '/posts/sp-123/',
      postVersion: 4,
      automationAuthoritativeSignalCount: 1,
      recommendedAutomation: 'none',
    });
    expect(packet.signals).toHaveLength(2);
    expect(packet.signals.map((signal) => signal.eventId)).toEqual([
      ownerFinish.eventId,
      guestShare.eventId,
    ]);
    expect(packet.signals[0]).toMatchObject({
      kind: 'read_finish',
      readerTrustTier: 'owner_trusted',
      automationAuthoritative: true,
      finishability: 'finished',
    });
    expect(packet.signals[1]).toMatchObject({
      kind: 'share_intent',
      readerTrustTier: 'guest_reference',
      automationAuthoritative: false,
      reactionStrength: 'strong',
      polarity: 'unknown',
    });
    expect(packet.signals[1]).not.toHaveProperty('preservePositive');
    expect(packet).not.toHaveProperty('requeueTribunal');
    expect(Object.isFrozen(packet)).toBe(true);
    expect(Object.isFrozen(packet.signals)).toBe(true);
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
