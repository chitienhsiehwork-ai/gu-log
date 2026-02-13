import { test, expect } from '@playwright/test';

test.describe('Login placement', () => {
  // Header tests
  test('no Login in header on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    // header 區域內不應該有 Login 文字或連結
    const headerLogin = page.locator('header').getByText('Login');
    await expect(headerLogin).not.toBeVisible();
  });

  test('no horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  // Article footer CTA tests (use a known article page)
  test('Login CTA visible at end of article', async ({ page }) => {
    // Navigate to any article
    await page.goto('/'); // go to homepage first
    // Click first article link
    const firstArticle = page.locator('a[href*="/posts/"]').first();
    if (await firstArticle.isVisible()) {
      await firstArticle.click();
      await page.waitForLoadState('networkidle');
    }
    // The login CTA should be visible at bottom
    const loginCta = page.locator('[data-login-cta], .login-cta');
    await expect(loginCta).toBeVisible();
  });

  test('Login CTA has GitHub login button when not logged in', async ({ page }) => {
    await page.goto('/');
    const firstArticle = page.locator('a[href*="/posts/"]').first();
    if (await firstArticle.isVisible()) {
      await firstArticle.click();
      await page.waitForLoadState('networkidle');
    }
    const githubBtn = page.locator('[data-login-cta] a, .login-cta a').filter({ hasText: /Login|GitHub/i });
    await expect(githubBtn.first()).toBeVisible();
  });
});
