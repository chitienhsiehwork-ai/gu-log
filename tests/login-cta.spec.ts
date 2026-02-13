import { test, expect } from './fixtures';

/**
 * Tests for LoginCta Component
 * 
 * LoginCta appears at the bottom of posts to encourage login for AI features.
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

test.describe('LoginCta Component', () => {
  test('GIVEN user is not logged in WHEN page loads THEN shows call-to-action with login button', async ({ page }) => {
    await page.goto(TEST_POST, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Wait for client-side hydration
    await page.waitForSelector('[data-login-cta]', { state: 'visible' });

    const cta = page.locator('[data-login-cta]');
    await expect(cta).toBeVisible();
    
    // Should show login button
    const loginBtn = cta.locator('.github-login-btn');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Login with GitHub');
    
    // Should show feature list
    await expect(cta).toContainText('Ask AI');
    await expect(cta).toContainText('Edit');
  });

  test('GIVEN user is logged in WHEN page loads THEN shows user info and logout button', async ({ page }) => {
    await page.goto(TEST_POST, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'tester@example.com' }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.sig');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    await page.waitForSelector('[data-login-cta]', { state: 'visible' });
    const cta = page.locator('[data-login-cta]');
    
    // Should show email
    await expect(cta).toContainText('tester@example.com');
    await expect(cta).toContainText('已登入'); // or 'Logged in as' depending on lang
    
    // Should show logout button
    const logoutBtn = cta.locator('.cta-logout');
    await expect(logoutBtn).toBeVisible();
    
    // Login button should NOT be visible
    await expect(cta.locator('.github-login-btn')).not.toBeVisible();
  });

  test('GIVEN user is logged in WHEN logout clicked THEN switches to logged out state', async ({ page }) => {
    await page.goto(TEST_POST, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'tester@example.com' }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.sig');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    await page.waitForSelector('[data-login-cta]', { state: 'visible' });
    
    // Click logout
    await page.locator('.cta-logout').click();
    
    // Wait for update
    await expect(page.locator('.github-login-btn')).toBeVisible();
    
    // Check localStorage
    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBeNull();
  });
});
