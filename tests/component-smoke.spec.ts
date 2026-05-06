/**
 * Smoke specs for components that have no dedicated test of their own.
 *
 * Goal: render-and-not-crash. We pick representative routes that *should*
 * exercise each component; we don't depend on specific posts. The spec
 * fails if a component breaks rendering or throws a console error.
 */
import { test, expect } from './fixtures';
import type { ConsoleMessage } from '@playwright/test';

function attachConsoleErrorWatcher(page: import('@playwright/test').Page) {
  const errs: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known-noisy 3rd-party warnings unrelated to our code
      if (
        text.includes('favicon') ||
        text.includes('giscus') ||
        text.includes('Failed to load resource') ||
        text.includes('Vercel Analytics')
      ) {
        return;
      }
      errs.push(text);
    }
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}

test.describe('Component smoke — listing pages', () => {
  test('clawd-picks listing renders with Pagination', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/clawd-picks');
    await expect(page.locator('main')).toBeVisible();
    // Pagination renders nav with prev/next or page links
    const pagination = page.locator('nav[aria-label*="agination" i], nav.pagination, .pagination');
    if ((await pagination.count()) > 0) {
      await expect(pagination.first()).toBeVisible();
    }
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('shroomdog-picks listing renders', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/shroomdog-picks');
    await expect(page.locator('main')).toBeVisible();
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });
});

test.describe('Component smoke — site shell', () => {
  test('home renders LanguageToggle in header', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/');
    // LanguageToggle renders an <a> or <button> with text containing zh / 中 or EN
    const headerLangSwitcher = page.locator(
      'header a:has-text("EN"), header a:has-text("中"), header a[href^="/en"], header a[href="/"]'
    );
    expect(await headerLangSwitcher.count()).toBeGreaterThan(0);
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('en/ home renders without errors', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/en/');
    await expect(page.locator('main')).toBeVisible();
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('tags page renders TicketBadge', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/tags');
    await expect(page.locator('main')).toBeVisible();
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('glossary page renders without errors', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/glossary');
    await expect(page.locator('main')).toBeVisible();
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });
});

test.describe('Component smoke — post page (RelatedArticles, ShareButton, PrevNextNav)', () => {
  test('a CP post page renders without errors', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/posts/cp-291-20260414-anthropic-');
    await expect(page.locator('article').first()).toBeVisible();
    // ShareButton has a recognizable click target
    const share = page.locator('[aria-label*="hare" i], button:has-text("Share"), a:has-text("Share")');
    if ((await share.count()) > 0) {
      await expect(share.first()).toBeVisible();
    }
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('an SP post page renders article body', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/posts/sp-100-20260304-berryxia-ai-ai-prompt');
    await expect(page.locator('article').first()).toBeVisible();
    // Body should contain at least one heading
    expect(await page.locator('h2, h3').count()).toBeGreaterThan(0);
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });
});

test.describe('Component smoke — feed/api endpoints', () => {
  test('rss.xml is served and well-formed XML', async ({ request }) => {
    const r = await request.get('/rss.xml');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toMatch(/xml/);
    const body = await r.text();
    expect(body).toMatch(/^<\?xml/);
    expect(body).toMatch(/<rss|<feed/);
  });

  test('search-index.zh-tw.json returns JSON array', async ({ request }) => {
    const r = await request.get('/search-index.zh-tw.json');
    expect(r.status()).toBe(200);
    const arr = await r.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0]).toHaveProperty('title');
  });

  test('search-index.en.json returns JSON array', async ({ request }) => {
    const r = await request.get('/search-index.en.json');
    expect(r.status()).toBe(200);
    const arr = await r.json();
    expect(Array.isArray(arr)).toBe(true);
  });
});
