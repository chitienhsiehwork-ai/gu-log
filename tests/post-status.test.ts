/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for src/utils/post-status.ts and src/utils/post-versions.ts
 *
 * post-status implements the Stage 0–4 lifecycle that drives the
 * banners shown on each post (deprecated / retired). Bad logic = wrong
 * banner ships; this is the safety net.
 */
import { describe, expect, it } from 'vitest';
import {
  getIndexPosts,
  getLocalizedPostUrl,
  getListablePosts,
  getNavigablePosts,
  getPostStatus,
  getPublishedPosts,
  getTranslationPair,
  isPostNonPublished,
  resolvePostStatus,
} from '../src/utils/post-status';
import { getPostVersion } from '../src/utils/post-versions';

// Minimal duck-typed fake matching the runtime shape used by post-status.
type FakePost = {
  id: string;
  data: {
    ticketId: string;
    lang: 'zh-tw' | 'en';
    status?: 'published' | 'deprecated' | 'retired';
    deprecatedBy?: string;
    deprecatedReason?: string;
    retiredReason?: string;
    retiredAt?: string;
    scores?: any;
  };
};

function p(
  id: string,
  ticketId: string,
  lang: 'zh-tw' | 'en',
  extra: Partial<FakePost['data']> = {}
): FakePost {
  return { id, data: { slug: id, ticketId, lang, ...extra } as FakePost['data'] };
}

const cast = (xs: FakePost[]) => xs as unknown as Parameters<typeof getPublishedPosts>[0];

describe('resolvePostStatus', () => {
  it('returns published when post + zh source are both published', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw');
    const en = p('en-sp-1-x', 'SP-1', 'en');
    const r = resolvePostStatus(en as any, cast([zh, en]));
    expect(r.status).toBe('published');
  });

  it('en post inherits "deprecated" from its zh-tw pair', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', {
      status: 'deprecated',
      deprecatedBy: 'SP-2',
      deprecatedReason: 'replaced',
    });
    const en = p('en-sp-1-x', 'SP-1', 'en');
    const newZh = p('sp-2-y', 'SP-2', 'zh-tw');
    const newEn = p('en-sp-2-y', 'SP-2', 'en');
    const r = resolvePostStatus(en as any, cast([zh, en, newZh, newEn]));
    expect(r.status).toBe('deprecated');
    expect(r.replacementTicketId).toBe('SP-2');
    // Should prefer the en replacement when post is en
    expect(r.replacementPost?.id).toBe('en-sp-2-y');
    expect(r.reason).toBe('replaced');
  });

  it('falls back to source-lang replacement when target lang missing', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', { status: 'deprecated', deprecatedBy: 'SP-2' });
    const en = p('en-sp-1-x', 'SP-1', 'en');
    const newZh = p('sp-2-y', 'SP-2', 'zh-tw');
    // No newEn
    const r = resolvePostStatus(en as any, cast([zh, en, newZh]));
    expect(r.replacementPost?.id).toBe('sp-2-y');
  });

  it('retired status carries reason + retiredAt', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', {
      status: 'retired',
      retiredReason: 'shut down',
      retiredAt: '2026-04-01',
    });
    const r = resolvePostStatus(zh as any, cast([zh]));
    expect(r.status).toBe('retired');
    expect(r.reason).toBe('shut down');
    expect(r.retiredAt).toBe('2026-04-01');
    expect(r.replacementTicketId).toBeUndefined();
  });

  it('normalizes unknown status string to "published"', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', { status: 'mystery' as any });
    expect(resolvePostStatus(zh as any, cast([zh])).status).toBe('published');
  });
});

describe('getPostStatus / isPostNonPublished', () => {
  it('without posts list returns the raw normalized status', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', { status: 'deprecated' });
    expect(getPostStatus(zh as any)).toBe('deprecated');
  });

  it('with posts list resolves through translation pair', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', { status: 'retired' });
    const en = p('en-sp-1-x', 'SP-1', 'en');
    expect(getPostStatus(en as any, cast([zh, en]))).toBe('retired');
    expect(isPostNonPublished(en as any, cast([zh, en]))).toBe(true);
  });
});

describe('getTranslationPair', () => {
  it('finds the en pair from a zh post', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw');
    const en = p('en-sp-1-x', 'SP-1', 'en');
    expect(getTranslationPair(zh as any, cast([zh, en]))?.id).toBe('en-sp-1-x');
  });

  it('returns undefined when no ticketId', () => {
    const orphan = { id: 's', data: { ticketId: '', lang: 'zh-tw' } };
    expect(getTranslationPair(orphan as any, cast([]))).toBeUndefined();
  });

  it('returns undefined when no pair exists', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw');
    expect(getTranslationPair(zh as any, cast([zh]))).toBeUndefined();
  });
});

describe('getPublishedPosts / getListablePosts', () => {
  const zh1 = p('sp-1-x', 'SP-1', 'zh-tw');
  const en1 = p('en-sp-1-x', 'SP-1', 'en');
  const zh2 = p('sp-2-y', 'SP-2', 'zh-tw', { status: 'deprecated', deprecatedBy: 'SP-3' });
  const en2 = p('en-sp-2-y', 'SP-2', 'en');
  const zh3 = p('sp-3-z', 'SP-3', 'zh-tw');
  const all = [zh1, en1, zh2, en2, zh3];

  it('getPublishedPosts excludes deprecated chains', () => {
    const r = getPublishedPosts(cast(all), 'zh-tw');
    expect(r.map((p: any) => p.id).sort()).toEqual(['sp-1-x', 'sp-3-z']);
  });

  it('getPublishedPosts filters by lang', () => {
    expect(getPublishedPosts(cast(all), 'en').map((p: any) => p.id)).toEqual(['en-sp-1-x']);
  });

  it('getListablePosts excludes deprecated but includes retired', () => {
    const retired = p('sp-4-r', 'SP-4', 'zh-tw', { status: 'retired' });
    const r = getListablePosts(cast([...all, retired]), 'zh-tw');
    expect(r.map((p: any) => p.id)).toContain('sp-4-r'); // retired listable
    expect(r.map((p: any) => p.id)).not.toContain('sp-2-y'); // deprecated NOT listable
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getIndexPosts — 兩層品質門檻的消費端（spec: publish-bar-visibility）
// 首頁只放「沒有真分數（grandfathered）」或「過完整 PASS bar」的文章；
// below-bar 只被擋在首頁外，其他 published surfaces（getPublishedPosts）照常收。
// ════════════════════════════════════════════════════════════════════════════
describe('getIndexPosts (publish-bar visibility)', () => {
  // 完整過 PASS bar 的分數（對齊 tests/tribunal-scores.test.ts 的 passScores）
  const passingScores = {
    tribunalVersion: 9,
    vibe: { persona: 9, clawdNote: 8, vibe: 8, narrative: 8, score: 8, date: '2026-07-04' },
    factCheck: {
      accuracy: 8,
      fidelity: 8,
      consistency: 8,
      sourceBoundary: 8,
      commentarySeparation: 8,
      score: 8,
      date: '2026-07-04',
    },
    librarian: {
      glossary: 8,
      crossRef: 8,
      sourceAlign: 8,
      attribution: 8,
      score: 8,
      date: '2026-07-04',
    },
    freshEyes: {
      readability: 8,
      firstImpression: 8,
      payoffDensity: 8,
      lengthFit: 8,
      clarity: 8,
      score: 8,
      date: '2026-07-04',
    },
  };
  // 有真分數（vibe.score 為數值）但沒過 bar → below bar
  const sub8Scores = {
    tribunalVersion: 9,
    vibe: { persona: 7, clawdNote: 7, vibe: 7, narrative: 7, score: 7, date: '2026-07-04' },
  };

  const passing = p('sp-1-pass', 'SP-1', 'zh-tw', { scores: passingScores });
  const sub8 = p('sp-2-sub8', 'SP-2', 'zh-tw', { scores: sub8Scores });
  const grandfathered = p('sp-3-old', 'SP-3', 'zh-tw'); // 無 scores block
  const all = [passing, sub8, grandfathered];

  it('excludes below-bar posts from the homepage list', () => {
    const ids = getIndexPosts(cast(all), 'zh-tw').map((post: any) => post.id);
    expect(ids).not.toContain('sp-2-sub8');
  });

  it('includes posts that meet the full publish bar', () => {
    const ids = getIndexPosts(cast(all), 'zh-tw').map((post: any) => post.id);
    expect(ids).toContain('sp-1-pass');
  });

  it('keeps grandfathered (un-scored) posts on the homepage', () => {
    const ids = getIndexPosts(cast(all), 'zh-tw').map((post: any) => post.id);
    expect(ids).toContain('sp-3-old');
  });

  it('below-bar posts stay published on non-homepage surfaces (not globally hidden)', () => {
    const ids = getPublishedPosts(cast(all), 'zh-tw').map((post: any) => post.id);
    expect(ids).toContain('sp-2-sub8');
  });

  it('still excludes deprecated posts regardless of scores', () => {
    const deprecated = p('sp-4-dep', 'SP-4', 'zh-tw', {
      status: 'deprecated',
      scores: passingScores,
    });
    const ids = getIndexPosts(cast([...all, deprecated]), 'zh-tw').map((post: any) => post.id);
    expect(ids).not.toContain('sp-4-dep');
  });
});

describe('getNavigablePosts', () => {
  const zh1 = p('sp-1-x', 'SP-1', 'zh-tw');
  const zh2 = p('sp-2-y', 'SP-2', 'zh-tw', { status: 'deprecated' });
  const all = [zh1, zh2];

  it('returns published list when current is in it', () => {
    const r = getNavigablePosts(cast(all), zh1 as any);
    expect(r.map((p: any) => p.id)).toEqual(['sp-1-x']);
  });

  it('appends current post if it is itself non-published', () => {
    const r = getNavigablePosts(cast(all), zh2 as any);
    expect(r.map((p: any) => p.id).sort()).toEqual(['sp-1-x', 'sp-2-y']);
  });
});

describe('getLocalizedPostUrl', () => {
  it('zh-tw post → /posts/<slug>', () => {
    expect(getLocalizedPostUrl(p('s', 'X-1', 'zh-tw') as any)).toBe('/posts/s');
  });
  it('en post → /en/posts/<slug>', () => {
    expect(getLocalizedPostUrl(p('s', 'X-1', 'en') as any)).toBe('/en/posts/s');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// post-versions
// ════════════════════════════════════════════════════════════════════════════
describe('getPostVersion', () => {
  it('returns "1" for unknown post', () => {
    expect(getPostVersion('does-not-exist-xyz')).toBe('1');
  });

  it('strips .mdx extension before lookup', () => {
    // Pick any real key from the manifest
    const v = getPostVersion('cp-203-20260324-catwu-ai-pm.mdx');
    expect(Number.parseInt(v, 10)).toBeGreaterThanOrEqual(1);
  });

  it('returns string representation of count', () => {
    const v = getPostVersion('cp-203-20260324-catwu-ai-pm');
    expect(typeof v).toBe('string');
    expect(v).toMatch(/^\d+$/);
  });
});
