import { test, expect } from './fixtures';
import {
  isDesktopChromiumProject,
  isMobileProject,
  selectPostTextAndShowPopup,
} from './helpers/ai-popup';

/**
 * AI Popup Tests
 *
 * Tests for text selection popup with Ask AI / Edit with AI functionality.
 * Covers: popup visibility, login state, dismiss behavior, auth callback.
 * Run with: npx playwright test tests/ai-popup.spec.ts
 */

const TEST_POST = '/posts/gp-24-20260204-claude-is-a-space-to-think';

test.describe('AI Popup - Desktop', () => {
  test.beforeEach(async () => {
    // These tests use mouse drag which only works on Desktop
    test.skip(
      !isDesktopChromiumProject(test.info()),
      'Real mouse-drag coverage runs only on desktop Chromium'
    );
  });

  test('GIVEN post page WHEN user selects text in post-content THEN popup appears with AI buttons', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    await selectPostTextAndShowPopup(page, { method: 'mouse' });
  });

  test('GIVEN user is NOT logged in WHEN popup appears THEN it shows Login with GitHub button', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const popup = await selectPostTextAndShowPopup(page);

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

    const popup = await selectPostTextAndShowPopup(page);

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

    const popup = await selectPostTextAndShowPopup(page);

    await page.locator('header.site-header').click();
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  test('GIVEN text is selected WHEN pointerdown happens outside selection THEN selection is cleared', async ({
    page,
  }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const popup = await selectPostTextAndShowPopup(page);

    const before = await page.evaluate(() => window.getSelection()?.toString().trim().length || 0);
    expect(before).toBeGreaterThan(1);

    const header = page.locator('header.site-header').first();
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error('No header bounding box');

    const x = headerBox.x + Math.min(20, headerBox.width / 2);
    const y = headerBox.y + Math.min(20, headerBox.height / 2);

    await page.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y) || document.body;
        target.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerType: 'touch',
          })
        );
      },
      { x, y }
    );

    await page.waitForTimeout(50);

    const after = await page.evaluate(() => window.getSelection()?.toString().trim().length || 0);
    expect(after).toBe(0);
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  test('GIVEN popup is visible WHEN user presses Escape THEN popup closes', async ({ page }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    const popup = await selectPostTextAndShowPopup(page);

    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  test('GIVEN selecting text outside post-content WHEN mouseup THEN popup does NOT appear', async ({
    page,
  }) => {
    await page.goto(TEST_POST);

    await page
      .locator('header.site-header')
      .first()
      .evaluate((header) => {
        const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        const textNode = walker.nextNode();
        if (!textNode?.textContent) throw new Error('No selectable header text found');

        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(5, textNode.textContent.length));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

    await page.waitForTimeout(300);
    const popup = page.locator('#ai-popup');
    await expect(popup).not.toBeVisible();
  });
});

test.describe('AI Popup - File Path Wiring', () => {
  test('GIVEN a post page THEN AiPopup receives a real .mdx file path', async ({ page }) => {
    await page.goto(TEST_POST);

    const root = page.locator('#ai-popup-root');
    await expect(root).toHaveAttribute('data-file-path', /src\/content\/posts\/.*\.mdx$/);
  });
});

test.describe('AI Popup - Mobile (programmatic selection)', () => {
  test('GIVEN mobile viewport WHEN text selected THEN popup shows as bottom sheet', async ({
    page,
  }) => {
    test.skip(
      !isMobileProject(test.info()),
      'Mobile bottom-sheet coverage requires a mobile project'
    );

    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();
    await expect(page.locator('.post-content p').first()).toBeVisible();

    const popup = await selectPostTextAndShowPopup(page);
    await expect(popup).toHaveClass(/ai-popup--mobile/);
  });

  test('GIVEN mobile viewport WHEN not logged in and text selected THEN shows login button', async ({
    page,
  }) => {
    test.skip(
      !isMobileProject(test.info()),
      'Mobile bottom-sheet coverage requires a mobile project'
    );

    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();
    await expect(page.locator('.post-content p').first()).toBeVisible();

    const popup = await selectPostTextAndShowPopup(page);

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

    // Wait for localStorage to be populated
    await page.waitForFunction(() => !!localStorage.getItem('gu-log-jwt'));
    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('fake-jwt-token-12345');
  });

  test('GIVEN callback page with hash token WHEN loaded THEN stores JWT in localStorage', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));

    await page.goto('/auth/callback#token=hash-jwt-token-67890');

    // Wait for localStorage to be populated
    await page.waitForFunction(() => !!localStorage.getItem('gu-log-jwt'));
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
      localStorage.setItem('gu-log-return-url', '/posts/gp-24-20260204-claude-is-a-space-to-think');
    });

    await page.goto('/auth/callback?token=redirect-test-token');

    await page.waitForURL('**/posts/gp-24-20260204-claude-is-a-space-to-think', { timeout: 5000 });

    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('redirect-test-token');

    const returnUrl = await page.evaluate(() => localStorage.getItem('gu-log-return-url'));
    expect(returnUrl).toBeNull();
  });
});

test.describe('AI Popup - API Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Mock login
    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
      const token = header + '.' + payload + '.fake-signature';
      localStorage.setItem('gu-log-jwt', token);
    });
    await page.reload();
  });

  test('GIVEN logged in WHEN clicking Ask AI THEN shows input then result', async ({ page }) => {
    // Mock API
    await page.route('**/ai/ask', async (route) => {
      await new Promise((r) => setTimeout(r, 500)); // slight delay to show loading
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'This is a mock AI answer.' }),
      });
    });

    const popup = await selectPostTextAndShowPopup(page);

    // Click Ask AI → should show input box
    const askBtn = popup.locator('[data-action="ask"]');
    await askBtn.click();
    await expect(popup.locator('.ai-popup-question-input')).toBeVisible();

    // Submit (empty question) → should show result
    await popup.locator('[data-action="submit-ask"]').click();

    await expect(popup.locator('.ai-popup-result')).toBeVisible();
    await expect(popup.locator('.ai-popup-result-body')).toHaveText('This is a mock AI answer.');
  });

  test('GIVEN API error WHEN clicking Ask AI THEN shows error message', async ({ page }) => {
    // Mock API error
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Mock Server Error' }),
      });
    });

    const popup = await selectPostTextAndShowPopup(page);

    // Click Ask AI → input → submit
    await popup.locator('[data-action="ask"]').click();
    await expect(popup.locator('.ai-popup-question-input')).toBeVisible();
    await popup.locator('[data-action="submit-ask"]').click();

    // Should show error with detail
    const errorResult = popup.locator('.ai-popup-result--error');
    await expect(errorResult).toBeVisible({ timeout: 10000 });
    await expect(popup.locator('.ai-popup-error-text')).toContainText('Mock Server Error');
  });

  test('GIVEN logged in WHEN clicking Edit THEN shows instruction input then diff and confirm buttons', async ({
    page,
  }) => {
    // Mock API
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '- old text\n+ new text',
          editId: 'mock-edit-id-123',
        }),
      });
    });

    const popup = await selectPostTextAndShowPopup(page);

    // Click Edit
    await popup.locator('[data-action="edit"]').click();
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible();
    await popup.locator('.ai-popup-edit-input').fill('fix typo');
    await popup.locator('[data-action="submit-edit"]').click();

    // Should show diff
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();
    await expect(popup.locator('.ai-popup-diff-remove')).toContainText('- old text');
    await expect(popup.locator('.ai-popup-diff-add')).toContainText('+ new text');

    // Should show confirm/cancel buttons
    await expect(popup.locator('[data-action="confirm"]')).toBeVisible();
    await expect(popup.locator('.ai-popup-actions [data-action="close"]')).toBeVisible();
  });
});
