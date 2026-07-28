import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Search Edge Cases
 *
 * Tests search functionality edge cases: empty input, no results,
 * keyboard navigation, Cmd+K shortcut, Escape close, special chars.
 */

const BASE = '/';

async function waitForSearchReady(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('[data-search-modal]')
        .evaluate((searchModal) => searchModal.parentElement === document.body)
    )
    .toBe(true);
}

test.describe('Search - Keyboard Navigation', () => {
  test('GIVEN Cmd+K shortcut WHEN pressed THEN opens search modal', async ({ page }) => {
    await page.goto(BASE);

    // Verify search modal is hidden
    const modal = page.locator('[data-search-modal]');
    await expect(modal).toHaveAttribute('aria-hidden', 'true');

    // Press Cmd+K (or Ctrl+K)
    await page.keyboard.press('Meta+k');

    await expect(modal).toHaveAttribute('aria-hidden', 'false');
  });

  test('GIVEN open search modal WHEN Escape pressed THEN closes modal', async ({ page }) => {
    await page.goto(BASE);

    // Open search
    await page.click('[data-search-trigger]');
    const modal = page.locator('[data-search-modal]');
    await expect(modal).toHaveAttribute('aria-hidden', 'false');

    // Press Escape
    await page.keyboard.press('Escape');

    await expect(modal).toHaveAttribute('aria-hidden', 'true');
  });

  test('GIVEN the delayed focus is pending WHEN search closes THEN focus stays on the trigger', async ({
    page,
  }) => {
    await page.goto(BASE);
    await waitForSearchReady(page);
    await page.evaluate(() => {
      const originalSetTimeout = window.setTimeout;
      const testWindow = window as typeof window & {
        __releaseSearchFocusTimer?: () => void;
      };
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 50 && typeof handler === 'function') {
          testWindow.__releaseSearchFocusTimer = () => handler(...args);
          return 1;
        }
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof window.setTimeout;
    });

    const trigger = page.locator('[data-search-trigger]');
    const modal = page.locator('[data-search-modal]');
    await trigger.click();
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await page.keyboard.press('Escape');
    await expect(modal).toHaveAttribute('aria-hidden', 'true');
    await page.evaluate(() => {
      const release = (
        window as typeof window & {
          __releaseSearchFocusTimer?: () => void;
        }
      ).__releaseSearchFocusTimer;
      if (!release) throw new Error('search focus timer was not captured');
      release();
    });

    await expect(trigger).toBeFocused();
  });

  test('GIVEN search results WHEN pressing ArrowDown THEN highlights next result', async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('AI');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    // Press ArrowDown
    await input.press('ArrowDown');

    // First result should be selected
    const firstResult = page.locator('.search-result-item').first();
    await expect(firstResult).toHaveClass(/selected/);
  });

  test('GIVEN highlighted result WHEN pressing Enter THEN navigates to that post', async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('AI');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    // Get the first result's href
    const firstResult = page.locator('.search-result-item').first();
    const href = await firstResult.getAttribute('href');
    expect(href).toBeTruthy();

    // Navigate with keyboard
    await input.press('ArrowDown');
    await input.press('Enter');

    // Should navigate to the post
    await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('GIVEN search results WHEN pressing ArrowUp from first THEN wraps to last', async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('AI');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    // First ArrowDown to select first item (index 0)
    await input.press('ArrowDown');

    // ArrowUp should wrap to last item
    await input.press('ArrowUp');

    const results = page.locator('.search-result-item');
    const lastResult = results.last();
    await expect(lastResult).toHaveClass(/selected/);
  });
});

test.describe('Search - Edge Cases', () => {
  for (const locale of [
    {
      name: 'zh-tw',
      pagePath: '/',
      indexPath: 'search-index.zh-tw.json',
      unavailable: '搜尋目前無法使用，請再試一次',
    },
    {
      name: 'en',
      pagePath: '/en/',
      indexPath: 'search-index.en.json',
      unavailable: 'Search unavailable — please try again',
    },
  ] as const) {
    test(`GIVEN ${locale.name} search index fails WHEN searching THEN shows the localized recovery message`, async ({
      page,
    }) => {
      await page.route(`**/${locale.indexPath}`, (route) => route.abort());
      await page.goto(locale.pagePath);
      await page.click('[data-search-trigger]');

      await page.locator('[data-search-input]').fill('Claude');

      await expect(page.locator('.search-no-results')).toHaveText(locale.unavailable);
    });
  }

  test('GIVEN a pending index request WHEN the query is cleared before it fails THEN the empty search stays empty', async ({
    page,
  }) => {
    let markIndexStarted!: () => void;
    let releaseIndex!: () => void;
    const indexStarted = new Promise<void>((resolve) => {
      markIndexStarted = resolve;
    });
    const indexRelease = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });

    await page.route('**/search-index.zh-tw.json', async (route) => {
      markIndexStarted();
      await indexRelease;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}',
      });
    });
    await page.goto(BASE);
    await waitForSearchReady(page);
    await page.evaluate(() => {
      const results = document.querySelector<HTMLElement>('[data-search-results]');
      if (!results) throw new Error('search results container missing');
      results.dataset.sawUnavailable = 'false';
      new MutationObserver(() => {
        const message = results.querySelector('.search-no-results')?.textContent;
        if (message === '搜尋目前無法使用，請再試一次') {
          results.dataset.sawUnavailable = 'true';
        }
      }).observe(results, { childList: true, subtree: true });
    });

    await page.click('[data-search-trigger]');
    const input = page.locator('[data-search-input]');
    await input.fill('Claude');
    await indexStarted;
    await input.fill('');

    const failedResponse = page.waitForResponse(
      (response) => response.url().endsWith('/search-index.zh-tw.json') && response.status() === 500
    );
    releaseIndex();
    const response = await failedResponse;
    await response.finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );

    await expect(input).toHaveValue('');
    await expect(page.locator('[data-search-results]')).toHaveAttribute(
      'data-saw-unavailable',
      'false'
    );
    await expect(page.locator('[data-search-results]')).toBeEmpty();
  });

  test('GIVEN a pending index request WHEN search closes and reopens before it fails THEN the late failure does not replace fresh results', async ({
    page,
  }) => {
    let markIndexStarted!: () => void;
    let releaseIndex!: () => void;
    let indexRequests = 0;
    const indexStarted = new Promise<void>((resolve) => {
      markIndexStarted = resolve;
    });
    const indexRelease = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });

    await page.route('**/search-index.zh-tw.json', async (route) => {
      indexRequests += 1;
      if (indexRequests === 1) {
        markIndexStarted();
        await indexRelease;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{}',
        });
        return;
      }
      await route.continue();
    });
    await page.goto(BASE);
    await waitForSearchReady(page);
    await page.evaluate(() => {
      const results = document.querySelector<HTMLElement>('[data-search-results]');
      if (!results) throw new Error('search results container missing');
      results.dataset.sawUnavailable = 'false';
      new MutationObserver(() => {
        const message = results.querySelector('.search-no-results')?.textContent;
        if (message === '搜尋目前無法使用，請再試一次') {
          results.dataset.sawUnavailable = 'true';
        }
      }).observe(results, { childList: true, subtree: true });
    });

    await page.click('[data-search-trigger]');
    await expect(page.locator('[data-search-modal]')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('[data-search-input]').fill('Claude');
    await indexStarted;
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-search-modal]')).toHaveAttribute('aria-hidden', 'true');

    await page.click('[data-search-trigger]');
    await expect(page.locator('[data-search-modal]')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-search-input]')).toHaveValue('');
    await page.locator('[data-search-input]').fill('AI');
    await expect.poll(() => indexRequests).toBe(2);
    await expect(page.locator('.search-result-item').first()).toBeVisible();

    const failedResponse = page.waitForResponse(
      (response) => response.url().endsWith('/search-index.zh-tw.json') && response.status() === 500
    );
    releaseIndex();
    const staleResponse = await failedResponse;
    await staleResponse.finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );

    await expect(page.locator('[data-search-results]')).toHaveAttribute(
      'data-saw-unavailable',
      'false'
    );
    await expect(page.locator('.search-no-results')).toHaveCount(0);
    await expect(page.locator('.search-result-item').first()).toBeVisible();
    await expect(page.locator('[data-search-input]')).toHaveValue('AI');

    await page.locator('[data-search-input]').fill('AI ');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    expect(indexRequests).toBe(2);
  });

  test('GIVEN empty search input WHEN no text entered THEN no results shown', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const results = page.locator('[data-search-results]');
    await expect(results.locator('.search-result-item')).toHaveCount(0);
    await expect(results.locator('.search-no-results')).toHaveCount(0);
  });

  test('GIVEN search query with no matches WHEN searching THEN shows no-results message', async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('zzzznonexistentquery12345');

    // Wait for debounce and search
    await expect(page.locator('.search-no-results')).toBeVisible({ timeout: 5000 });
  });

  test('GIVEN rapid typing during the initial index fetch WHEN it resolves THEN runs one debounced search', async ({
    page,
  }) => {
    let markIndexStarted!: () => void;
    let releaseIndex!: () => void;
    const indexStarted = new Promise<void>((resolve) => {
      markIndexStarted = resolve;
    });
    const indexRelease = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });

    await page.route('**/search-index.zh-tw.json', async (route) => {
      markIndexStarted();
      await indexRelease;
      await route.continue();
    });
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    await page.evaluate(() => {
      const results = document.querySelector<HTMLElement>('[data-search-results]');
      if (!results) throw new Error('search results container missing');
      results.dataset.resultRenderCount = '0';
      new MutationObserver(() => {
        if (!results.querySelector('.search-result-item')) return;
        results.dataset.resultRenderCount = String(
          Number(results.dataset.resultRenderCount ?? '0') + 1
        );
      }).observe(results, { childList: true });
    });

    const input = page.locator('[data-search-input]');
    await input.fill('A');
    await indexStarted;
    await input.fill('AI');
    await input.fill('AI ');
    await input.fill('AI');

    const indexResponse = page.waitForResponse('**/search-index.zh-tw.json');
    releaseIndex();
    await indexResponse;
    await expect(page.locator('.search-result-item').first()).toBeVisible();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-search-results]')).toHaveAttribute(
      'data-result-render-count',
      '1'
    );
  });

  test('GIVEN ticket ID search WHEN entering GP- THEN matches partial ticket IDs', async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('GP-');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    // Results should contain GP ticket badges
    const tickets = page.locator('.search-result-ticket');
    const count = await tickets.count();
    expect(count).toBeGreaterThan(0);

    const firstTicket = await tickets.first().textContent();
    expect(firstTicket).toMatch(/^GP-/);
  });

  test('GIVEN open search modal WHEN clicking overlay THEN closes modal', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');

    const modal = page.locator('[data-search-modal]');
    await expect(modal).toHaveAttribute('aria-hidden', 'false');

    // Click on the overlay (not the inner modal)
    await modal.click({ position: { x: 5, y: 5 } });

    await expect(modal).toHaveAttribute('aria-hidden', 'true');
  });
});
