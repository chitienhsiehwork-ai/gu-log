import { test, expect } from './fixtures';

/**
 * BDD Tests for Table of Contents (TOC)
 * 
 * These tests ensure TOC functionality works correctly across devices.
 * Run with: npx playwright test tests/toc.spec.ts
 */

test.describe('Table of Contents', () => {
  // Use a post that definitely has TOC (multiple h2 headings)
  const testPostUrl = '/posts/claude-is-a-space-to-think';

  test.describe('Mobile TOC (@mobile)', () => {
    test.use({ viewport: { width: 390, height: 844 } }); // iPhone 13

    test('GIVEN a post with headings WHEN page loads THEN TOC toggle should be visible', async ({ page }) => {
      await page.goto(testPostUrl);
      
      const tocToggle = page.locator('.toc-mobile .toggle-header');
      await expect(tocToggle).toBeVisible();
    });

    test('GIVEN TOC is collapsed WHEN user clicks toggle THEN TOC should expand', async ({ page }) => {
      await page.goto(testPostUrl);
      
      const container = page.locator('.toc-mobile .toggle-container');
      const toggle = page.locator('.toc-mobile .toggle-header');
      
      // Verify initial state is collapsed
      await expect(container).toHaveAttribute('data-open', 'false');
      
      // Click to expand
      await toggle.click();
      
      // Verify expanded state
      await expect(container).toHaveAttribute('data-open', 'true');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    test('GIVEN TOC is expanded WHEN user clicks toggle THEN TOC should collapse', async ({ page }) => {
      await page.goto(testPostUrl);
      
      const container = page.locator('.toc-mobile .toggle-container');
      const toggle = page.locator('.toc-mobile .toggle-header');
      
      // Expand first
      await toggle.click();
      await expect(container).toHaveAttribute('data-open', 'true');
      
      // Click to collapse
      await toggle.click();
      
      // Verify collapsed state
      await expect(container).toHaveAttribute('data-open', 'false');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('GIVEN TOC is expanded WHEN user clicks a heading link THEN page should scroll to heading AND TOC should collapse', async ({ page }) => {
      await page.goto(testPostUrl);
      
      const container = page.locator('.toc-mobile .toggle-container');
      const toggle = page.locator('.toc-mobile .toggle-header');
      
      // Expand TOC
      await toggle.click();
      await expect(container).toHaveAttribute('data-open', 'true');
      
      // Click first heading link
      const firstLink = page.locator('.toc-mobile .toc-link').first();
      const targetId = await firstLink.getAttribute('data-heading-id');
      await firstLink.click();
      
      // Wait for scroll and collapse
      await page.waitForTimeout(500);
      
      // TOC should collapse
      await expect(container).toHaveAttribute('data-open', 'false');
      
      // URL should have hash (use decodeURIComponent for Chinese characters)
      const currentUrl = decodeURIComponent(page.url());
      expect(currentUrl).toContain(`#${targetId}`);
    });

    test('GIVEN TOC has heading links WHEN rendered THEN all links should have valid targets', async ({ page }) => {
      await page.goto(testPostUrl);
      
      // Expand TOC to see links
      await page.locator('.toc-mobile .toggle-header').click();
      
      const links = page.locator('.toc-mobile .toc-link');
      const count = await links.count();
      
      expect(count).toBeGreaterThan(0);
      
      // Check each link has a valid target
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const targetId = await link.getAttribute('data-heading-id');
        expect(targetId).toBeTruthy();
        
        // Verify target element exists
        const target = page.locator(`#${targetId}`);
        await expect(target).toBeAttached();
      }
    });
  });

  test.describe('Desktop TOC (@desktop)', () => {
    test.use({ viewport: { width: 1400, height: 900 } });

    test('GIVEN a post with headings WHEN page loads on desktop THEN sidebar TOC should be visible', async ({ page }) => {
      await page.goto(testPostUrl);
      
      const tocSidebar = page.locator('.toc-desktop');
      await expect(tocSidebar).toBeVisible();
    });

    test('GIVEN desktop TOC WHEN user scrolls THEN current section should be highlighted', async ({ page }) => {
      await page.goto(testPostUrl);
      
      // Wait for TOC to be ready
      await page.waitForSelector('.toc-desktop .toc-link');
      
      // Get all heading links
      const links = page.locator('.toc-desktop .toc-link');
      const count = await links.count();
      
      // At least one link should exist
      expect(count).toBeGreaterThan(0);
      
      // Scroll to bottom of page
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      
      // Some link should have active class after scrolling
      const activeLinks = page.locator('.toc-desktop .toc-link.active');
      const activeCount = await activeLinks.count();
      
      // At least one link should be active
      expect(activeCount).toBeGreaterThanOrEqual(1);
    });
  });
});
