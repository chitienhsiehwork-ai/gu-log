import { test, expect } from './fixtures';
import {
  isDesktopChromiumProject,
  isMobileProject,
  selectPostText,
  selectPostTextAndShowPopup,
} from './helpers/ai-popup';

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

const TEST_POST = '/posts/gp-24-20260204-claude-is-a-space-to-think';

/** Helper to set up logged-in state and select text */
async function setupLoggedInWithSelection(page: import('@playwright/test').Page) {
  await page.goto(TEST_POST);
  await page.evaluate(() => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
    localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake-signature');
  });
  await page.reload();

  return selectPostTextAndShowPopup(page);
}

test.describe('AI Popup - Confirm Edit Flow', () => {
  test.describe.configure({ retries: 2 });

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
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible();
    await popup.locator('.ai-popup-edit-input').fill('make it clearer');
    await popup.locator('[data-action="submit-edit"]').click();
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();

    // Click Confirm
    await popup.locator('[data-action="confirm"]').click();

    // Should show committed state
    await expect(popup.locator('.ai-popup-committed')).toBeVisible();
    await expect(popup.locator('.ai-popup-committed')).toContainText('abc1234');
  });

  test('GIVEN edit result WHEN clicking Cancel THEN closes popup', async ({ page }) => {
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ diff: '- old\n+ new', editId: 'edit-456' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="edit"]').click();
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible();
    await popup.locator('.ai-popup-edit-input').fill('make it clearer');
    await popup.locator('[data-action="submit-edit"]').click();
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();

    // Click Cancel (which is data-action="close")
    const cancelBtn = popup.locator('.ai-popup-actions [data-action="close"]');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
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
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible();
    await popup.locator('.ai-popup-edit-input').fill('make it clearer');
    await popup.locator('[data-action="submit-edit"]').click();
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
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible();
    await popup.locator('.ai-popup-edit-input').fill('make it clearer');
    await popup.locator('[data-action="submit-edit"]').click();

    await expect(popup.locator('.ai-popup-result--error')).toBeVisible({ timeout: 10000 });
    await expect(popup.locator('.ai-popup-error-text')).toContainText('Edit generation failed');
  });
});

test.describe('AI Popup - Result State Interactions', () => {
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
    // Go through input step
    await expect(popup.locator('.ai-popup-question-input')).toBeVisible();
    await popup.locator('[data-action="submit-ask"]').click();
    await expect(popup.locator('.ai-popup-result')).toBeVisible();

    // Click close button
    await popup.locator('[data-action="close"]').click();
    await expect(popup).not.toBeVisible();
  });

  test('GIVEN result state WHEN clicking outside THEN popup stays (only button state closes on outside click)', async ({
    page,
  }) => {
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Persistent answer' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="ask"]').click();
    // Go through input step
    await expect(popup.locator('.ai-popup-question-input')).toBeVisible();
    await popup.locator('[data-action="submit-ask"]').click();
    await expect(popup.locator('.ai-popup-result')).toBeVisible();

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

    await page.waitForTimeout(100);

    // Popup should still be visible
    await expect(popup.locator('.ai-popup-result')).toBeVisible();
  });

  test('GIVEN result state WHEN pressing Escape THEN popup closes', async ({ page }) => {
    test.skip(
      !isDesktopChromiumProject(test.info()),
      'Desktop keyboard coverage runs only on desktop Chromium'
    );

    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Will be escaped' }),
      });
    });

    const popup = await setupLoggedInWithSelection(page);
    await popup.locator('[data-action="ask"]').click();
    // Go through input step
    await expect(popup.locator('.ai-popup-question-input')).toBeVisible();
    await popup.locator('[data-action="submit-ask"]').click();
    await expect(popup.locator('.ai-popup-result')).toBeVisible();

    // Escape should close even in result state
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
  });
});

test.describe('AI Popup - Short Selection Ignored', () => {
  test.beforeEach(async () => {
    test.skip(
      !isDesktopChromiumProject(test.info()),
      'Desktop mouse-selection coverage runs only on desktop Chromium'
    );
  });

  test('GIVEN post content WHEN selecting only 1 character THEN popup does NOT appear', async ({
    page,
  }) => {
    await page.goto(TEST_POST);

    await selectPostText(page, { characters: 1 });

    await page.waitForTimeout(200);
    const popup = page.locator('#ai-popup');
    await expect(popup).not.toBeVisible();
  });
});

test.describe('AI Popup - Login Redirect', () => {
  test('GIVEN not logged in WHEN clicking Login button THEN saves return URL', async ({ page }) => {
    await page.goto(TEST_POST);
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();

    // We need to intercept the navigation that Login button triggers
    // The login button navigates to apiUrl/auth/github, but we can check localStorage
    await page.route('**/auth/github', (route) => {
      // Don't actually navigate, just fulfill
      route.fulfill({ status: 200, body: 'Mock GitHub Auth' });
    });

    const popup = await selectPostTextAndShowPopup(page);

    await popup.locator('[data-action="login"]').click();

    await expect(page.locator('body')).toContainText('Mock GitHub Auth');
    await page.goBack();
    await page.waitForURL('**/posts/gp-24-20260204-claude-is-a-space-to-think');

    const savedUrl = await page.evaluate(() => localStorage.getItem('gu-log-return-url'));
    expect(savedUrl).toContain(TEST_POST);
  });
});

test.describe('AI Popup - Mobile Edit Flow', () => {
  test.beforeEach(async () => {
    test.skip(!isMobileProject(test.info()), 'Mobile edit coverage requires a mobile project');
  });

  test('GIVEN mobile bottom sheet WHEN editing and confirming THEN flow stays stable and shows committed state', async ({
    page,
  }) => {
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ diff: '- old text\n+ polished text', editId: 'mobile-edit-123' }),
      });
    });

    await page.route('**/ai/edit/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commitHash: 'mobile1234567' }),
      });
    });

    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
      localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake-signature');
    });
    await page.reload();

    const popup = await selectPostTextAndShowPopup(page);
    await expect(popup).toHaveClass(/ai-popup--mobile/);

    await popup.locator('[data-action="edit"]').click();
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible();
    await popup.locator('.ai-popup-edit-input').fill('make it punchier');
    await popup.locator('[data-action="submit-edit"]').click();
    await expect(popup.locator('.ai-popup-diff')).toBeVisible();
    await expect(popup.locator('.ai-popup-selection')).toBeVisible();

    await popup.locator('[data-action="confirm"]').click();
    await expect(popup.locator('.ai-popup-committed')).toBeVisible();
    await expect(popup.locator('.ai-popup-committed')).toContainText('mobile1');
  });
});
