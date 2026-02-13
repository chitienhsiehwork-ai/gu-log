import { test, expect } from './fixtures';

test.describe('Header mobile layout - no horizontal overflow', () => {

  test('mobile viewport should not have horizontal overflow', async ({ page }) => {
    // iPhone 14 viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    // Wait for login indicator to render (it's client-side JS)
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    const overflow = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test('login element should be visible and within viewport on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    const loginBox = await page.locator('#login-indicator').boundingBox();
    expect(loginBox).not.toBeNull();
    // Login element right edge should not exceed viewport width
    expect(loginBox!.x + loginBox!.width).toBeLessThanOrEqual(390);
    // Login element should not be at negative x
    expect(loginBox!.x).toBeGreaterThanOrEqual(0);
  });

  test('desktop viewport should show all header elements in a single row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    // All nav items should be on the same vertical line (same row)
    const headerBox = await page.locator('.site-header').boundingBox();
    const navBox = await page.locator('.site-nav').boundingBox();
    const titleBox = await page.locator('.site-title').boundingBox();

    expect(headerBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(titleBox).not.toBeNull();

    // Title and nav should vertically overlap (same row)
    const titleMidY = titleBox!.y + titleBox!.height / 2;
    const navMidY = navBox!.y + navBox!.height / 2;
    // They should be within reasonable distance (same row = within 30px)
    expect(Math.abs(titleMidY - navMidY)).toBeLessThan(30);

    // No horizontal overflow on desktop either
    const overflow = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});
