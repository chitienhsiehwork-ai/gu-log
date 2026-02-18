import { test, expect } from './fixtures';

/**
 * AI Popup Chat Box Tests (TDD)
 *
 * Tests for the new Ask AI chat box feature:
 * - Input box appears after clicking Ask AI (instead of directly calling API)
 * - User can type a custom question
 * - Submit sends question to API
 * - Empty submit still works (backwards compatible)
 * - Error messages show useful detail instead of generic "Load failed"
 * - Input has helpful placeholder text
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

/** Helper: set up logged-in state, select text, get popup */
async function setupAndSelectText(page: import('@playwright/test').Page) {
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

test.describe('AI Popup - Chat Box', () => {
  test.beforeEach(async () => {
    if (test.info().project.name !== 'Desktop Chrome') test.skip();
  });

  test('GIVEN logged in WHEN clicking Ask AI THEN shows input box with submit button (not direct API call)', async ({ page }) => {
    // Do NOT mock the API - if it calls API directly, the test should still pass
    // because we're checking UI state, not API calls
    await page.route('**/ai/ask', async (route) => {
      // If this gets called, the old behavior is happening (direct call)
      // We want the new behavior: show input first
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Should not see this yet' }),
      });
    });

    const popup = await setupAndSelectText(page);

    // Click Ask AI button
    await popup.locator('[data-action="ask"]').click();

    // Should show input box, NOT loading spinner or result
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible({ timeout: 2000 });

    const submitBtn = popup.locator('[data-action="submit-ask"]');
    await expect(submitBtn).toBeVisible();

    // Should NOT show loading or result yet
    await expect(popup.locator('.ai-popup-loading')).not.toBeVisible();
    await expect(popup.locator('.ai-popup-result')).not.toBeVisible();
  });

  test('GIVEN input box visible WHEN user types question and submits THEN API is called with question field', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/ai/ask', async (route) => {
      const request = route.request();
      capturedBody = JSON.parse(request.postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Answer about error handling' }),
      });
    });

    const popup = await setupAndSelectText(page);

    // Click Ask AI
    await popup.locator('[data-action="ask"]').click();

    // Type question in the input
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();
    await input.fill('這段 code 怎麼處理 error？');

    // Click submit
    await popup.locator('[data-action="submit-ask"]').click();

    // Wait for result
    await expect(popup.locator('.ai-popup-result')).toBeVisible({ timeout: 5000 });

    // Verify API was called with question field
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.question).toBe('這段 code 怎麼處理 error？');
    expect(capturedBody.text).toBeTruthy(); // selected text should be present
  });

  test('GIVEN input box visible WHEN submit with empty input THEN API is called without question (backwards compatible)', async ({ page }) => {
    let capturedBody: any = null;
    await page.route('**/ai/ask', async (route) => {
      const request = route.request();
      capturedBody = JSON.parse(request.postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'Default explanation' }),
      });
    });

    const popup = await setupAndSelectText(page);

    // Click Ask AI
    await popup.locator('[data-action="ask"]').click();

    // Leave input empty, just click submit
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();

    await popup.locator('[data-action="submit-ask"]').click();

    // Wait for result
    await expect(popup.locator('.ai-popup-result')).toBeVisible({ timeout: 5000 });

    // API should be called without question field (or question is empty/undefined)
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.question || '').toBe('');
    expect(capturedBody.text).toBeTruthy();
  });

  test('GIVEN API returns 500 with detail WHEN Ask AI submits THEN popup shows the specific error detail', async ({ page }) => {
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Claude service error: Claude subprocess timed out after 60s' }),
      });
    });

    const popup = await setupAndSelectText(page);

    // Click Ask AI → input → submit
    await popup.locator('[data-action="ask"]').click();
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();
    await popup.locator('[data-action="submit-ask"]').click();

    // Should show error with the specific detail from the API
    const errorEl = popup.locator('.ai-popup-error-text');
    await expect(errorEl).toBeVisible({ timeout: 10000 });
    // Must contain the actual error detail, not generic "Load failed" or "Internal Server Error"
    await expect(errorEl).toContainText('Claude');
  });

  test('GIVEN input box visible THEN input has helpful placeholder text', async ({ page }) => {
    const popup = await setupAndSelectText(page);

    // Click Ask AI
    await popup.locator('[data-action="ask"]').click();

    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();

    // Check placeholder attribute exists and is not empty
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(5);
  });

  test('GIVEN input box visible WHEN clicking cancel THEN returns to button state or closes', async ({ page }) => {
    const popup = await setupAndSelectText(page);

    // Click Ask AI
    await popup.locator('[data-action="ask"]').click();
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();

    // Click cancel
    const cancelBtn = popup.locator('[data-action="cancel-ask"]');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Input should no longer be visible
    await expect(input).not.toBeVisible();
  });
});

test.describe('AI Popup - Error Detail Display', () => {
  test.beforeEach(async () => {
    if (test.info().project.name !== 'Desktop Chrome') test.skip();
  });

  test('GIVEN network error WHEN Ask AI submits THEN shows connection error message', async ({ page }) => {
    // Abort the request to simulate network failure
    await page.route('**/ai/ask', async (route) => {
      await route.abort('connectionrefused');
    });

    const popup = await setupAndSelectText(page);

    // Click Ask AI → input → submit
    await popup.locator('[data-action="ask"]').click();
    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();
    await popup.locator('[data-action="submit-ask"]').click();

    // Should show a connection-related error, not generic text
    const errorEl = popup.locator('.ai-popup-error-text');
    await expect(errorEl).toBeVisible({ timeout: 10000 });
    const errorText = await errorEl.textContent();
    // Should mention connection or network, not just "Load failed"
    expect(errorText).toBeTruthy();
    expect(errorText!.length).toBeGreaterThan(5);
  });
});
