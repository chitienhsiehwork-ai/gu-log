/**
 * Smoke specs for components that have no dedicated test of their own.
 *
 * Goal: render-and-not-crash. We pick representative routes that *should*
 * exercise each component; we don't depend on specific posts. The spec
 * fails if a component breaks rendering or throws a console error.
 */
import { test, expect } from './fixtures';
import type { ConsoleMessage } from '@playwright/test';

async function getContrastRatio(
  text: import('@playwright/test').Locator,
  background: import('@playwright/test').Locator
) {
  const [textColor, backgroundColor] = await Promise.all([
    text.evaluate((element) => getComputedStyle(element).color),
    background.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);

  const parseRgb = (color: string) => {
    const channels = color
      .match(/\d+(?:\.\d+)?/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${color}`);
    return channels;
  };
  const luminance = (color: string) => {
    const channels = parseRgb(color).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const foreground = luminance(textColor);
  const backdrop = luminance(backgroundColor);
  return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
}

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
  test('mogu-picks listing renders with Pagination', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/mogu-picks');
    await expect(page.locator('main')).toBeVisible();
    // Pagination renders nav with prev/next or page links
    const pagination = page.locator('nav[aria-label*="agination" i], nav.pagination, .pagination');
    if ((await pagination.count()) > 0) {
      await expect(pagination.first()).toBeVisible();
    }
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('gu-log-picks listing renders', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/gu-log-picks');
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
  test('a MP post page renders without errors', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/posts/mp-291-20260414-anthropic-');
    await expect(page.locator('article').first()).toBeVisible();
    // ShareButton exposes either the native action or a visible fallback,
    // depending on Web Share API support.
    await expect(page.locator('.share-section .share-btn:visible').first()).toBeVisible();
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('an GP post page renders article body', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/posts/gp-100-20260304-berryxia-ai-ai-prompt');
    await expect(page.locator('article').first()).toBeVisible();
    // Body should contain at least one heading
    expect(await page.locator('h2, h3').count()).toBeGreaterThan(0);
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('comments explain when the Giscus client cannot load', async ({ page }) => {
    await page.goto('/posts/gp-100-20260304-berryxia-ai-ai-prompt');

    const status = page.locator('.giscus-status');
    await expect(status).toContainText('留言載入中');

    await page
      .locator('.giscus-container script[src="https://giscus.app/client.js"]')
      .evaluate((script) => script.dispatchEvent(new Event('error')));

    await expect(status).toContainText('留言目前無法載入');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} editorial navigation hover text meets WCAG AA`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('theme', selectedTheme);
      }, theme);
      await page.goto('/posts/gp-24-20260204-claude-is-a-space-to-think');

      const relatedCard = page.locator('.related-card').first();
      await relatedCard.hover();
      expect(
        await getContrastRatio(relatedCard.locator('.related-title'), relatedCard)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await getContrastRatio(relatedCard.locator('.ticket-id'), relatedCard)
      ).toBeGreaterThanOrEqual(4.5);

      const chronologicalCard = page.locator('a.nav-card').first();
      await chronologicalCard.hover();
      for (const selector of ['.nav-direction', '.nav-post-title', '.nav-ticket']) {
        expect(
          await getContrastRatio(chronologicalCard.locator(selector), chronologicalCard)
        ).toBeGreaterThanOrEqual(4.5);
      }

      await page.goto('/posts/gp-144-20260402-ecc-instinct-system');
      const seriesCard = page.locator('.series-nav-link').first();
      await seriesCard.hover();
      expect(
        await getContrastRatio(seriesCard.locator('.series-nav-dir'), seriesCard)
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
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
