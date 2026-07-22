/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Live tests for the public /api JSON endpoints.
 *
 * /api/feed.json       — list of all published articles (no body)
 * /api/posts/[slug].json — full article body for one slug
 */
import { test, expect } from './fixtures';

test.describe('/api/feed.json', () => {
  test('returns 200 and well-shaped JSON', async ({ request }) => {
    const r = await request.get('/api/feed.json');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toMatch(/application\/json/);

    const body = await r.json();
    expect(body.schemaVersion).toBe(2);
    expect(body.version).toBeUndefined();
    expect(typeof body.generated).toBe('string');
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.articles)).toBe(true);
    expect(body.articles.length).toBe(body.count);
  });

  test('every article has the contracted fields', async ({ request }) => {
    const r = await request.get('/api/feed.json');
    const body = await r.json();
    for (const art of body.articles.slice(0, 20)) {
      expect(typeof art.slug).toBe('string');
      expect(art.title).toBeTruthy();
      expect(art.lang).toMatch(/^(zh-tw|en)$/);
      expect(art.url).toBe(art.lang === 'en' ? `/en/posts/${art.slug}` : `/posts/${art.slug}`);
      expect(art.ticketId).toMatch(/^(GP|MP|SD|Lv)-(?:\d+|PENDING)$/);
      expect(art.prefix).toBe(art.ticketId.split('-')[0]);
      expect(art.ticketId).not.toMatch(/^(SP|CP)-/);
      expect(art.slug).not.toMatch(/^(?:en-)?(?:sp|cp)-/);
      expect(Array.isArray(art.tags)).toBe(true);
    }
  });

  test('sets a cache-control header for CDN', async ({ request }) => {
    const r = await request.get('/api/feed.json');
    expect(r.headers()['cache-control']).toMatch(/max-age/);
  });

  test('articles are sorted newest-first', async ({ request }) => {
    const r = await request.get('/api/feed.json');
    const body = await r.json();
    const dates = body.articles.slice(0, 30).map((a: any) => {
      return new Date(a.translatedDate || a.originalDate).getTime();
    });
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });
});

test.describe('/api/posts/[slug].json', () => {
  test('returns the full article body for a known post', async ({ request }) => {
    const r = await request.get('/api/posts/mp-291-20260414-anthropic-.json');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.schemaVersion).toBe(2);
    expect(body.slug).toBe('mp-291-20260414-anthropic-');
    expect(body.ticketId).toBe('MP-291');
    expect(body.url).toBe('/posts/mp-291-20260414-anthropic-');
    expect(body.title).toBeTruthy();
    expect(typeof body.summary).toBe('string');
  });

  test('returns an English-localized URL for an English post', async ({ request }) => {
    const r = await request.get('/api/posts/en-gp-7-20260130-clawdbot-architecture-deep-dive.json');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.schemaVersion).toBe(2);
    expect(body.ticketId).toBe('GP-7');
    expect(body.url).toBe('/en/posts/en-gp-7-20260130-clawdbot-architecture-deep-dive');
  });

  test('returns 404 for unknown slug', async ({ request }) => {
    const r = await request.get('/api/posts/this-post-does-not-exist-xyz.json');
    expect(r.status()).toBe(404);
  });
});
