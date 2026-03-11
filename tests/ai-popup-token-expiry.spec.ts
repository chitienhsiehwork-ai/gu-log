import { test, expect } from './fixtures';

const TEST_POST = '/posts/claude-is-a-space-to-think';

async function setupLoggedIn(
  page: import('@playwright/test').Page,
  mode: 'valid' | 'expired' = 'valid'
) {
  await page.goto(TEST_POST);
  await page.evaluate((tokenMode) => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload =
      tokenMode === 'expired'
        ? btoa(JSON.stringify({ email: 'test@example.com', exp: 1000000000 }))
        : btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
    const token = header + '.' + payload + '.fake-signature';
    localStorage.setItem('gu-log-jwt', token);
  }, mode);
  await page.reload();
}

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

test.describe('AI Popup - Token Expiry', () => {
  test.beforeEach(async () => {
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  test('GIVEN expired JWT WHEN text selected THEN shows Login button (not Ask/Edit)', async ({
    page,
  }) => {
    await setupLoggedIn(page, 'expired');
    const popup = await selectAndShowPopup(page);

    await expect(popup.locator('[data-action="login"]')).toBeVisible();
    await expect(popup.locator('[data-action="ask"]')).not.toBeVisible();
    await expect(popup.locator('[data-action="edit"]')).not.toBeVisible();
  });

  test('GIVEN expired JWT WHEN somehow reaching edit submit THEN redirects to login', async ({
    page,
  }) => {
    await setupLoggedIn(page, 'expired');

    const popup = await selectAndShowPopup(page);

    // Force the edit-input UI despite expired token (bypassing pre-flight check)
    await page.evaluate(() => {
      const popupEl = document.getElementById('ai-popup');
      if (!popupEl) throw new Error('Popup not found');
      popupEl.innerHTML =
        '<input class="ai-popup-edit-input" value="Fix this sentence" />' +
        '<button class="ai-popup-btn ai-popup-btn--edit" data-action="submit-edit">Generate edit</button>';
    });

    // Click and wait for navigation to auth endpoint
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/auth/github'), { timeout: 5000 }),
      popup.locator('[data-action="submit-edit"]').click(),
    ]);

    // Verify the redirect targeted the auth endpoint
    expect(request.url()).toContain('/auth/github');
  });

  test('GIVEN valid JWT WHEN API returns "Token has expired" THEN shows re-login button + retry button', async ({
    page,
  }) => {
    await setupLoggedIn(page, 'valid');
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Token has expired' }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();
    await popup.locator('.ai-popup-edit-input').fill('Make it clearer');
    await popup.locator('[data-action="submit-edit"]').click();

    await expect(popup.locator('.ai-popup-result--auth-error')).toBeVisible({ timeout: 10000 });
    await expect(popup.locator('[data-action="relogin"]')).toBeVisible();
    await expect(popup.locator('[data-action="retry"]')).toBeVisible();
  });

  test('GIVEN error state WHEN retry clicked THEN returns to edit input with preserved instruction', async ({
    page,
  }) => {
    await setupLoggedIn(page, 'valid');
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Server exploded' }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();
    await popup.locator('.ai-popup-edit-input').fill('Keep this instruction');
    await popup.locator('[data-action="submit-edit"]').click();

    await expect(popup.locator('.ai-popup-error-text')).toContainText('Server exploded');
    await popup.locator('[data-action="retry"]').click();

    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Keep this instruction');
  });

  test('GIVEN error state WHEN 10 seconds pass THEN popup auto-dismisses', async ({ page }) => {
    await setupLoggedIn(page, 'valid');
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Temporary server error' }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();
    await popup.locator('.ai-popup-edit-input').fill('Trigger the error');
    await popup.locator('[data-action="submit-edit"]').click();

    await expect(popup.locator('.ai-popup-error-text')).toContainText('Temporary server error');
    await page.waitForTimeout(10500);
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });
});
