import { test, expect } from './fixtures';

test.describe('Header mobile layout', () => {
  test('no horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
    await page.goto('/');
    // Wait for page load
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('Desktop: all items in one row, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Title and nav should be on the same row
    const titleBox = await page.locator('.site-title').boundingBox();
    const navEl = page.locator('.site-nav');
    await expect(navEl).toBeVisible();
    const navBox = await navEl.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    if (titleBox && navBox) {
      const titleMidY = titleBox.y + titleBox.height / 2;
      const navMidY = navBox.y + navBox.height / 2;
      expect(Math.abs(titleMidY - navMidY)).toBeLessThan(30);
    }
  });
});
