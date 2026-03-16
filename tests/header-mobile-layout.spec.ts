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

  test('REGRESSION: nav icons must stay in a single row on mobile (no wrapping)', async ({
    page,
  }) => {
    // Test at multiple narrow widths to catch wrapping
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // All icon-btn elements inside .nav-icons must share the same Y position (± tolerance)
      const iconPositions = await page.locator('.nav-icons .icon-btn').evaluateAll((icons) =>
        icons.map((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        }),
      );

      expect(iconPositions.length).toBeGreaterThanOrEqual(4); // home, about, clawd-picks, briefs at minimum

      const firstTop = iconPositions[0].top;
      for (let i = 1; i < iconPositions.length; i++) {
        // Every icon's top should be within 5px of the first icon's top
        expect(
          Math.abs(iconPositions[i].top - firstTop),
          `Nav icon ${i} wrapped to a new row at viewport width ${width}px (top: ${iconPositions[i].top} vs first: ${firstTop})`,
        ).toBeLessThan(5);
      }
    }
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
