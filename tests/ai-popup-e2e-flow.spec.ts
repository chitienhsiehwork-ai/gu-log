import { test, expect } from './fixtures';

/**
 * AI Popup – Full E2E Flow Tests
 *
 * Tests the complete user interaction flow of the AI popup component
 * with mocked API responses. Covers happy paths, error handling, and edge cases.
 *
 * Run with: npx playwright test tests/ai-popup-e2e-flow.spec.ts
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

/** Select text in .post-content and trigger popup via touchend */
async function selectAndShowPopup(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const p = document.querySelector('.post-content p');
    if (!p || !p.firstChild) throw new Error('No post-content paragraph found');
    const range = document.createRange();
    const textNode = p.firstChild;
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(textNode.textContent?.length || 30, 30));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.evaluate(() => {
    document.dispatchEvent(new Event('touchend', { bubbles: true }));
  });
  await page.waitForTimeout(100);
}

/** Set a fake JWT so the user appears logged in */
async function loginWithFakeJWT(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
    localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake');
  });
}

test.describe('AI Popup – E2E Flow (Desktop Chrome)', () => {
  test.beforeEach(async () => {
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  test('Happy path: Ask AI flow', async ({ page }) => {
    // Mock the /ai/ask API
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'This is a mock AI response about the selected text.' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    // Select text and show popup
    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup).toHaveClass(/ai-popup--desktop/);

    // Click Ask AI button
    await popup.locator('[data-action="ask"]').click();
    await page.waitForTimeout(200);

    // Should show input and selected text quote
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();

    const context = popup.locator('.ai-popup-selected-context');
    await expect(context).toBeVisible();

    // Type question and submit
    await input.fill('What does this mean?');
    await popup.locator('[data-action="submit-ask"]').click();

    // Loading spinner may appear briefly (or response may be immediate with mock)
    // Either way, wait for the result to be displayed
    const resultBody = popup.locator('.ai-popup-result-body');
    await expect(resultBody).toBeVisible({ timeout: 5000 });
    await expect(resultBody).toContainText('This is a mock AI response about the selected text.');

    // Close button works
    const closeBtn = popup.locator('[data-action="close"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(popup).not.toBeVisible();
  });

  test('Happy path: Edit flow', async ({ page }) => {
    // Mock the /ai/edit API
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/file\n+++ b/file\n-old line\n+new improved line',
          editId: 'mock-edit-123',
        }),
      });
    });

    // Mock the /ai/edit/confirm API
    await page.route('**/ai/edit/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commitHash: 'abc1234def5678' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    // Select text and show popup
    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Edit button
    await popup.locator('[data-action="edit"]').click();
    await page.waitForTimeout(200);

    // Should show edit input
    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();

    // Type instruction and submit
    await input.fill('make it more casual');
    await popup.locator('[data-action="submit-edit"]').click();

    // Wait for diff to be displayed (loading may be too fast to catch with mock)
    const diff = popup.locator('.ai-popup-diff');
    await expect(diff).toBeVisible({ timeout: 5000 });
    await expect(diff).toContainText('old line');
    await expect(diff).toContainText('new improved line');

    const acceptBtn = popup.locator('[data-action="accept"]');
    const retryBtn = popup.locator('[data-action="retry"]');
    const rejectBtn = popup.locator('.ai-popup-actions [data-action="reject"]');
    await expect(acceptBtn).toBeVisible();
    await expect(retryBtn).toBeVisible();
    await expect(rejectBtn).toBeVisible();

    // Click Accept
    await acceptBtn.click();

    // Wait for committed message with hash
    const committed = popup.locator('.ai-popup-committed');
    await expect(committed).toBeVisible({ timeout: 5000 });
    await expect(committed).toContainText('abc1234');
  });

  test('Edit retry flow', async ({ page }) => {
    // Mock the /ai/edit API
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/file\n+++ b/file\n-old line\n+new improved line',
          editId: 'mock-edit-456',
        }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Edit
    await popup.locator('[data-action="edit"]').click();
    await page.waitForTimeout(200);

    // Type instruction
    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    const originalInstruction = 'fix the typo';
    await input.fill(originalInstruction);
    await popup.locator('[data-action="submit-edit"]').click();

    // Wait for diff
    const diff = popup.locator('.ai-popup-diff');
    await expect(diff).toBeVisible({ timeout: 5000 });

    // Click Retry
    const retryBtn = popup.locator('[data-action="retry"]');
    await retryBtn.click();

    // Should be back to edit input with previous instruction pre-filled
    const inputAgain = popup.locator('.ai-popup-edit-input');
    await expect(inputAgain).toBeVisible();
    await expect(inputAgain).toHaveValue(originalInstruction);
  });

  test('Error handling', async ({ page }) => {
    // Mock /ai/ask to return 500 error
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Server error occurred' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Ask AI
    await popup.locator('[data-action="ask"]').click();
    await page.waitForTimeout(200);

    // Submit (without typing a question)
    await popup.locator('[data-action="submit-ask"]').click();

    // Wait for error message to be displayed
    const error = popup.locator('.ai-popup-error-text');
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toContainText('Server error occurred');
  });

  test('Not logged in flow', async ({ page }) => {
    await page.goto(TEST_POST);
    // Do NOT set JWT

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Should show Login with GitHub button only
    const loginBtn = popup.locator('[data-action="login"]');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Login with GitHub');

    // Should NOT show Ask AI or Edit buttons
    const askBtn = popup.locator('[data-action="ask"]');
    const editBtn = popup.locator('[data-action="edit"]');
    await expect(askBtn).not.toBeVisible();
    await expect(editBtn).not.toBeVisible();
  });

  test('Escape key dismisses popup', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Press Escape
    await page.keyboard.press('Escape');

    // Popup removed
    await expect(popup).not.toBeVisible();
  });

  test('Ask AI with empty question (direct submit)', async ({ page }) => {
    // Mock the /ai/ask API
    await page.route('**/ai/ask', async (route) => {
      const requestBody = await route.request().postDataJSON();
      // Verify that selectedText is sent even without question
      expect(requestBody.text).toBeTruthy();

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Response based on selected text only.' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Ask AI
    await popup.locator('[data-action="ask"]').click();
    await page.waitForTimeout(200);

    // Submit without typing
    await popup.locator('[data-action="submit-ask"]').click();

    // Should still work - wait for result
    const resultBody = popup.locator('.ai-popup-result-body');
    await expect(resultBody).toBeVisible({ timeout: 5000 });
    await expect(resultBody).toContainText('Response based on selected text only.');
  });
});

test.describe('AI Popup – E2E Flow (Mobile Chrome)', () => {
  test.beforeEach(async () => {
    const isMobile = test.info().project.name === 'Mobile Chrome';
    if (!isMobile) test.skip();
  });

  test('Happy path: Ask AI flow (mobile)', async ({ page }) => {
    // Mock the /ai/ask API
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'This is a mock AI response about the selected text.' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    // Select text and show popup
    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup).toHaveClass(/ai-popup--mobile/);

    // Click Ask AI button
    await popup.locator('[data-action="ask"]').tap();
    await page.waitForTimeout(200);

    // Should show input and selected text quote
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();

    const context = popup.locator('.ai-popup-selected-context');
    await expect(context).toBeVisible();

    // Type question and submit
    await input.fill('What does this mean?');
    await popup.locator('[data-action="submit-ask"]').tap();

    // Wait for response to be displayed (loading may be too fast with mock)
    const resultBody = popup.locator('.ai-popup-result-body');
    await expect(resultBody).toBeVisible({ timeout: 5000 });
    await expect(resultBody).toContainText('This is a mock AI response about the selected text.');

    // Close button works
    const closeBtn = popup.locator('[data-action="close"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.tap();
    await expect(popup).not.toBeVisible();
  });

  test('Happy path: Edit flow (mobile)', async ({ page }) => {
    // Mock the /ai/edit API
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/file\n+++ b/file\n-old line\n+new improved line',
          editId: 'mock-edit-123',
        }),
      });
    });

    // Mock the /ai/edit/confirm API
    await page.route('**/ai/edit/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commitHash: 'abc1234def5678' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    // Select text and show popup
    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Edit button
    await popup.locator('[data-action="edit"]').tap();
    await page.waitForTimeout(200);

    // Should show edit input
    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();

    // Type instruction and submit
    await input.fill('make it more casual');
    await popup.locator('[data-action="submit-edit"]').tap();

    // Wait for diff to be displayed
    const diff = popup.locator('.ai-popup-diff');
    await expect(diff).toBeVisible({ timeout: 5000 });
    await expect(diff).toContainText('old line');
    await expect(diff).toContainText('new improved line');

    const acceptBtn = popup.locator('[data-action="accept"]');
    const retryBtn = popup.locator('[data-action="retry"]');
    const rejectBtn = popup.locator('.ai-popup-actions [data-action="reject"]');
    await expect(acceptBtn).toBeVisible();
    await expect(retryBtn).toBeVisible();
    await expect(rejectBtn).toBeVisible();

    // Click Accept
    await acceptBtn.tap();

    // Wait for committed message with hash
    const committed = popup.locator('.ai-popup-committed');
    await expect(committed).toBeVisible({ timeout: 5000 });
    await expect(committed).toContainText('abc1234');
  });

  test('Edit retry flow (mobile)', async ({ page }) => {
    // Mock the /ai/edit API
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/file\n+++ b/file\n-old line\n+new improved line',
          editId: 'mock-edit-456',
        }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Edit
    await popup.locator('[data-action="edit"]').tap();
    await page.waitForTimeout(200);

    // Type instruction
    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    const originalInstruction = 'fix the typo';
    await input.fill(originalInstruction);
    await popup.locator('[data-action="submit-edit"]').tap();

    // Wait for diff
    const diff = popup.locator('.ai-popup-diff');
    await expect(diff).toBeVisible({ timeout: 5000 });

    // Click Retry
    const retryBtn = popup.locator('[data-action="retry"]');
    await retryBtn.tap();

    // Should be back to edit input with previous instruction pre-filled
    const inputAgain = popup.locator('.ai-popup-edit-input');
    await expect(inputAgain).toBeVisible();
    await expect(inputAgain).toHaveValue(originalInstruction);
  });

  test('Error handling (mobile)', async ({ page }) => {
    // Mock /ai/ask to return 500 error
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Server error occurred' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Ask AI
    await popup.locator('[data-action="ask"]').tap();
    await page.waitForTimeout(200);

    // Submit (without typing a question)
    await popup.locator('[data-action="submit-ask"]').tap();

    // Wait for error message to be displayed
    const error = popup.locator('.ai-popup-error-text');
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toContainText('Server error occurred');
  });

  test('Not logged in flow (mobile)', async ({ page }) => {
    await page.goto(TEST_POST);
    // Do NOT set JWT

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Should show Login with GitHub button only
    const loginBtn = popup.locator('[data-action="login"]');
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText('Login with GitHub');

    // Should NOT show Ask AI or Edit buttons
    const askBtn = popup.locator('[data-action="ask"]');
    const editBtn = popup.locator('[data-action="edit"]');
    await expect(askBtn).not.toBeVisible();
    await expect(editBtn).not.toBeVisible();
  });

  test('Escape key dismisses popup (mobile)', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Press Escape
    await page.keyboard.press('Escape');

    // Popup removed
    await expect(popup).not.toBeVisible();
  });

  test('Ask AI with empty question (direct submit, mobile)', async ({ page }) => {
    // Mock the /ai/ask API
    await page.route('**/ai/ask', async (route) => {
      const requestBody = await route.request().postDataJSON();
      // Verify that selectedText is sent even without question
      expect(requestBody.text).toBeTruthy();

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Response based on selected text only.' }),
      });
    });

    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Click Ask AI
    await popup.locator('[data-action="ask"]').tap();
    await page.waitForTimeout(200);

    // Submit without typing
    await popup.locator('[data-action="submit-ask"]').tap();

    // Should still work - wait for result
    const resultBody = popup.locator('.ai-popup-result-body');
    await expect(resultBody).toBeVisible({ timeout: 5000 });
    await expect(resultBody).toContainText('Response based on selected text only.');
  });
});
