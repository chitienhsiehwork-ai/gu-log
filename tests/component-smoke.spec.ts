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

  test('English high-volume tag listing stays within the pagination budget', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/en/tags/claude-code');

    await expect(page.locator('.post-card')).toHaveCount(20);
    const pagination = page.locator('nav.pagination');
    await expect(pagination).toContainText(/Page 1 of \d+/);

    const next = pagination.locator('a.pagination-next');
    await expect(next).toHaveAttribute('href', '/en/tags/claude-code/2');
    await page.goto('/en/tags/claude-code/2');

    await expect(page).toHaveURL(/\/en\/tags\/claude-code\/2\/?$/);
    const secondPageCards = page.locator('.post-card');
    expect(await secondPageCards.count()).toBeGreaterThan(0);
    expect(await secondPageCards.count()).toBeLessThanOrEqual(20);
    await expect(page.locator('nav.pagination')).toContainText(/Page 2 of \d+/);
    await expect(page.locator('a.pagination-prev')).toHaveAttribute('href', '/en/tags/claude-code');

    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('gu-log-picks listing renders', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.goto('/gu-log-picks');
    await expect(page.locator('main')).toBeVisible();
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });
});

test.describe('Component smoke — storage fallbacks', () => {
  for (const route of ['/glossary', '/en/glossary']) {
    test(`${route} does not claim copy success when Clipboard rejects`, async ({ page }) => {
      const errs = attachConsoleErrorWatcher(page);
      await page.addInitScript(() => {
        let writeCalls = 0;
        Object.defineProperty(window, '__clipboardWriteCalls', {
          get: () => writeCalls,
        });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () => {
              writeCalls += 1;
              return Promise.reject(new DOMException('clipboard denied', 'NotAllowedError'));
            },
          },
        });
      });

      await page.goto(route);

      const link = page.locator('.term-link').first();
      await link.click();
      await page.waitForTimeout(100);

      await expect(page).toHaveURL(/#.+$/);
      await expect(link).not.toHaveClass(/copied/);
      expect(
        await page.evaluate(
          () => (window as Window & { __clipboardWriteCalls?: number }).__clipboardWriteCalls
        )
      ).toBe(1);
      expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
    });
  }

  test('glossary ignores stale Clipboard success after a newer rejection', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.addInitScript(() => {
      let writeCalls = 0;
      let resolveFirstWrite: (() => void) | undefined;
      const firstWrite = new Promise<void>((resolve) => {
        resolveFirstWrite = resolve;
      });

      Object.defineProperty(window, '__resolveFirstClipboardWrite', {
        value: () => resolveFirstWrite?.(),
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => {
            writeCalls += 1;
            return writeCalls === 1
              ? firstWrite
              : Promise.reject(new DOMException('clipboard denied', 'NotAllowedError'));
          },
        },
      });
    });

    await page.goto('/glossary');

    const link = page.locator('.term-link').first();
    await link.click();
    await link.click();
    await page.waitForTimeout(100);
    await expect(link).not.toHaveClass(/copied/);

    await page.evaluate(() => {
      (
        window as Window & {
          __resolveFirstClipboardWrite?: () => void;
        }
      ).__resolveFirstClipboardWrite?.();
    });
    await page.waitForTimeout(100);

    await expect(link).not.toHaveClass(/copied/);
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('theme toggle remains usable when theme storage is unavailable', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;

      Storage.prototype.getItem = function (key: string) {
        if (key === 'theme') throw new DOMException('theme storage denied', 'SecurityError');
        return originalGetItem.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'theme') throw new DOMException('theme storage denied', 'SecurityError');
        return originalSetItem.call(this, key, value);
      };
    });

    await page.goto('/');

    const root = page.locator('html');
    const toggle = page.locator('#theme-toggle');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAccessibleName('切換為淺色主題');

    await toggle.click();

    await expect(root).toHaveAttribute('data-theme', 'light');
    await expect(toggle).toHaveAccessibleName('切換為深色主題');
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('reading tracker nav stays fail closed and preserves storage events when auth storage is unavailable', async ({
    page,
  }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem;
      let authStorageReadCount = 0;

      Storage.prototype.getItem = function (key: string) {
        if (key === 'gu-log-jwt') {
          authStorageReadCount += 1;
          throw new DOMException('auth storage denied', 'SecurityError');
        }
        return originalGetItem.call(this, key);
      };
      Object.defineProperty(window, '__authStorageReadCount', {
        get: () => authStorageReadCount,
      });
    });

    await page.goto('/');

    const trackerNav = page.locator('#nav-reading-tracker');
    await expect(trackerNav).toHaveCount(1);
    expect(
      await page.evaluate(
        () => (window as Window & { __authStorageReadCount?: number }).__authStorageReadCount
      )
    ).toBeGreaterThan(0);
    expect(await trackerNav.evaluate((element) => element.style.display)).toBe('none');

    await page.evaluate(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'gu-log-jwt',
          newValue: 'header.payload.sig',
        })
      );
    });
    await expect.poll(() => trackerNav.evaluate((element) => element.style.display)).toBe('');

    await page.evaluate(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'gu-log-jwt',
          newValue: null,
        })
      );
    });
    await expect.poll(() => trackerNav.evaluate((element) => element.style.display)).toBe('none');
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });

  test('SeriesNav reads the tracker store once and keeps same-tab updates live', async ({
    page,
  }) => {
    const readSlug = 'gp-143-20260402-ecc-autonomous-loops';
    const unreadSlug = 'gp-146-20260402-ecc-hook-architecture';

    await page.addInitScript((preloadedSlug) => {
      localStorage.removeItem('gu-log-jwt');
      localStorage.setItem(
        'gu-log-read-articles',
        JSON.stringify({
          version: 1,
          slugs: [preloadedSlug],
          lastUpdated: '2026-07-29T00:00:00.000Z',
        })
      );

      const originalGetItem = Storage.prototype.getItem;
      let readStoreGets = 0;
      Storage.prototype.getItem = function (key: string) {
        if (key === 'gu-log-read-articles') {
          readStoreGets += 1;
        }
        return originalGetItem.call(this, key);
      };
      Object.defineProperty(window, '__seriesNavReadStoreGets', {
        get: () => readStoreGets,
      });
    }, readSlug);

    await page.goto('/posts/gp-144-20260402-ecc-instinct-system');

    const readIndicator = page.locator(
      `[data-series-nav] [data-read-indicator][data-slug="${readSlug}"]`
    );
    const unreadIndicator = page.locator(
      `[data-series-nav] [data-read-indicator][data-slug="${unreadSlug}"]`
    );

    await expect(readIndicator).toHaveClass(/is-read/);
    await expect(unreadIndicator).not.toHaveClass(/is-read/);
    expect(
      await page.evaluate(
        () => (window as Window & { __seriesNavReadStoreGets?: number }).__seriesNavReadStoreGets
      )
    ).toBe(1);

    await page.evaluate((slug) => {
      window.dispatchEvent(
        new CustomEvent('read-status-changed', { detail: { slug, read: true } })
      );
    }, unreadSlug);

    await expect(unreadIndicator).toHaveClass(/is-read/);
    await expect(unreadIndicator).toHaveAttribute('title', 'Read');
    expect(
      await page.evaluate(
        () => (window as Window & { __seriesNavReadStoreGets?: number }).__seriesNavReadStoreGets
      )
    ).toBe(1);
  });
});

test.describe('Component smoke — shared high-fanout styles', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} Toggle, TicketBadge, and PostStatusLabel keep computed styles`, async ({
      page,
    }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('theme', selectedTheme);
      }, theme);
      await page.goto('/');

      const toggle = page.locator('.post-preview .toggle-container').first();
      const toggleHeader = toggle.locator('.toggle-header');
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveCSS('margin-bottom', '0px');
      await expect(toggleHeader).toHaveCSS('padding-left', '12px');
      await expect(toggleHeader).toHaveCSS('min-height', '44px');
      await toggleHeader.focus();
      await expect(toggleHeader).toHaveCSS('outline-style', 'solid');
      await expect(toggleHeader).toHaveCSS('outline-width', '2px');
      await toggleHeader.click();
      await expect(toggle).toHaveAttribute('data-open', 'true');
      await expect(toggleHeader).toHaveAttribute('aria-expanded', 'true');

      const badge = page.locator('.ticket-wrapper .ticket-badge').first();
      await expect(badge).toBeVisible();
      await expect(badge).toHaveCSS('border-left-width', '1px');
      expect(await badge.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)'
      );

      const statusStyles = await page.evaluate(() => {
        const deprecated = document.createElement('span');
        deprecated.className = 'post-status-label post-status-label--deprecated';
        const retired = document.createElement('span');
        retired.className = 'post-status-label post-status-label--retired';
        document.body.append(deprecated, retired);

        const probe = document.createElement('span');
        document.body.append(probe);
        probe.style.color = 'var(--color-status-warning, #ffb86c)';
        const warning = getComputedStyle(probe).color;
        probe.style.color = 'var(--color-text-muted)';
        const muted = getComputedStyle(probe).color;

        const result = {
          display: getComputedStyle(deprecated).display,
          deprecated: getComputedStyle(deprecated).color,
          retired: getComputedStyle(retired).color,
          warning,
          muted,
        };
        deprecated.remove();
        retired.remove();
        probe.remove();
        return result;
      });
      expect(statusStyles).toEqual({
        display: 'inline-flex',
        deprecated: statusStyles.warning,
        retired: statusStyles.muted,
        warning: statusStyles.warning,
        muted: statusStyles.muted,
      });
    });
  }

  test('Pagination keeps focus/touch sizing and SeriesNav avoids Toggle triangle styles', async ({
    page,
  }) => {
    await page.goto('/en/tags/claude-code');

    const paginationLink = page.locator('.pagination a.pagination-link').first();
    await expect(paginationLink).toBeVisible();
    await expect(paginationLink).toHaveCSS('min-width', '100px');
    await paginationLink.focus();
    await expect(paginationLink).toHaveCSS('outline-style', 'solid');
    await expect(paginationLink).toHaveCSS('outline-width', '2px');
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      expect((await paginationLink.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }

    await page.goto('/posts/gp-144-20260402-ecc-instinct-system');
    const seriesToggleIcon = page.locator('.series-list-toggle .toggle-icon');
    await expect(seriesToggleIcon).toBeVisible();
    await expect(seriesToggleIcon).toHaveCSS('border-left-width', '0px');
    expect((await seriesToggleIcon.boundingBox())?.width).toBeGreaterThan(0);
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

  test('ignores null message payloads from the Giscus origin', async ({ page }) => {
    await page.route('https://giscus.app/client.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: '',
      });
    });
    await page.goto('/posts/gp-100-20260304-berryxia-ai-ai-prompt');

    const errors = await page.evaluate(async () => {
      const capturedErrors: string[] = [];
      const captureError = (event: ErrorEvent) => {
        capturedErrors.push(event.error?.message ?? event.message);
        event.preventDefault();
      };

      window.addEventListener('error', captureError);
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://giscus.app',
          data: null,
        })
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      window.removeEventListener('error', captureError);

      return capturedErrors;
    });

    expect(errors).toEqual([]);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} editorial navigation text meets WCAG AA without side-tab cards`, async ({
      page,
    }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('theme', selectedTheme);
      }, theme);
      await page.goto('/posts/gp-24-20260204-claude-is-a-space-to-think');

      const pageBackground = page.locator('body');
      const relatedCard = page.locator('.related-card').first();
      await relatedCard.hover();
      expect(
        await getContrastRatio(relatedCard.locator('.related-title'), pageBackground)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await getContrastRatio(relatedCard.locator('.ticket-id'), pageBackground)
      ).toBeGreaterThanOrEqual(4.5);

      const chronologicalCard = page.locator('a.nav-card').first();
      await chronologicalCard.hover();
      for (const selector of ['.nav-direction', '.nav-post-title', '.nav-ticket']) {
        expect(
          await getContrastRatio(chronologicalCard.locator(selector), pageBackground)
        ).toBeGreaterThanOrEqual(4.5);
      }

      await page.goto('/posts/gp-144-20260402-ecc-instinct-system');
      const seriesCard = page.locator('.series-nav-link').first();
      await seriesCard.hover();
      expect(
        await getContrastRatio(seriesCard.locator('.series-nav-dir'), page.locator('body'))
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('mobile article chrome avoids repeated rounded side-tab cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/posts/gp-24-20260204-claude-is-a-space-to-think');

    for (const locator of [
      page.locator('.source-citation'),
      page.locator('.related-card').first(),
      page.locator('a.nav-card').first(),
      page.locator('.toc-mobile .toc-toggle-container'),
    ]) {
      const styles = await locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderLeftWidth: style.borderLeftWidth,
          borderRadius: style.borderRadius,
        };
      });
      expect(styles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(styles.borderLeftWidth).toBe('0px');
      expect(styles.borderRadius).toBe('0px');
    }

    await expect(page.locator('.source-citation')).toHaveAttribute('href', /^https?:\/\//);
    await expect(page.locator('.source-citation')).toHaveAttribute('target', '_blank');
    await expect(page.locator('.source-citation')).toHaveAttribute('rel', /noopener/);
    expect((await page.locator('.source-citation').boundingBox())?.height).toBeGreaterThanOrEqual(
      44
    );
    expect(
      (await page.locator('.related-link').first().boundingBox())?.height
    ).toBeGreaterThanOrEqual(44);

    const activeMobileTocLink = page.locator('.toc-mobile .toc-link.active').first();
    await expect(activeMobileTocLink).toBeAttached();
    expect(
      await activeMobileTocLink.evaluate((element) => getComputedStyle(element, '::before').content)
    ).toBe('none');

    const mobileToc = page.locator('.toc-mobile .toc-toggle-container');
    const mobileTocHeader = page.locator('.toc-mobile .toc-toggle-header');
    const mobileTocContent = page.locator('.toc-mobile .toc-content');
    await expect(mobileTocContent).toHaveCSS('border-left-width', '0px');
    await mobileTocHeader.click();
    await expect(mobileTocContent).toHaveCSS('border-left-width', '1px');
    const mobileTocStyles = await mobileTocContent.evaluate((element) => {
      const style = getComputedStyle(element);
      const rootStyle = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-toc-rail)';
      document.body.append(probe);
      const resolvedTocRail = getComputedStyle(probe).color;
      probe.remove();
      return {
        backgroundColor: style.backgroundColor,
        borderLeftColor: style.borderLeftColor,
        borderRadius: style.borderRadius,
        tocRail: rootStyle.getPropertyValue('--color-toc-rail').trim(),
        resolvedTocRail,
        accent: rootStyle.getPropertyValue('--color-mogu-orange').trim(),
      };
    });
    expect(mobileTocStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(mobileTocStyles.borderRadius).toBe('0px');
    expect(mobileTocStyles.borderLeftColor).toBe(mobileTocStyles.resolvedTocRail);
    expect(mobileTocStyles.borderLeftColor).not.toBe(mobileTocStyles.accent);
    expect(mobileTocStyles.tocRail).toBeTruthy();
    await mobileTocHeader.click();
    await expect(mobileToc).toHaveAttribute('data-open', 'false');
    await expect(mobileTocContent).toHaveCSS('border-left-width', '0px');

    await page.goto('/posts/gp-144-20260402-ecc-instinct-system');
    const seriesNavLink = page.locator('.series-nav-link').first();
    const seriesNavStyles = await seriesNavLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderLeftWidth: style.borderLeftWidth,
        borderRadius: style.borderRadius,
      };
    });
    expect(seriesNavStyles).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderLeftWidth: '0px',
      borderRadius: '0px',
    });
    expect(
      (await page.locator('.series-list-toggle').boundingBox())?.height
    ).toBeGreaterThanOrEqual(44);
    await page.locator('.series-list-toggle').click();
    expect(
      (await page.locator('a.series-item-link').first().boundingBox())?.height
    ).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Component smoke — Mermaid error handling', () => {
  test('renders CDN import failures instead of leaving an unhandled loading state', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    let interceptedRequests = 0;
    let rejectMermaidImport = false;

    await page.route('**/mermaid@11.16.0/dist/mermaid.esm.min.mjs*', async (route) => {
      if (rejectMermaidImport) {
        interceptedRequests += 1;
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        contentType: 'application/javascript',
        headers: { 'access-control-allow-origin': '*' },
        body: `
            export default {
              initialize() {},
              async render() {
                return { svg: '<svg viewBox="0 0 1 1"></svg>' };
              },
            };
          `,
      });
    });

    await page.goto('/en/posts/en-levelup-20260608-12-llm-internals/', {
      waitUntil: 'load',
    });
    const warmTargets = page.locator('.mermaid-render');
    const warmTargetCount = await warmTargets.count();
    expect(warmTargetCount).toBeGreaterThan(0);
    await expect(warmTargets.locator('svg')).toHaveCount(warmTargetCount);

    await page.addInitScript(() => {
      const errorTargets = new WeakSet<Element>();
      let errorTargetCount = 0;
      const recordErrorTargets = () => {
        for (const target of document.querySelectorAll('.mermaid-render')) {
          if (
            !errorTargets.has(target) &&
            target.querySelector('pre')?.textContent?.startsWith('Mermaid error:')
          ) {
            errorTargets.add(target);
            errorTargetCount += 1;
          }
        }
      };

      new MutationObserver(recordErrorTargets).observe(document, {
        childList: true,
        subtree: true,
      });
      Object.defineProperty(window, '__mermaidErrorTargetCount', {
        get: () => errorTargetCount,
      });
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    rejectMermaidImport = true;
    await page.reload({
      waitUntil: 'load',
    });
    await expect.poll(() => interceptedRequests).toBeGreaterThan(0);

    const renderTargets = page.locator('.mermaid-render');
    const renderTargetCount = await renderTargets.count();
    expect(renderTargetCount).toBeGreaterThan(0);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __mermaidErrorTargetCount?: number;
              }
            ).__mermaidErrorTargetCount
        )
      )
      .toBe(renderTargetCount);
    await expect
      .poll(() =>
        renderTargets.evaluateAll((targets) =>
          targets.every((target) => Boolean(target.querySelector('pre, svg')))
        )
      )
      .toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test('renders thrown Mermaid messages as text instead of markup', async ({ page }) => {
    const payload = '<img data-mermaid-error-probe src="data:,">';

    await page.route(
      'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs',
      async (route) => {
        await route.fulfill({
          contentType: 'application/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: `
            const payload = ${JSON.stringify(payload)};
            export default {
              initialize() {},
              async render() {
                throw new Error(payload);
              },
            };
          `,
        });
      }
    );

    await page.goto('/en/posts/en-levelup-20260608-12-llm-internals/', {
      waitUntil: 'domcontentloaded',
    });

    const renderTarget = page.locator('.mermaid-render').first();
    const error = renderTarget.locator('pre');
    await expect(error).toBeVisible();
    await expect(error).toContainText(payload);
    await expect(renderTarget.locator('img')).toHaveCount(0);
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
