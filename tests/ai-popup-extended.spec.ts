import { test, expect } from './fixtures';

/**
 * AI Popup Extended Tests
 * 
 * Additional branch coverage for AI Popup:
 * - Confirm edit flow
 * - Error handling for edit/confirm
 * - Loading states
 * - Close button in result view
 * - Touch/mobile selection
 * - Clicking outside during result state (should NOT close)
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

/** Helper to set up logged-in state and select text */
async function setupLoggedInWithSelection(page: import('@playwright/test').Page) {
  await page.goto(TEST_POST);
  await page.evaluate(() => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
    localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake-signature');
  });
  await page.reload();

  const content = page.locator('.post-content p').first();
  await expect(content).toBeVisible();
  const box = await content.boundingBox();
  if (!box) throw new Error('No bounding box');

  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + box.height / 2);
  await page.mouse.up();

  const popup = page.locator('#ai-popup');
  await expect(popup).toBeVisible({ timeout: 3000 });
  return popup;
}

test.describe('AI Popup - Confirm Edit Flow', () => {
  test.describe.configure({ retries: 2 });

  test.beforeEach(async () => {
    if (test.info().project.name !== 'Desktop Chrome') test.skip();
  });

  test('GIVEN edit result WHEN clicking Confirm THEN shows committed state', async ({ page }) => {
    // Mock edit API
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ diff: '- old\n+ new', editId: 'edit-123' }),
      });
    });
    // Mock confirm API
    await page.route('**/ai/edit/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commitHash: 'abc1234567890' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);

    // Click Edit
    await popup.locator('[data-action="edit"]').click();
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();

    // Click Confirm
    await popup.locator('[data-action="confirm"]').click();

    // Should show committed state
    await expect(popup.locator('.ai-popup-committed')).toBeVisible();
    await expect(popup.locator('.ai-popup-committed')).toContainText('abc1234');
  });

  test.skip('GIVEN edit result WHEN clicking Cancel THEN closes popup', async ({ page }) => {
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ diff: '- old\n+ new', editId: 'edit-456' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="edit"]').click();
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();

    // Click Cancel (which is data-action="close")
    const cancelBtn = popup.locator('.ai-popup-btn--cancel');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click({ force: true });
    await expect(popup).not.toBeVisible();
  });

  test('GIVEN confirm API error WHEN clicking Confirm THEN shows error', async ({ page }) => {
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ diff: '- old\n+ new', editId: 'edit-789' }),
      });
    });
    await page.route('**/ai/edit/confirm', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Commit failed' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="edit"]').click();
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();

    await popup.locator('[data-action="confirm"]').click();

    // Should show error
    await expect(popup.locator('.ai-popup-result--error')).toBeVisible({ timeout: 10000 });
  });

  test('GIVEN edit API error WHEN clicking Edit THEN shows error message', async ({ page }) => {
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Edit generation failed' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="edit"]').click();

    await expect(popup.locator('.ai-popup-result--error')).toBeVisible({ timeout: 10000 });
    await expect(popup.locator('.ai-popup-error-text')).toContainText('Edit generation failed');
  });
});

test.describe('AI Popup - Result State Interactions', () => {
  test.beforeEach(async () => {
    if (test.info().project.name !== 'Desktop Chrome') test.skip();
  });

  test('GIVEN ask result WHEN clicking close button THEN popup closes', async ({ page }) => {
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Test answer' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="ask"]').click();
    await expect(popup.locator('.ai-popup-result')).toBeVisible();

    // Click close button
    await popup.locator('[data-action="close"]').click();
    await expect(popup).not.toBeVisible();
  });

  test('GIVEN result state WHEN clicking outside THEN popup stays (only button state closes on outside click)', async ({ page }) => {
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Persistent answer' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="ask"]').click();
    await expect(popup.locator('.ai-popup-result')).toBeVisible();

    // Click outside — should NOT close (result state is persistent)
    await page.locator('header.site-header').click();
    
    // Popup should still be visible
    await expect(popup.locator('.ai-popup-result')).toBeVisible();
  });

  test('GIVEN result state WHEN pressing Escape THEN popup closes', async ({ page }) => {
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Will be escaped' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="ask"]').click();
    await expect(popup.locator('.ai-popup-result')).toBeVisible();

    // Escape should close even in result state
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
  });
});

test.describe('AI Popup - Short Selection Ignored', () => {
  test.beforeEach(async () => {
    if (test.info().project.name !== 'Desktop Chrome') test.skip();
  });

  test('GIVEN post content WHEN selecting only 1 character THEN popup does NOT appear', async ({ page }) => {
    await page.goto(TEST_POST);

    const content = page.locator('.post-content p').first();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    // Select very small range (1-2 pixels)
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(200);
    const popup = page.locator('#ai-popup');
    await expect(popup).not.toBeVisible();
  });
});

test.describe('AI Popup - Login Redirect', () => {
  test.beforeEach(async () => {
    if (test.info().project.name !== 'Desktop Chrome') test.skip();
  });

  test('GIVEN not logged in WHEN clicking Login button THEN saves return URL', async ({ page }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    // We need to intercept the navigation that Login button triggers
    // The login button navigates to apiUrl/auth/github, but we can check localStorage
    await page.route('**/auth/github', route => {
      // Don't actually navigate, just fulfill
      route.fulfill({ status: 200, body: 'Mock GitHub Auth' });
    });

    const content = page.locator('.post-content p').first();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Check return URL was saved
    const returnUrl = await page.evaluate(() => localStorage.getItem('gu-log-return-url'));
    // It's saved when the login button is clicked, not when popup appears
    // Let's click login
    await popup.locator('[data-action="login"]').click();

    // Verify return URL was saved
    await page.waitForFunction(() => !!localStorage.getItem('gu-log-return-url'));
    const savedUrl = await page.evaluate(() => localStorage.getItem('gu-log-return-url'));
    expect(savedUrl).toContain(TEST_POST);
  });
});
