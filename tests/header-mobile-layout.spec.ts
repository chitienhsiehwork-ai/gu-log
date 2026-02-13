import { test, expect } from './fixtures';

test.describe('Header mobile layout', () => {
  test('no horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
    await page.goto('/');
    // Wait for login indicator to render (client-side JS)
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('Login button is on second row aligned to right', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    const loginEl = page.locator('#login-indicator');
    // Login should exist and be visible
    await expect(loginEl.first()).toBeVisible();

    // Login's right edge should be close to viewport right edge (allow padding)
    const box = await loginEl.first().boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const rightEdge = box.x + box.width;
      expect(rightEdge).toBeGreaterThan(390 - 40); // within 40px of right edge
    }
  });

  test('Login is below main nav items on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    // Find the first nav link (首頁) and Login
    const navLink = page.locator('nav a').first();
    const loginEl = page.locator('#login-indicator').first();

    const navBox = await navLink.boundingBox();
    const loginBox = await loginEl.boundingBox();
    expect(navBox).not.toBeNull();
    expect(loginBox).not.toBeNull();
    if (navBox && loginBox) {
      // Login's Y should be greater than nav link bottom (on a row below)
      expect(loginBox.y).toBeGreaterThan(navBox.y + navBox.height - 5);
    }
  });

  test('Desktop: all items in one row, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('#login-indicator', { state: 'visible', timeout: 5000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Title and nav should be on the same row
    const titleBox = await page.locator('.site-title').boundingBox();
    const navBox = await page.locator('.site-nav').boundingBox();
    expect(titleBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    if (titleBox && navBox) {
      const titleMidY = titleBox.y + titleBox.height / 2;
      const navMidY = navBox.y + navBox.height / 2;
      expect(Math.abs(titleMidY - navMidY)).toBeLessThan(30);
    }
  });
});
