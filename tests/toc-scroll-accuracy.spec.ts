import { test, expect } from '@playwright/test';

/**
 * BDD Tests for TOC Scroll Accuracy
 * 
 * Reproduces: clicking a TOC link on mobile scrolls to a position
 * 1-2 screens off from the target heading.
 * 
 * Root cause hypothesis: scroll position is calculated before
 * images/lazy content finish loading, causing getBoundingClientRect()
 * to return incorrect values. On mobile, this is amplified by
 * dynamic viewport height (address bar shrink/grow on iOS Safari).
 * 
 * Run with: npx playwright test tests/toc-scroll-accuracy.spec.ts
 */

// Use a long post with many sections (Obsidian CLI article has 15+ headings)
const LONG_POST_URL = '/posts/shroom-picks-20260211-obsidian-cli-ai-era';
// Fallback to a known long post if the above doesn't exist
const FALLBACK_POST_URL = '/posts/shroom-picks-20260205-dejavucoder-prompt-caching-part1-tips';

// Maximum acceptable offset (in px) between target heading and viewport top
// With scroll-padding-top of 80px, heading should appear ~80px from top
// Allow 150px tolerance for dynamic elements (progress bar, etc.)
const MAX_ACCEPTABLE_OFFSET = 230; // 80px padding + 150px tolerance

test.describe('TOC Scroll Accuracy', () => {

  test.describe('Mobile — iPhone viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } }); // iPhone 13

    test('GIVEN a long post WHEN clicking the LAST TOC item THEN the target heading should be visible near viewport top', async ({ page }) => {
      // Try long post, fallback if not found
      const response = await page.goto(LONG_POST_URL);
      if (!response || response.status() === 404) {
        await page.goto(FALLBACK_POST_URL);
      }

      // Wait for all content to fully load (images, fonts, etc.)
      await page.waitForLoadState('networkidle');

      // Open mobile TOC
      const tocToggle = page.locator('.toc-mobile .toc-toggle-header');
      await tocToggle.click();
      await page.waitForTimeout(300); // wait for expand animation

      // Get all TOC links
      const tocLinks = page.locator('.toc-mobile .toc-link');
      const linkCount = await tocLinks.count();
      expect(linkCount).toBeGreaterThan(3); // need a post with multiple sections

      // Click the LAST TOC link (most likely to be off-target)
      const lastLink = tocLinks.last();
      const targetId = await lastLink.getAttribute('data-heading-id');
      expect(targetId).toBeTruthy();

      await lastLink.click();

      // Wait for smooth scroll to complete
      await page.waitForTimeout(1500);

      // Check: is the target heading visible and near the viewport top?
      const headingBox = await page.locator(`#${targetId}`).boundingBox();
      expect(headingBox, `Target heading #${targetId} should exist on page`).toBeTruthy();

      // The heading's top should be within acceptable range of viewport top
      // (positive = below top, negative = above/scrolled past)
      const headingTop = headingBox!.y;
      
      expect(
        headingTop,
        `Heading #${targetId} is at y=${headingTop}px — expected within 0-${MAX_ACCEPTABLE_OFFSET}px of viewport top. ` +
        `If y is much larger (e.g., 500+), the scroll didn't go far enough. ` +
        `If y is very negative, it scrolled too far.`
      ).toBeGreaterThanOrEqual(-50); // allow 50px overshoot
      
      expect(
        headingTop,
        `Heading #${targetId} is at y=${headingTop}px — more than ${MAX_ACCEPTABLE_OFFSET}px from top. ` +
        `Scroll destination is off by ~${Math.round(headingTop - 80)}px.`
      ).toBeLessThanOrEqual(MAX_ACCEPTABLE_OFFSET);
    });

    test('GIVEN a long post WHEN clicking a MIDDLE TOC item THEN the target heading should be visible near viewport top', async ({ page }) => {
      const response = await page.goto(LONG_POST_URL);
      if (!response || response.status() === 404) {
        await page.goto(FALLBACK_POST_URL);
      }

      await page.waitForLoadState('networkidle');

      // Open mobile TOC
      await page.locator('.toc-mobile .toc-toggle-header').click();
      await page.waitForTimeout(300);

      // Get middle TOC link
      const tocLinks = page.locator('.toc-mobile .toc-link');
      const linkCount = await tocLinks.count();
      const middleIndex = Math.floor(linkCount / 2);
      const middleLink = tocLinks.nth(middleIndex);
      const targetId = await middleLink.getAttribute('data-heading-id');
      expect(targetId).toBeTruthy();

      await middleLink.click();
      await page.waitForTimeout(1500);

      const headingBox = await page.locator(`#${targetId}`).boundingBox();
      expect(headingBox).toBeTruthy();

      const headingTop = headingBox!.y;
      expect(
        headingTop,
        `Middle heading #${targetId} at y=${headingTop}px, expected 0-${MAX_ACCEPTABLE_OFFSET}px`
      ).toBeGreaterThanOrEqual(-50);
      expect(
        headingTop,
        `Middle heading #${targetId} at y=${headingTop}px, scroll off by ~${Math.round(headingTop - 80)}px`
      ).toBeLessThanOrEqual(MAX_ACCEPTABLE_OFFSET);
    });

    test('GIVEN a post WHEN clicking FIRST TOC item from bottom of page THEN the target heading should be visible near viewport top', async ({ page }) => {
      const response = await page.goto(LONG_POST_URL);
      if (!response || response.status() === 404) {
        await page.goto(FALLBACK_POST_URL);
      }

      await page.waitForLoadState('networkidle');

      // First, scroll to bottom of page
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      // Scroll back up to TOC and open it
      await page.locator('.toc-mobile .toc-toggle-header').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.locator('.toc-mobile .toc-toggle-header').click();
      await page.waitForTimeout(300);

      // Click the FIRST TOC link (scrolling UP from bottom)
      const firstLink = page.locator('.toc-mobile .toc-link').first();
      const targetId = await firstLink.getAttribute('data-heading-id');
      expect(targetId).toBeTruthy();

      await firstLink.click();
      await page.waitForTimeout(1500);

      const headingBox = await page.locator(`#${targetId}`).boundingBox();
      expect(headingBox).toBeTruthy();

      const headingTop = headingBox!.y;
      expect(
        headingTop,
        `First heading #${targetId} (scrolling UP) at y=${headingTop}px, expected 0-${MAX_ACCEPTABLE_OFFSET}px`
      ).toBeGreaterThanOrEqual(-50);
      expect(
        headingTop,
        `First heading #${targetId} (scrolling UP) at y=${headingTop}px, scroll off by ~${Math.round(headingTop - 80)}px`
      ).toBeLessThanOrEqual(MAX_ACCEPTABLE_OFFSET);
    });

    test('GIVEN a post with images WHEN clicking a TOC item below images THEN scroll should account for loaded image heights', async ({ page }) => {
      const response = await page.goto(LONG_POST_URL);
      if (!response || response.status() === 404) {
        await page.goto(FALLBACK_POST_URL);
      }

      // Wait for FULL load including images
      await page.waitForLoadState('networkidle');
      // Extra wait for any lazy-loaded images to settle
      await page.waitForTimeout(1000);

      // Open TOC and click last link
      await page.locator('.toc-mobile .toc-toggle-header').click();
      await page.waitForTimeout(300);

      const lastLink = page.locator('.toc-mobile .toc-link').last();
      const targetId = await lastLink.getAttribute('data-heading-id');

      // Record page height before click
      const pageHeightBefore = await page.evaluate(() => document.body.scrollHeight);

      await lastLink.click();
      await page.waitForTimeout(1500);

      // Check if page height changed (images loaded during scroll)
      const pageHeightAfter = await page.evaluate(() => document.body.scrollHeight);
      const heightDrift = Math.abs(pageHeightAfter - pageHeightBefore);

      const headingBox = await page.locator(`#${targetId}`).boundingBox();
      expect(headingBox).toBeTruthy();

      const headingTop = headingBox!.y;

      // Log drift for debugging
      if (heightDrift > 50) {
        console.log(`⚠️  Page height changed by ${heightDrift}px during scroll (lazy content loaded)`);
      }

      expect(
        headingTop,
        `Last heading #${targetId} at y=${headingTop}px (height drift: ${heightDrift}px)`
      ).toBeGreaterThanOrEqual(-50);
      expect(
        headingTop,
        `Last heading #${targetId} at y=${headingTop}px — off by ~${Math.round(headingTop - 80)}px`
      ).toBeLessThanOrEqual(MAX_ACCEPTABLE_OFFSET);
    });
  });
});
