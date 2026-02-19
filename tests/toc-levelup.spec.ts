import { test, expect } from './fixtures';

/**
 * TOC Tests for Level-Up (Lv) Series
 *
 * Lv-series posts use a "Floor N" structure:
 *   - h2 (##) = Floor N headings (main sections) → SHOULD appear in TOC
 *   - h3 (###) = Sub-sections within a floor → should NOT appear in TOC
 *
 * Regular posts should still show both h2 and h3 in TOC.
 *
 * Run with: npx playwright test tests/toc-levelup.spec.ts
 */

const LV_POSTS = [
  '/posts/levelup-20260213-01-oauth-complete-guide',
  '/posts/levelup-20260213-02-opensource-ai-collaboration',
  '/posts/levelup-20260213-03-one-domain-multi-services',
  '/posts/levelup-20260218-04-openclaw-gateway-core',
];

// A regular (non-Lv) post known to have both h2 and h3 headings
const REGULAR_POST_WITH_H3 = '/posts/clawdbot-architecture-deep-dive';

test.describe('Lv-series TOC: only Floor headings', () => {
  for (const postUrl of LV_POSTS) {
    const slug = postUrl.split('/').pop()!;

    test(`GIVEN Lv post "${slug}" WHEN rendered THEN TOC should contain NO h3 links`, async ({ page }) => {
      await page.goto(postUrl);

      // TOC exists in DOM (may be hidden on desktop due to position:fixed sidebar)
      const tocLinks = page.locator('.toc-link');
      const totalCount = await tocLinks.count();

      // Should have TOC links
      expect(totalCount, `Lv post "${slug}" should have TOC links`).toBeGreaterThan(0);

      // There should be zero toc-link-h3 entries
      const h3Links = page.locator('.toc-link-h3');
      const h3Count = await h3Links.count();
      expect(h3Count, `Lv post "${slug}" should have 0 h3 links in TOC, found ${h3Count}`).toBe(0);
    });

    test(`GIVEN Lv post "${slug}" WHEN rendered THEN all TOC links should be h2 level`, async ({ page }) => {
      await page.goto(postUrl);

      // Check mobile TOC (always in flow, reliable for assertions)
      const mobileLinks = page.locator('.toc-mobile .toc-link');
      const count = await mobileLinks.count();
      expect(count, 'Mobile TOC should have at least 2 entries').toBeGreaterThanOrEqual(2);

      // All TOC entries should be h2 level (toc-link-h2 class)
      for (let i = 0; i < count; i++) {
        const link = mobileLinks.nth(i);
        const classes = await link.getAttribute('class');
        expect(classes, `TOC link ${i} should have toc-link-h2 class`).toContain('toc-link-h2');
      }
    });
  }
});

test.describe('Regular post TOC: still shows h2 + h3', () => {
  test(`GIVEN a non-Lv post with h3 headings WHEN rendered THEN TOC should contain h3 links`, async ({ page }) => {
    await page.goto(REGULAR_POST_WITH_H3);

    // Check that h3 links exist in mobile TOC (in-flow, reliable)
    const h3Links = page.locator('.toc-mobile .toc-link-h3');
    const h3Count = await h3Links.count();
    expect(h3Count, 'Regular post should still have h3 links in TOC').toBeGreaterThan(0);
  });
});
