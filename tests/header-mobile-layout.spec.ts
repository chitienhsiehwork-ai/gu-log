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

  test('REGRESSION: nav icons must stay in a single row on mobile, pixel-aligned', async ({
    page,
  }) => {
    // Test at multiple narrow widths including iPhone SE (320)
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Get ALL interactive elements inside .nav-icons (links, buttons — everything)
      const iconPositions = await page
        .locator('.nav-icons > a, .nav-icons > button, .nav-icons > *')
        .evaluateAll((els) =>
          els
            .filter((el) => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                tag: el.tagName,
                class: el.className,
                top: rect.top,
                centerY: rect.top + rect.height / 2,
                height: rect.height,
                width: rect.width,
              };
            }),
        );

      // Must have at least 6 visible nav items (home, about, clawd-picks, briefs, lang, search, theme)
      expect(
        iconPositions.length,
        `Expected ≥6 visible nav items at ${width}px, got ${iconPositions.length}`,
      ).toBeGreaterThanOrEqual(6);

      // All icons must be on the same row: centerY within 2px tolerance (pixel-perfect)
      const firstCenterY = iconPositions[0].centerY;
      for (let i = 1; i < iconPositions.length; i++) {
        expect(
          Math.abs(iconPositions[i].centerY - firstCenterY),
          `Nav item "${iconPositions[i].class}" misaligned at ${width}px: centerY ${iconPositions[i].centerY.toFixed(1)} vs first ${firstCenterY.toFixed(1)}`,
        ).toBeLessThan(2);
      }

      // All icon containers should have equal dimensions (±2px tolerance)
      const firstHeight = iconPositions[0].height;
      const firstWidth = iconPositions[0].width;
      for (let i = 1; i < iconPositions.length; i++) {
        expect(
          Math.abs(iconPositions[i].height - firstHeight),
          `Nav item "${iconPositions[i].class}" height mismatch at ${width}px: ${iconPositions[i].height} vs ${firstHeight}`,
        ).toBeLessThan(2);
        expect(
          Math.abs(iconPositions[i].width - firstWidth),
          `Nav item "${iconPositions[i].class}" width mismatch at ${width}px: ${iconPositions[i].width} vs ${firstWidth}`,
        ).toBeLessThan(2);
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
