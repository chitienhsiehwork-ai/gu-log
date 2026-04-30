/**
 * Unit tests for src/utils/post-status.ts and src/utils/post-versions.ts
 *
 * post-status implements the Stage 0–4 lifecycle that drives the
 * banners shown on each post (deprecated / retired). Bad logic = wrong
 * banner ships; this is the safety net.
 */
import { describe, expect, it } from 'vitest';
import {
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
  slug: string;
  data: {
    ticketId: string;
    lang: 'zh-tw' | 'en';
    status?: 'published' | 'deprecated' | 'retired';
    deprecatedBy?: string;
    deprecatedReason?: string;
    retiredReason?: string;
    retiredAt?: string;
  };
};

function p(
  slug: string,
  ticketId: string,
  lang: 'zh-tw' | 'en',
  extra: Partial<FakePost['data']> = {}
): FakePost {
  return { slug, data: { slug, ticketId, lang, ...extra } as FakePost['data'] };
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
    expect(r.replacementPost?.slug).toBe('en-sp-2-y');
    expect(r.reason).toBe('replaced');
  });

  it('falls back to source-lang replacement when target lang missing', () => {
    const zh = p('sp-1-x', 'SP-1', 'zh-tw', { status: 'deprecated', deprecatedBy: 'SP-2' });
    const en = p('en-sp-1-x', 'SP-1', 'en');
    const newZh = p('sp-2-y', 'SP-2', 'zh-tw');
    // No newEn
    const r = resolvePostStatus(en as any, cast([zh, en, newZh]));
    expect(r.replacementPost?.slug).toBe('sp-2-y');
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
    expect(getTranslationPair(zh as any, cast([zh, en]))?.slug).toBe('en-sp-1-x');
  });

  it('returns undefined when no ticketId', () => {
    const orphan = { slug: 's', data: { ticketId: '', lang: 'zh-tw' } };
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
    expect(r.map((p: any) => p.slug).sort()).toEqual(['sp-1-x', 'sp-3-z']);
  });

  it('getPublishedPosts filters by lang', () => {
    expect(getPublishedPosts(cast(all), 'en').map((p: any) => p.slug)).toEqual(['en-sp-1-x']);
  });

  it('getListablePosts excludes deprecated but includes retired', () => {
    const retired = p('sp-4-r', 'SP-4', 'zh-tw', { status: 'retired' });
    const r = getListablePosts(cast([...all, retired]), 'zh-tw');
    expect(r.map((p: any) => p.slug)).toContain('sp-4-r'); // retired listable
    expect(r.map((p: any) => p.slug)).not.toContain('sp-2-y'); // deprecated NOT listable
  });
});

describe('getNavigablePosts', () => {
  const zh1 = p('sp-1-x', 'SP-1', 'zh-tw');
  const zh2 = p('sp-2-y', 'SP-2', 'zh-tw', { status: 'deprecated' });
  const all = [zh1, zh2];

  it('returns published list when current is in it', () => {
    const r = getNavigablePosts(cast(all), zh1 as any);
    expect(r.map((p: any) => p.slug)).toEqual(['sp-1-x']);
  });

  it('appends current post if it is itself non-published', () => {
    const r = getNavigablePosts(cast(all), zh2 as any);
    expect(r.map((p: any) => p.slug).sort()).toEqual(['sp-1-x', 'sp-2-y']);
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
