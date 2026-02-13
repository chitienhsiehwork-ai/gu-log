import { test, expect } from './fixtures';

/**
 * LoginIndicator Tests
 * 
 * Tests the header login indicator (LoginIndicator.astro).
 * Covers: logged out link, logged in user display, logout, JWT parsing.
 */

test.describe('LoginIndicator', () => {
  test('GIVEN user is NOT logged in WHEN page loads THEN shows Login link', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const indicator = page.locator('#login-indicator');
    await expect(indicator).toBeVisible();

    const loginLink = indicator.locator('.login-link');
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toContainText('Login');
  });

  test('GIVEN user IS logged in WHEN page loads THEN shows user email', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'user@test.com', exp: 9999999999 }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake-sig');
    });
    await page.reload();

    const indicator = page.locator('#login-indicator');
    const userSpan = indicator.locator('.login-user');
    await expect(userSpan).toBeVisible();
    await expect(userSpan).toContainText('user@test.com');

    // Logout button should be visible
    await expect(indicator.locator('.login-logout-btn')).toBeVisible();
  });

  test('GIVEN logged in user WHEN clicking logout THEN clears JWT and shows login link', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'user@test.com' }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake');
    });
    await page.reload();

    // Click logout
    await page.locator('#logout-btn').click();

    // Should show login link now
    await expect(page.locator('#login-indicator .login-link')).toBeVisible();

    // JWT should be removed
    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBeNull();
  });

  test('GIVEN very long email WHEN displayed THEN truncates with ellipsis', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'averylongemail@verylongdomain.example.com' }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake');
    });
    await page.reload();

    const userSpan = page.locator('#login-indicator .login-user');
    await expect(userSpan).toBeVisible();
    
    // The displayed text should be truncated (component truncates to 14 chars + …)
    const displayText = await userSpan.textContent();
    // Content includes the emoji prefix "👤 "
    expect(displayText!.length).toBeLessThan(25);
  });
});
