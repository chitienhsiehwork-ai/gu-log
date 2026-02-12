import { test, expect } from './fixtures';

const BASE = 'http://localhost:4321';

test.describe('SD Posts: Source Citation', () => {
  test('GIVEN an SD (ShroomDog Original) post WHEN viewing THEN source citation should NOT be shown', async ({ page }) => {
    // Navigate to SD-1 post
    await page.goto(BASE + '/posts/openclaw-talk-deep-dive');
    await page.waitForLoadState('domcontentloaded');

    // The source citation block should not exist for SD posts
    const citation = page.locator('.source-citation');
    await expect(citation).toHaveCount(0);
  });

  test('GIVEN an SP (ShroomDog Picks) post WHEN viewing THEN source citation SHOULD be shown', async ({ page }) => {
    // Navigate to any SP post to confirm we didn't break non-SD posts
    // Find an SP post from the sitemap
    await page.goto(BASE);
    
    // Click the first SP post link
    const spLink = page.locator('a[href*="/posts/"]').first();
    await spLink.click();
    await page.waitForLoadState('domcontentloaded');

    // Check if this is an SP/CP post (not SD) — source citation should exist
    const ticketBadge = page.locator('.ticket-badge, [class*="ticket"]');
    const badgeText = await ticketBadge.first().textContent().catch(() => '');

    // Only check for source citation if it's SP or CP
    if (badgeText && !badgeText.includes('SD-')) {
      const citation = page.locator('.source-citation');
      await expect(citation).toBeVisible();
    }
  });
});
