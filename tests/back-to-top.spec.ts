import { test, expect } from '@playwright/test';

test.describe('BackToTop Button', () => {
  test('should only have one back-to-top button when scrolling', async ({ page }) => {
    // Navigate to a long article page
    await page.goto('/posts/clawd-picks-20260203-bcherny-workflow');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Count initial back-to-top buttons (should be exactly 1)
    const buttons = page.locator('#back-to-top');
    await expect(buttons).toHaveCount(1);

    // Scroll down to trigger button visibility
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    // After scrolling, should still only have 1 button
    await expect(buttons).toHaveCount(1);

    // The button should be visible now
    const button = page.locator('#back-to-top');
    await expect(button).toBeVisible();
    await expect(button).toHaveClass(/visible/);
  });

  test('back-to-top button should have fixed positioning', async ({ page }) => {
    await page.goto('/posts/clawd-picks-20260203-bcherny-workflow');
    await page.waitForLoadState('networkidle');

    // Scroll to make button visible
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    const button = page.locator('#back-to-top');

    // Check computed style is fixed
    const position = await button.evaluate((el) => {
      return window.getComputedStyle(el).position;
    });

    expect(position).toBe('fixed');
  });

  test('back-to-top button should stay in viewport corner when scrolling', async ({ page }) => {
    await page.goto('/posts/clawd-picks-20260203-bcherny-workflow');
    await page.waitForLoadState('networkidle');

    // Scroll to make button visible
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    const button = page.locator('#back-to-top');

    // Get button position relative to viewport
    const box1 = await button.boundingBox();
    expect(box1).not.toBeNull();

    // Scroll more
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(300);

    // Button should still be in same viewport position (fixed)
    const box2 = await button.boundingBox();
    expect(box2).not.toBeNull();

    // Positions should be the same (within viewport)
    expect(box1!.x).toBeCloseTo(box2!.x, 1);
    expect(box1!.y).toBeCloseTo(box2!.y, 1);
  });

  test('no duplicate back-to-top elements in DOM', async ({ page }) => {
    await page.goto('/posts/clawd-picks-20260203-bcherny-workflow');
    await page.waitForLoadState('networkidle');

    // Check for any elements that look like back-to-top buttons
    const allBackToTopElements = page.locator('.back-to-top');
    await expect(allBackToTopElements).toHaveCount(1);

    // Also check by aria-label
    const byAriaLabel = page.locator('[aria-label="返回頂部"], [aria-label="Back to top"]');
    await expect(byAriaLabel).toHaveCount(1);
  });
});
