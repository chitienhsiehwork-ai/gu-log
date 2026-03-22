import { test, expect } from './fixtures';

/**
 * Full-text fuzzy search tests (Issue #6)
 *
 * Verifies that body-text keywords surface articles not reachable
 * via the old metadata-only includes() search.
 */

const BASE_EN = 'http://localhost:4321/en';
const BASE_ZH = 'http://localhost:4321';

test.describe('Full-text search — body matching', () => {
  test('GIVEN body-only keyword WHEN searching en site THEN returns CP-176', async ({ page }) => {
    // CP-176 (en) contains the word "logic" in its body but NOT in title/summary/tags in a way
    // that would match via the old metadata-only includes() — this is the acceptance criterion.
    await page.goto(BASE_EN);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('logic');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    const tickets = page.locator('.search-result-ticket');
    const ticketTexts = await tickets.allTextContents();
    expect(ticketTexts.some((t) => t === 'CP-176')).toBeTruthy();
  });

  test('GIVEN ticket ID WHEN searching en site THEN CP-176 still found', async ({ page }) => {
    await page.goto(BASE_EN);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('CP-176');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    const firstTicket = page.locator('.search-result-ticket').first();
    await expect(firstTicket).toHaveText('CP-176');
  });

  test('GIVEN zh-tw search WHEN searching logic THEN only zh-tw results returned', async ({
    page,
  }) => {
    await page.goto(BASE_ZH);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('邏輯');
    // May or may not return results — but must NOT return EN results
    await page.waitForTimeout(500); // allow debounce

    const items = page.locator('.search-result-item');
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const href = await items.nth(i).getAttribute('href');
      // zh-tw post URLs are /posts/..., NOT /en/posts/...
      expect(href).toMatch(/^\/posts\//);
    }
  });
});
