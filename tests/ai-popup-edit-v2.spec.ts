import { test, expect } from './fixtures';

/**
 * RED tests for Edit v2 flow:
 * 1. Click Edit → instruction input (not immediate loading)
 * 2. Submit instruction → loading → diff
 * 3. Confirm / Retry / Cancel buttons
 * 4. Retry → back to instruction input
 * 5. Request body uses selectedText + instruction (not old 'text')
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

/** Helper: set up logged-in state and navigate to post */
async function setupLoggedIn(page: import('@playwright/test').Page) {
  await page.goto(TEST_POST);
  await page.evaluate(() => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
    const token = header + '.' + payload + '.fake-signature';
    localStorage.setItem('gu-log-jwt', token);
  });
  await page.reload();
}

/** Helper: select text and open popup */
async function selectAndShowPopup(page: import('@playwright/test').Page) {
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
  return popup;
}

test.describe('Edit v2 — Instruction Input', () => {
  test.beforeEach(async () => {
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  test('GIVEN logged in WHEN clicking Edit THEN shows instruction input (not immediate loading)', async ({
    page,
  }) => {
    await setupLoggedIn(page);
    const popup = await selectAndShowPopup(page);

    await popup.locator('[data-action="edit"]').click();

    // Should show instruction input, NOT loading spinner
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible({ timeout: 2000 });
    await expect(popup.locator('.ai-popup-spinner')).not.toBeVisible();
  });

  test('GIVEN edit instruction input WHEN user types and submits THEN sends correct request body', async ({
    page,
  }) => {
    await setupLoggedIn(page);

    let capturedBody: any = null;
    await page.route('**/ai/edit', async (route) => {
      const body = route.request().postDataJSON();
      capturedBody = body;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/test.mdx\n+++ b/test.mdx\n- old\n+ new',
          editId: 'test-edit-id',
        }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();

    // Type instruction
    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    await input.fill('語氣改輕鬆一點');

    // Submit
    await popup.locator('[data-action="submit-edit"]').click();

    // Wait for diff to appear
    await expect(popup.locator('.ai-popup-diff')).toBeVisible({ timeout: 10000 });

    // Verify request body structure
    expect(capturedBody).toBeTruthy();
    expect(capturedBody.selectedText).toBeTruthy();
    expect(capturedBody.instruction).toBe('語氣改輕鬆一點');
    expect(capturedBody.filePath).toBeTruthy();
    // Old field 'text' should NOT be used
    expect(capturedBody.text).toBeUndefined();
  });

  test('GIVEN backend returns validation detail array WHEN edit submit fails THEN shows readable error text', async ({
    page,
  }) => {
    await setupLoggedIn(page);

    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: [
            { loc: ['body', 'selectedText'], msg: 'Field required' },
            { loc: ['body', 'instruction'], msg: 'String should have at least 1 character' },
          ],
        }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();

    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    await input.fill('fix typo');
    await popup.locator('[data-action="submit-edit"]').click();

    const errorText = popup.locator('.ai-popup-error-text');
    await expect(errorText).toBeVisible({ timeout: 10000 });
    await expect(errorText).toContainText('selectedText: Field required');
    await expect(errorText).toContainText('instruction: String should have at least 1 character');
  });
});

test.describe('Edit v2 — Confirm / Retry / Cancel', () => {
  test.beforeEach(async () => {
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  /** Helper: get to the diff result state */
  async function getDiffState(page: import('@playwright/test').Page) {
    await setupLoggedIn(page);

    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/src/content/posts/test.mdx\n+++ b/src/content/posts/test.mdx\n@@ -1,3 +1,3 @@\n-他喜歡健身和寫 code。\n+他熱愛健身和寫 code，而且樂在其中。',
          editId: 'test-edit-id-456',
        }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();

    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    await input.fill('改成更有活力');
    await popup.locator('[data-action="submit-edit"]').click();

    await expect(popup.locator('.ai-popup-diff')).toBeVisible({ timeout: 10000 });
    return popup;
  }

  test('GIVEN diff result THEN shows Confirm, Retry, and Cancel buttons', async ({ page }) => {
    const popup = await getDiffState(page);

    await expect(popup.locator('[data-action="confirm"]')).toBeVisible();
    await expect(popup.locator('[data-action="retry"]')).toBeVisible();
    await expect(popup.locator('.ai-popup-btn[data-action="close"]')).toBeVisible();
  });

  test('GIVEN diff result WHEN clicking Confirm THEN calls /ai/edit/confirm', async ({ page }) => {
    let confirmCalled = false;
    await page.route('**/ai/edit/confirm', async (route) => {
      confirmCalled = true;
      const body = route.request().postDataJSON();
      expect(body.editId).toBe('test-edit-id-456');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'committed', commitHash: 'abc1234' }),
      });
    });

    const popup = await getDiffState(page);
    await popup.locator('[data-action="confirm"]').click();

    // Should show committed state
    await expect(popup.locator('.ai-popup-committed')).toBeVisible({ timeout: 5000 });
    expect(confirmCalled).toBe(true);
  });

  test('GIVEN diff result WHEN clicking Retry THEN shows instruction input again', async ({
    page,
  }) => {
    const popup = await getDiffState(page);

    await popup.locator('[data-action="retry"]').click();

    // Should go back to instruction input
    await expect(popup.locator('.ai-popup-edit-input')).toBeVisible({ timeout: 2000 });
    // Diff should be gone
    await expect(popup.locator('.ai-popup-diff')).not.toBeVisible();
  });

  test('GIVEN diff result WHEN clicking Cancel THEN closes popup', async ({ page }) => {
    const popup = await getDiffState(page);

    await popup.locator('.ai-popup-btn[data-action="close"]').click();

    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Edit v2 — Keyboard shortcuts', () => {
  test.beforeEach(async () => {
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  test('GIVEN edit instruction input WHEN pressing Enter THEN submits', async ({ page }) => {
    await setupLoggedIn(page);

    let editCalled = false;
    await page.route('**/ai/edit', async (route) => {
      editCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ diff: '- old\n+ new', editId: 'kbd-test' }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();

    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    await input.fill('修 typo');
    await input.press('Enter');

    await expect(popup.locator('.ai-popup-diff')).toBeVisible({ timeout: 10000 });
    expect(editCalled).toBe(true);
  });
});
