import { test, expect } from './fixtures';

/**
 * Tests for LoginCta Component
 *
 * LoginCta appears at the bottom of posts to encourage login for AI features.
 */

const TEST_POST = '/posts/gp-24-20260204-claude-is-a-space-to-think';
const EN_TEST_POST = '/en/posts/en-gp-24-20260204-claude-is-a-space-to-think';

test.describe('LoginCta Component', () => {
  test('loads its runtime from a cacheable script instead of repeating it inline', async ({
    page,
  }) => {
    await page.goto(TEST_POST);

    const inlineRuntimeCount = await page
      .locator('script:not([src])')
      .evaluateAll(
        (scripts) =>
          scripts.filter((script) => script.textContent?.includes('gu-log-return-url')).length
      );
    expect(inlineRuntimeCount).toBe(0);
    await expect(page.locator('script[src*="login-cta-client"]')).toHaveCount(1);
    await expect(page.locator('[data-login-cta]')).toBeVisible();
  });

  test('ignores earlier clobber markers and keeps the server-rendered login link', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const observer = new MutationObserver((_records, activeObserver) => {
        if (!document.body) return;

        const marker = document.createElement('div');
        marker.dataset.loginCta = '';
        marker.dataset.apiUrl = 'javascript:alert(document.domain)//';

        const fakeLogin = document.createElement('a');
        fakeLogin.id = 'cta-login-btn';
        fakeLogin.href = 'javascript:alert(document.domain)//';
        fakeLogin.addEventListener('click', () => {
          document.body.dataset.fakeLoginClicked = 'true';
        });

        document.body.prepend(marker, fakeLogin);
        activeObserver.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });

    await page.goto(TEST_POST);

    const cta = page.locator('.login-cta-container[data-login-cta]');
    const realLogin = cta.locator('#cta-login-btn');
    await expect(cta).toBeVisible();
    await expect(realLogin).toHaveAttribute('href', 'https://api.shroomdog.dev/auth/github');

    await page.evaluate(() => {
      document
        .querySelector('.login-cta-container #cta-login-btn')
        ?.addEventListener('click', (event) => event.preventDefault());
    });
    await realLogin.click();
    await expect(page.locator('body')).not.toHaveAttribute('data-fake-login-clicked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('gu-log-return-url'))).toBe(page.url());
  });

  test('GIVEN user is not logged in WHEN page loads THEN shows call-to-action with login button', async ({
    page,
  }) => {
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
    await expect(loginBtn).toContainText('使用 GitHub 登入');
    await expect(loginBtn).toHaveCSS('display', 'inline-flex');
    await expect(loginBtn).toHaveCSS('min-height', '44px');

    // Should show feature list
    await expect(cta).toContainText('Ask AI — 選取文字，請 AI 幫你解釋');
    await expect(cta).toContainText('Edit with AI — 選取文字，請 AI 建議修改');
    await expect(cta).not.toContainText('之後會做');
  });

  test('GIVEN an English reader is logged out WHEN the CTA renders THEN it describes the live AI features', async ({
    page,
  }) => {
    await page.goto(EN_TEST_POST, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));
    await page.reload();
    await page.waitForLoadState('networkidle');

    const cta = page.locator('[data-login-cta]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('Ask AI — Select text for an explanation');
    await expect(cta).toContainText('Edit with AI — Select text to suggest an edit');
    await expect(cta.locator('.github-login-btn')).toContainText('Log in with GitHub');
    await expect(cta).not.toContainText('coming soon');
  });

  test('GIVEN an English reader is logged in WHEN the CTA renders THEN it separates the label from the identity', async ({
    page,
  }) => {
    await page.goto(EN_TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'tester@example.com' }));
      localStorage.setItem('gu-log-jwt', `${header}.${payload}.sig`);
    });
    await page.reload();

    const status = page.locator('[data-login-cta] .cta-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Logged in as: tester@example.com');
  });

  test('GIVEN a logged-out reader WHEN clicking Login THEN saves the exact current URL', async ({
    page,
  }) => {
    await page.route('**/auth/github', async (route) => {
      await route.fulfill({ status: 200, body: 'Mock GitHub Auth' });
    });
    await page.goto(`${TEST_POST}?from=cta#footer-login`);
    await page.evaluate(() => {
      localStorage.removeItem('gu-log-jwt');
      localStorage.removeItem('gu-log-return-url');
    });
    await page.reload();
    const loginButton = page.locator('.github-login-btn');
    await expect(loginButton).toBeVisible();
    const expectedReturnUrl = page.url();

    await loginButton.click();
    await expect(page.locator('body')).toContainText('Mock GitHub Auth');
    await page.goBack();
    await page.waitForURL(expectedReturnUrl);

    const savedUrl = await page.evaluate(() => localStorage.getItem('gu-log-return-url'));
    expect(savedUrl).toBe(expectedReturnUrl);
  });

  test('GIVEN user is logged in WHEN page loads THEN shows user info and logout button', async ({
    page,
  }) => {
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
    await expect(logoutBtn).toHaveText('登出');
    await expect(logoutBtn).toHaveCSS('display', 'inline-flex');
    await expect(logoutBtn).toHaveCSS('min-width', '44px');
    await expect(logoutBtn).toHaveCSS('min-height', '44px');

    // Login button should NOT be visible
    await expect(cta.locator('.github-login-btn')).not.toBeVisible();
  });

  test('GIVEN user is logged in WHEN logout clicked THEN switches to logged out state', async ({
    page,
  }) => {
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

  test('GIVEN logout storage is denied WHEN logout clicked THEN keeps the authenticated UI without a page error', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(TEST_POST);
    const jwt = await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'tester@example.com' }));
      const token = `${header}.${payload}.sig`;
      localStorage.setItem('gu-log-jwt', token);
      return token;
    });
    await page.addInitScript(() => {
      const originalRemoveItem = Storage.prototype.removeItem;
      let logoutRemovalAttempts = 0;
      Object.defineProperty(window, '__logoutRemovalAttempts', {
        get: () => logoutRemovalAttempts,
      });
      Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (this === window.localStorage && key === 'gu-log-jwt') {
          logoutRemovalAttempts += 1;
          throw new DOMException('logout storage denied', 'SecurityError');
        }
        return originalRemoveItem.call(this, key);
      };
    });

    await page.reload();
    const cta = page.locator('[data-login-cta]');
    const logoutButton = cta.locator('.cta-logout');
    await expect(logoutButton).toBeVisible();
    await logoutButton.click();
    await page.waitForTimeout(50);

    expect(
      await page.evaluate(
        () =>
          (
            window as Window & {
              __logoutRemovalAttempts?: number;
            }
          ).__logoutRemovalAttempts
      )
    ).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('gu-log-jwt'))).toBe(jwt);
    await expect(logoutButton).toBeVisible();
    await expect(cta.locator('.github-login-btn')).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
