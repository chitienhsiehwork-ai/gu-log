import { test, expect } from './fixtures';

/**
 * AI Popup Tests
 *
 * Tests for text selection popup with Ask AI / Edit with AI functionality.
 * Covers: popup visibility, login state, dismiss behavior, auth callback.
 * Run with: npx playwright test tests/ai-popup.spec.ts
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

/**
 * Helper: select text inside .post-content using JS (works on both desktop and mobile).
 * Uses Selection API to programmatically select text within the first paragraph.
 */
async function selectTextInContent(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const p = document.querySelector('.post-content p');
    if (!p || !p.firstChild) throw new Error('No post-content paragraph found');
    const range = document.createRange();
    const textNode = p.firstChild;
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(textNode.textContent?.length || 20, 20));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  // Trigger mouseup to fire the popup handler
  const content = page.locator('.post-content p').first();
  const box = await content.boundingBox();
  if (box) {
    await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'left' });
    // Re-select because click clears selection
    await page.evaluate(() => {
      const p = document.querySelector('.post-content p');
      if (!p || !p.firstChild) return;
      const range = document.createRange();
      const textNode = p.firstChild;
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(textNode.textContent?.length || 20, 20));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }
  // Dispatch mouseup to trigger the popup
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  // Wait for the setTimeout(10ms) in the handler
  await page.waitForTimeout(50);
}

test.describe('AI Popup - Desktop', () => {
  test.beforeEach(async () => {
    // These tests use mouse drag which only works on Desktop
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  test('GIVEN post page WHEN user selects text in post-content THEN popup appears with AI buttons', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const content = page.locator('.post-content p').first();
    await expect(content).toBeVisible();

    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box for content paragraph');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
  });

  test('GIVEN user is NOT logged in WHEN popup appears THEN it shows Login with GitHub button', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const content = page.locator('.post-content p').first();
    await expect(content).toBeVisible();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    const loginBtn = popup.locator('[data-action="login"]');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Login with GitHub');

    await expect(popup.locator('[data-action="ask"]')).not.toBeVisible();
    await expect(popup.locator('[data-action="edit"]')).not.toBeVisible();
  });

  test('GIVEN user IS logged in WHEN popup appears THEN it shows Ask AI and Edit buttons', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
      const token = header + '.' + payload + '.fake-signature';
      localStorage.setItem('gu-log-jwt', token);
    });
    await page.reload();

    const content = page.locator('.post-content p').first();
    await expect(content).toBeVisible();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    await expect(popup.locator('[data-action="ask"]')).toBeVisible();
    await expect(popup.locator('[data-action="edit"]')).toBeVisible();
    await expect(popup.locator('[data-action="login"]')).not.toBeVisible();
  });

  test('GIVEN popup is visible in button state WHEN user clicks outside THEN popup closes', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const content = page.locator('.post-content p').first();
    await expect(content).toBeVisible();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    await page.locator('header.site-header').click();
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  test('GIVEN popup is visible WHEN user presses Escape THEN popup closes', async ({ page }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const content = page.locator('.post-content p').first();
    await expect(content).toBeVisible();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  test('GIVEN selecting text outside post-content WHEN mouseup THEN popup does NOT appear', async ({
    page,
  }) => {
    await page.goto(TEST_POST);

    const header = page.locator('header.site-header').first();
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(300);
    const popup = page.locator('#ai-popup');
    await expect(popup).not.toBeVisible();
  });
});

test.describe('AI Popup - Mobile (programmatic selection)', () => {
  test('GIVEN mobile viewport WHEN text selected THEN popup shows as bottom sheet', async ({
    page,
  }) => {
    const isMobile = test.info().project.name === 'Mobile Chrome';
    if (!isMobile) {
      test.skip();
      return;
    }

    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();
    await expect(page.locator('.post-content p').first()).toBeVisible();

    await selectTextInContent(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup).toHaveClass(/ai-popup--mobile/);
  });

  test('GIVEN mobile viewport WHEN not logged in and text selected THEN shows login button', async ({
    page,
  }) => {
    const isMobile = test.info().project.name === 'Mobile Chrome';
    if (!isMobile) {
      test.skip();
      return;
    }

    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();
    await expect(page.locator('.post-content p').first()).toBeVisible();

    await selectTextInContent(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    const loginBtn = popup.locator('[data-action="login"]');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Login with GitHub');
  });
});

test.describe('Auth Callback', () => {
  test('GIVEN callback page with token param WHEN loaded THEN stores JWT in localStorage', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));

    await page.goto('/auth/callback?token=fake-jwt-token-12345');
    await page.waitForTimeout(200);

    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('fake-jwt-token-12345');
  });

  test('GIVEN callback page with hash token WHEN loaded THEN stores JWT in localStorage', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));

    await page.goto('/auth/callback#token=hash-jwt-token-67890');
    await page.waitForTimeout(200);

    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('hash-jwt-token-67890');
  });

  test('GIVEN callback page with no token WHEN loaded THEN shows error', async ({ page }) => {
    await page.goto('/auth/callback');
    await page.waitForTimeout(200);

    const status = page.locator('#status');
    await expect(status).toContainText('Login failed');

    const errorMsg = page.locator('#error');
    await expect(errorMsg).toBeVisible();
  });

  test('GIVEN return URL in localStorage WHEN callback succeeds THEN redirects to return URL', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('gu-log-jwt');
      localStorage.setItem('gu-log-return-url', '/posts/claude-is-a-space-to-think');
    });

    await page.goto('/auth/callback?token=redirect-test-token');

    await page.waitForURL('**/posts/claude-is-a-space-to-think', { timeout: 5000 });

    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('redirect-test-token');

    const returnUrl = await page.evaluate(() => localStorage.getItem('gu-log-return-url'));
    expect(returnUrl).toBeNull();
  });
});

test.describe('Login Indicator', () => {
  test('GIVEN user is not logged in WHEN page loads THEN login link is shown', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const indicator = page.locator('#login-indicator');
    await expect(indicator).toBeVisible();

    const loginLink = indicator.locator('.login-link');
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toContainText('Login');
  });

  test('GIVEN user is logged in WHEN page loads THEN user info and logout button shown', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'user@example.com' }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.sig');
    });
    await page.reload();

    const indicator = page.locator('#login-indicator');
    await expect(indicator).toBeVisible();

    const user = indicator.locator('.login-user');
    await expect(user).toBeVisible();
    await expect(user).toContainText('user@example.com');

    const logoutBtn = indicator.locator('.login-logout-btn');
    await expect(logoutBtn).toBeVisible();
  });

  test('GIVEN user is logged in WHEN logout clicked THEN JWT cleared and login link shown', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'user@example.com' }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.sig');
    });
    await page.reload();

    const indicator = page.locator('#login-indicator');
    await indicator.locator('.login-logout-btn').click();

    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBeNull();

    await expect(indicator.locator('.login-link')).toBeVisible();
  });
});
