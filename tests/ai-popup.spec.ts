import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  isDesktopChromiumProject,
  isMobileProject,
  selectPostText,
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
const AUTH_RETURN_KEY = 'gu-log-return-url';
const AUTH_JWT_KEY = 'gu-log-jwt';
const AUTH_STORAGE_URL_KEY = 'gu-log-auth-storage-url';

async function seedAuthReturn(page: Page, returnUrl: string) {
  await page.goto('/');
  await page.evaluate(
    ({ jwtKey, returnKey, returnUrl }) => {
      localStorage.removeItem(jwtKey);
      localStorage.removeItem('gu-log-callback-pwned');
      localStorage.setItem(returnKey, returnUrl);
    },
    { jwtKey: AUTH_JWT_KEY, returnKey: AUTH_RETURN_KEY, returnUrl }
  );
}

async function captureAuthTokenStorageUrl(page: Page) {
  await page.addInitScript(
    ({ jwtKey, observedUrlKey }) => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key === jwtKey) {
          originalSetItem.call(window.sessionStorage, observedUrlKey, window.location.href);
        }
        originalSetItem.call(this, key, value);
      };
    },
    { jwtKey: AUTH_JWT_KEY, observedUrlKey: AUTH_STORAGE_URL_KEY }
  );
}

async function expectTokenUrlScrubbedBeforeStorage(page: Page) {
  const observedHref = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    AUTH_STORAGE_URL_KEY
  );
  expect(observedHref).not.toBeNull();

  const observedUrl = new URL(observedHref!);
  expect(observedUrl.pathname).toMatch(/^\/auth\/callback\/?$/);
  expect(observedUrl.search).toBe('');
  expect(observedUrl.hash).toBe('');
}

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

test.describe('AI Popup - Request ordering', () => {
  test('GIVEN an earlier Ask is pending WHEN a new selection finishes first THEN the stale response cannot replace it', async ({
    page,
  }) => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let releaseFirstResponse: (() => void) | undefined;
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });

    await page.route('**/ai/ask', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;
      requestBodies.push(body);

      if (requestBodies.length === 1) {
        await firstResponseGate;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'x-test-response': 'stale' },
          body: JSON.stringify({ response: 'ANSWER_A' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: 'ANSWER_B' }),
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
    await popup.locator('[data-action="ask"]').click();
    const firstSelection = await popup.locator('.ai-popup-selection-text').textContent();
    await popup.locator('[data-action="submit-ask"]').click();
    await expect.poll(() => requestBodies.length).toBe(1);

    await selectPostTextAndShowPopup(page, { characters: 40 });
    await popup.locator('[data-action="ask"]').click();
    const secondSelection = await popup.locator('.ai-popup-selection-text').textContent();
    expect(secondSelection).not.toBe(firstSelection);
    await popup.locator('[data-action="submit-ask"]').click();

    const resultBody = popup.locator('.ai-popup-result-body');
    await expect(resultBody).toHaveText('ANSWER_B');
    expect(requestBodies.map((body) => body.text)).toEqual([firstSelection, secondSelection]);

    const staleResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/ai/ask') && response.headers()['x-test-response'] === 'stale'
    );
    releaseFirstResponse?.();
    await staleResponse;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );

    await expect(resultBody).toHaveText('ANSWER_B');
    await expect(popup.locator('.ai-popup-selection-text')).toHaveText(secondSelection || '');
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
  test('GIVEN callback query token WHEN loading same-origin styles THEN does not leak token through Referer', async ({
    page,
  }) => {
    const callbackToken = 'referrer-secret-token';
    const probePath = '/auth/referrer-probe.css';

    await page.route('**/auth/callback?token=*', async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const firstActiveHeadElement = html.match(/<(?:link|script|style)\b/)?.[0];
      expect(firstActiveHeadElement).toBeTruthy();
      await route.fulfill({
        response,
        body: html.replace(
          firstActiveHeadElement!,
          `<link rel="stylesheet" href="${probePath}" />\n    ${firstActiveHeadElement}`
        ),
      });
    });
    await page.route(`**${probePath}`, async (route) => {
      await route.fulfill({ contentType: 'text/css', body: 'body {}' });
    });

    const stylesheetRequestPromise = page.waitForRequest(
      (request) =>
        request.resourceType() === 'stylesheet' && new URL(request.url()).pathname === probePath
    );
    await page.goto(`/auth/callback?token=${callbackToken}`);

    const stylesheetRequest = await stylesheetRequestPromise;
    const requestHeaders = await stylesheetRequest.allHeaders();
    expect(requestHeaders.referer ?? '').not.toContain(callbackToken);
  });

  test('GIVEN callback page with token param WHEN loaded THEN stores JWT in localStorage', async ({
    page,
  }) => {
    await captureAuthTokenStorageUrl(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));

    await page.goto('/auth/callback?token=fake-jwt-token-12345');

    // Wait for localStorage to be populated
    await page.waitForFunction(() => !!localStorage.getItem('gu-log-jwt'));
    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('fake-jwt-token-12345');
    await expectTokenUrlScrubbedBeforeStorage(page);
  });

  test('GIVEN callback page with hash token WHEN loaded THEN stores JWT in localStorage', async ({
    page,
  }) => {
    await captureAuthTokenStorageUrl(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('gu-log-jwt'));

    await page.goto('/auth/callback#token=hash-jwt-token-67890');

    // Wait for localStorage to be populated
    await page.waitForFunction(() => !!localStorage.getItem('gu-log-jwt'));
    const jwt = await page.evaluate(() => localStorage.getItem('gu-log-jwt'));
    expect(jwt).toBe('hash-jwt-token-67890');
    await expectTokenUrlScrubbedBeforeStorage(page);
  });

  test('GIVEN theme storage is denied WHEN callback loads THEN it falls back without a page error', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem;
      const probe = { themeReads: 0 };
      Object.defineProperty(window, '__callbackStorageProbe', { value: probe });
      Storage.prototype.getItem = function (this: Storage, key: string) {
        if (this === window.localStorage && key === 'theme') {
          probe.themeReads += 1;
          throw new DOMException('theme storage denied', 'SecurityError');
        }
        return originalGetItem.call(this, key);
      };
    });

    await page.goto('/auth/callback');

    expect(
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __callbackStorageProbe?: { themeReads: number };
            }
          ).__callbackStorageProbe?.themeReads
      )
    ).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#status')).toHaveText('Login failed.');
    await expect(page.locator('.spinner')).toBeHidden();
    await expect(page.locator('#actions')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  for (const { label, callbackSuffix, token } of [
    {
      label: 'query token',
      callbackSuffix: '?token=query-storage-denied-token',
      token: 'query-storage-denied-token',
    },
    {
      label: 'hash token',
      callbackSuffix: '#token=hash-storage-denied-token',
      token: 'hash-storage-denied-token',
    },
  ]) {
    test(`GIVEN JWT storage is denied WHEN callback receives a ${label} THEN it fails closed after scrubbing the URL`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto('/');
      await page.evaluate(
        ({ jwtKey, returnKey, returnUrl }) => {
          localStorage.setItem(jwtKey, 'stale-jwt-token');
          localStorage.setItem(returnKey, returnUrl);
        },
        { jwtKey: AUTH_JWT_KEY, returnKey: AUTH_RETURN_KEY, returnUrl: TEST_POST }
      );
      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(
        'stale-jwt-token'
      );
      await page.addInitScript(
        ({ jwtKey }) => {
          const originalSetItem = Storage.prototype.setItem;
          const probe = { jwtWrites: 0, jwtWriteHref: '', jwtWriteValue: '' };
          Object.defineProperty(window, '__callbackStorageProbe', { value: probe });
          Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
            if (this === window.localStorage && key === jwtKey) {
              probe.jwtWrites += 1;
              probe.jwtWriteHref = window.location.href;
              probe.jwtWriteValue = value;
              throw new DOMException(
                '<img src=x onerror="document.body.dataset.pwned=1">',
                'SecurityError'
              );
            }
            return originalSetItem.call(this, key, value);
          };
        },
        { jwtKey: AUTH_JWT_KEY }
      );

      await page.goto(`/auth/callback${callbackSuffix}`);

      const storageProbe = await page.evaluate(
        () =>
          (
            window as typeof window & {
              __callbackStorageProbe?: {
                jwtWrites: number;
                jwtWriteHref: string;
                jwtWriteValue: string;
              };
            }
          ).__callbackStorageProbe
      );
      expect(storageProbe?.jwtWrites).toBe(1);
      expect(storageProbe?.jwtWriteValue).toBe(token);
      const jwtWriteUrl = new URL(storageProbe!.jwtWriteHref);
      expect(jwtWriteUrl.pathname).toMatch(/^\/auth\/callback\/?$/);
      expect(jwtWriteUrl.search).toBe('');
      expect(jwtWriteUrl.hash).toBe('');
      await expect(page).toHaveURL(/\/auth\/callback\/?$/);
      await expect(page.locator('#status')).toHaveText('Login failed.');
      await expect(page.locator('.spinner')).toBeHidden();
      await expect(page.locator('#error')).toContainText('could not be saved');
      await expect(page.locator('#actions')).toBeVisible();
      await expect(page).toHaveTitle('Login failed');
      await expect(page.locator('body')).not.toContainText(token);
      await expect(page.locator('#error img')).toHaveCount(0);
      expect(await page.evaluate(() => document.body.dataset.pwned)).toBeUndefined();
      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBeNull();
      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_RETURN_KEY)).toBe(
        TEST_POST
      );

      await page.waitForTimeout(700);
      await expect(page).toHaveURL(/\/auth\/callback\/?$/);
      await expect(page.locator('#status')).toHaveText('Login failed.');
      expect(pageErrors).toEqual([]);
    });
  }

  test('GIVEN JWT write and cleanup are both denied WHEN callback receives a token THEN it stays on a terminal failure UI', async ({
    page,
  }) => {
    const token = 'fully-denied-storage-token';
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.evaluate(
      ({ jwtKey, returnKey, returnUrl }) => {
        localStorage.setItem(jwtKey, 'stale-jwt-token');
        localStorage.setItem(returnKey, returnUrl);
      },
      { jwtKey: AUTH_JWT_KEY, returnKey: AUTH_RETURN_KEY, returnUrl: TEST_POST }
    );
    await page.addInitScript(
      ({ jwtKey }) => {
        const originalSetItem = Storage.prototype.setItem;
        const originalRemoveItem = Storage.prototype.removeItem;
        const probe = { jwtWrites: 0, jwtRemovals: 0, jwtWriteHref: '' };
        Object.defineProperty(window, '__callbackStorageProbe', { value: probe });
        Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
          if (this === window.localStorage && key === jwtKey) {
            probe.jwtWrites += 1;
            probe.jwtWriteHref = window.location.href;
            throw new DOMException('JWT write denied', 'SecurityError');
          }
          return originalSetItem.call(this, key, value);
        };
        Storage.prototype.removeItem = function (this: Storage, key: string) {
          if (this === window.localStorage && key === jwtKey) {
            probe.jwtRemovals += 1;
            throw new DOMException('JWT cleanup denied', 'SecurityError');
          }
          return originalRemoveItem.call(this, key);
        };
      },
      { jwtKey: AUTH_JWT_KEY }
    );

    await page.goto(`/auth/callback?token=${token}`);

    const storageProbe = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __callbackStorageProbe?: {
              jwtWrites: number;
              jwtRemovals: number;
              jwtWriteHref: string;
            };
          }
        ).__callbackStorageProbe
    );
    expect(storageProbe?.jwtWrites).toBe(1);
    expect(storageProbe?.jwtRemovals).toBe(1);
    const jwtWriteUrl = new URL(storageProbe!.jwtWriteHref);
    expect(jwtWriteUrl.pathname).toMatch(/^\/auth\/callback\/?$/);
    expect(jwtWriteUrl.search).toBe('');
    expect(jwtWriteUrl.hash).toBe('');
    await expect(page).toHaveURL(/\/auth\/callback\/?$/);
    await expect(page.locator('#status')).toHaveText('Login failed.');
    await expect(page.locator('.spinner')).toBeHidden();
    await expect(page.locator('#error')).toContainText('could not be saved');
    await expect(page.locator('#actions')).toBeVisible();
    await expect(page).toHaveTitle('Login failed');
    await expect(page.locator('body')).not.toContainText(token);
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(
      'stale-jwt-token'
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_RETURN_KEY)).toBe(
      TEST_POST
    );

    await page.waitForTimeout(700);
    await expect(page).toHaveURL(/\/auth\/callback\/?$/);
    await expect(page.locator('#status')).toHaveText('Login failed.');
    expect(pageErrors).toEqual([]);
  });

  for (const operation of ['getItem', 'removeItem'] as const) {
    test(`GIVEN return URL ${operation} is denied WHEN callback persists a token THEN it redirects home without a page error`, async ({
      page,
    }) => {
      const token = `return-${operation}-denied-token`;
      const probeKey = `callback-${operation}-denied-count`;
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto('/');
      await page.evaluate(
        ({ jwtKey, probeKey, returnKey, returnUrl }) => {
          localStorage.removeItem(jwtKey);
          localStorage.setItem(returnKey, returnUrl);
          sessionStorage.removeItem(probeKey);
        },
        {
          jwtKey: AUTH_JWT_KEY,
          probeKey,
          returnKey: AUTH_RETURN_KEY,
          returnUrl: TEST_POST,
        }
      );
      await page.addInitScript(
        ({ operation, probeKey, returnKey }) => {
          const originalGetItem = Storage.prototype.getItem;
          const originalRemoveItem = Storage.prototype.removeItem;
          function recordOperation() {
            const count = Number(window.sessionStorage.getItem(probeKey) || '0');
            window.sessionStorage.setItem(probeKey, String(count + 1));
          }
          Storage.prototype.getItem = function (this: Storage, key: string) {
            if (
              this === window.localStorage &&
              window.location.pathname.startsWith('/auth/callback') &&
              operation === 'getItem' &&
              key === returnKey
            ) {
              recordOperation();
              throw new DOMException('return storage denied', 'SecurityError');
            }
            return originalGetItem.call(this, key);
          };
          Storage.prototype.removeItem = function (this: Storage, key: string) {
            if (
              this === window.localStorage &&
              window.location.pathname.startsWith('/auth/callback') &&
              operation === 'removeItem' &&
              key === returnKey
            ) {
              recordOperation();
              throw new DOMException('return storage denied', 'SecurityError');
            }
            return originalRemoveItem.call(this, key);
          };
        },
        { operation, probeKey, returnKey: AUTH_RETURN_KEY }
      );

      await page.goto(`/auth/callback?token=${token}`);
      await page.waitForURL(new URL('/', page.url()).origin + '/', { timeout: 5000 });

      expect(await page.evaluate((key) => sessionStorage.getItem(key), probeKey)).toBe('1');
      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(token);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const { label, callbackSuffix, token } of [
    {
      label: 'query token',
      callbackSuffix: '?token=query-history-token',
      token: 'query-history-token',
    },
    {
      label: 'hash token',
      callbackSuffix: '#token=hash-history-token',
      token: 'hash-history-token',
    },
  ]) {
    test(`GIVEN callback with ${label} WHEN login returns and user goes Back THEN callback is absent from history`, async ({
      page,
    }) => {
      await page.goto('/about');
      const priorSafeUrl = page.url();
      await page.evaluate(
        ({ jwtKey, returnKey, returnUrl }) => {
          localStorage.removeItem(jwtKey);
          localStorage.setItem(returnKey, returnUrl);
        },
        { jwtKey: AUTH_JWT_KEY, returnKey: AUTH_RETURN_KEY, returnUrl: TEST_POST }
      );

      await page.goto(`/auth/callback${callbackSuffix}`);
      await page.waitForURL(new URL(TEST_POST, priorSafeUrl).href, { timeout: 5000 });
      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(token);

      await page.goBack();
      await expect(page).toHaveURL(priorSafeUrl);
      expect(page.url()).not.toContain('token=');
      expect(page.url()).not.toContain('/auth/callback');
    });
  }

  test('GIVEN callback page with no token WHEN loaded THEN shows error', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.goto('/auth/callback');
    await page.waitForTimeout(200);

    const callbackStatus = page.locator('.callback-status');
    await expect(callbackStatus).toHaveAttribute('role', 'status');
    await expect(callbackStatus).toHaveAttribute('aria-live', 'polite');
    await expect(callbackStatus).toHaveAttribute('aria-atomic', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(253, 246, 227)');

    const status = page.locator('#status');
    await expect(status).toContainText('Login failed');
    await expect(page).toHaveTitle('Login failed');
    await expect(page.locator('.spinner')).toBeHidden();

    const errorMsg = page.locator('#error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('Choose an option below');
    const retryLink = page.getByRole('link', { name: 'Try GitHub login again' });
    await expect(retryLink).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to homepage' })).toBeVisible();
    expect(
      await retryLink.evaluate((element) => element.getBoundingClientRect().height)
    ).toBeGreaterThanOrEqual(44);
    await retryLink.focus();
    await expect(retryLink).toBeFocused();
    await expect(retryLink).toHaveCSS('outline-style', 'solid');
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

  test('GIVEN an absolute same-origin return URL WHEN callback succeeds THEN preserves its path query and hash', async ({
    page,
  }) => {
    await page.goto('/');
    const returnPath = `${TEST_POST}?from=oauth#details`;
    const absoluteReturnUrl = new URL(returnPath, page.url()).href;
    await seedAuthReturn(page, absoluteReturnUrl);

    await page.goto('/auth/callback?token=absolute-return-token');
    await page.waitForURL(new URL(returnPath, absoluteReturnUrl).href, { timeout: 5000 });

    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(
      'absolute-return-token'
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_RETURN_KEY)).toBeNull();
  });

  test('GIVEN a same-origin URL whose path starts with two slashes WHEN callback succeeds THEN it falls back to the homepage', async ({
    page,
  }) => {
    await page.route(/^https?:\/\/attacker\.invalid\//, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>attacker fixture</title>',
      });
    });
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    await seedAuthReturn(page, `${origin}//attacker.invalid/landing`);
    const homeUrl = new URL('/', page.url()).href;

    await page.goto('/auth/callback?token=double-parse-return-token');
    await expect(page).toHaveURL(homeUrl, { timeout: 5000 });

    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(
      'double-parse-return-token'
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_RETURN_KEY)).toBeNull();
  });

  for (const unsafeReturnUrl of [
    'https://attacker.invalid/landing',
    '//attacker.invalid/landing',
    '\\\\attacker.invalid/landing',
    'https://[invalid',
  ]) {
    test(`GIVEN unsafe return URL ${unsafeReturnUrl} WHEN callback succeeds THEN falls back to the homepage`, async ({
      page,
    }) => {
      await page.route(/^https?:\/\/attacker\.invalid\//, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>attacker fixture</title>',
        });
      });
      await seedAuthReturn(page, unsafeReturnUrl);
      const homeUrl = new URL('/', page.url()).href;

      await page.goto('/auth/callback?token=unsafe-return-token');
      await expect(page).toHaveURL(homeUrl, { timeout: 5000 });

      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(
        'unsafe-return-token'
      );
      expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_RETURN_KEY)).toBeNull();
    });
  }

  test('GIVEN a javascript return URL WHEN callback succeeds THEN does not execute it', async ({
    page,
  }) => {
    await seedAuthReturn(page, "javascript:localStorage.setItem('gu-log-callback-pwned','1')");
    const homeUrl = new URL('/', page.url()).href;

    await page.goto('/auth/callback?token=javascript-return-token');

    await expect(page).toHaveURL(homeUrl, { timeout: 5000 });
    expect(await page.evaluate(() => localStorage.getItem('gu-log-callback-pwned'))).toBeNull();
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_JWT_KEY)).toBe(
      'javascript-return-token'
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_RETURN_KEY)).toBeNull();
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

  test('GIVEN Ask AI returns a quoted markdown URL WHEN result renders THEN the link cannot inject an event handler', async ({
    page,
  }) => {
    await page.route('**/ai/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: [
            '[hover me](https://safe.example/"onmouseover="document.body.dataset.pwned=1")',
            '',
            '[normal](https://safe.example/path?q=one%20two&lang=en)',
          ].join('\n'),
        }),
      });
    });

    const popup = await selectPostTextAndShowPopup(page);
    await popup.locator('[data-action="ask"]').click();
    await popup.locator('[data-action="submit-ask"]').click();

    const resultBody = popup.locator('.ai-popup-result-body');
    await expect(resultBody).toBeVisible({ timeout: 5000 });

    const maliciousLink = resultBody.getByRole('link', { name: 'hover me' });
    await expect(maliciousLink).toBeVisible();
    expect(
      await maliciousLink.evaluate((link) =>
        link.getAttributeNames().filter((name) => name.startsWith('on'))
      )
    ).toEqual([]);

    await page.evaluate(() => {
      delete document.body.dataset.pwned;
    });
    await maliciousLink.dispatchEvent('mouseover');
    expect(await page.evaluate(() => document.body.dataset.pwned)).toBeUndefined();

    await expect(resultBody.getByRole('link', { name: 'normal' })).toHaveAttribute(
      'href',
      'https://safe.example/path?q=one%20two&lang=en'
    );
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

  test('GIVEN confirm is pending WHEN selection changes and Escape is pressed THEN the original commit result stays visible', async ({
    page,
  }) => {
    let confirmRequests = 0;
    let releaseConfirm: (() => void) | undefined;
    const confirmGate = new Promise<void>((resolve) => {
      releaseConfirm = resolve;
    });

    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '- old text\n+ committed text',
          editId: 'pending-confirm-id',
        }),
      });
    });
    await page.route('**/ai/edit/confirm', async (route) => {
      confirmRequests += 1;
      await confirmGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commitHash: 'pending1234567890' }),
      });
    });

    const popup = await selectPostTextAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();
    await popup.locator('.ai-popup-edit-input').fill('commit this change');
    await popup.locator('[data-action="submit-edit"]').click();
    await expect(popup.locator('[data-action="confirm"]')).toBeVisible();

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __aiPopupSelectionCallbacks?: Array<() => void>;
      };
      const delayedCallbacks: Array<() => void> = [];
      const originalSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((
        handler: TimerHandler,
        timeout?: number,
        ...args: unknown[]
      ): number => {
        if (timeout === 10 && typeof handler === 'function') {
          delayedCallbacks.push(() => handler(...args));
          return 1;
        }
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof window.setTimeout;

      try {
        const paragraph = document.querySelector('.post-content p');
        if (!paragraph) throw new Error('No post-content paragraph found');

        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        const textNode = walker.nextNode();
        if (!textNode?.textContent) throw new Error('No selectable text node found');

        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(30, textNode.textContent.length));
        const selection = window.getSelection();
        if (!selection) throw new Error('Selection API unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      } finally {
        window.setTimeout = originalSetTimeout;
      }

      testWindow.__aiPopupSelectionCallbacks = delayedCallbacks;
    });
    expect(
      await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __aiPopupSelectionCallbacks?: Array<() => void>;
        };
        return testWindow.__aiPopupSelectionCallbacks?.length ?? 0;
      })
    ).toBe(1);

    await popup.locator('[data-action="confirm"]').click();
    await expect.poll(() => confirmRequests).toBe(1);
    await expect(popup.locator('.ai-popup-spinner')).toBeVisible();

    await selectPostText(page, { characters: 40 });
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');

    await expect(popup.locator('.ai-popup-spinner')).toBeVisible();
    expect(confirmRequests).toBe(1);

    releaseConfirm?.();
    await expect(popup.locator('.ai-popup-committed')).toContainText('pending');

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __aiPopupSelectionCallbacks?: Array<() => void>;
      };
      const callbacks = testWindow.__aiPopupSelectionCallbacks || [];
      delete testWindow.__aiPopupSelectionCallbacks;
      callbacks.forEach((callback) => callback());
    });
    await expect(popup.locator('.ai-popup-committed')).toContainText('pending');
  });
});
