import { test, expect } from './fixtures';

const BASE = 'http://localhost:4321';

test.describe('Search Bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // Open search modal
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');
  });

  test('GIVEN search results WHEN displaying date THEN should NOT show "undefined"', async ({
    page,
  }) => {
    // Type a broad query to get results
    const input = page.locator('[data-search-input]');
    await input.fill('Claude');
    // Wait for debounce + results
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    // Check that no result contains "undefined" text
    const resultsContainer = page.locator('[data-search-results]');
    const allText = await resultsContainer.textContent();
    expect(allText?.toLowerCase()).not.toContain('undefined');

    // Specifically check date spans
    const dates = page.locator('.search-result-date');
    const count = await dates.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const dateText = await dates.nth(i).textContent();
      expect(dateText?.toLowerCase()).not.toContain('undefined');
      // Should look like a date (YYYY-MM-DD or similar)
      expect(dateText?.trim()).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  test('GIVEN an exact ticket search WHEN rendered THEN the date matches the public listing date', async ({
    page,
  }) => {
    const input = page.locator('[data-search-input]');

    for (const [ticketId, translatedDate] of [
      ['GP-260', '2026-07-21'],
      ['MP-314', '2026-07-15'],
    ] as const) {
      await input.fill(ticketId);
      const result = page.locator('.search-result-item').filter({ hasText: ticketId }).first();
      await expect(result).toBeVisible({ timeout: 5000 });
      await expect(result.locator('.search-result-date')).toHaveText(translatedDate);
    }
  });

  test('GIVEN multiple search results WHEN rendered THEN each entry should be visually separated', async ({
    page,
  }) => {
    // Search for something that returns multiple results
    const input = page.locator('[data-search-input]');
    await input.fill('AI');
    await page.waitForSelector('.search-result-item', { timeout: 5000 });

    const items = page.locator('.search-result-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Check visual separation between consecutive items
    for (let i = 0; i < count - 1; i++) {
      const item = items.nth(i);
      const nextItem = items.nth(i + 1);

      const box1 = await item.boundingBox();
      const box2 = await nextItem.boundingBox();

      if (box1 && box2) {
        // There should be visual gap OR border between items
        // Items should not overlap vertically
        expect(box2.y).toBeGreaterThanOrEqual(box1.y + box1.height);
      }

      // Each item should have visible separation via border, margin, or gap
      const hasBorder = await item.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.borderBottomWidth !== '0px' && style.borderBottomStyle !== 'none';
      });
      const margin = await item.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return parseFloat(style.marginBottom) + parseFloat(style.marginTop);
      });

      // At least one form of visual separation must exist
      expect(hasBorder || margin > 4).toBeTruthy();
    }
  });

  test('GIVEN a search result WHEN viewing it THEN ticket badge, title, and source should be clearly distinct', async ({
    page,
  }) => {
    const input = page.locator('[data-search-input]');
    await input.fill('GP-');
    await page.waitForSelector('.search-result-item', { timeout: 5000 });

    const firstItem = page.locator('.search-result-item').first();

    // Ticket badge should exist and be styled
    const ticket = firstItem.locator('.search-result-ticket');
    await expect(ticket).toBeVisible();

    // Title should exist
    const title = firstItem.locator('.search-result-title');
    await expect(title).toBeVisible();

    // Title font size should be larger than source
    const titleSize = await title.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );
    const source = firstItem.locator('.search-result-source');
    const sourceSize = await source.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );
    expect(titleSize).toBeGreaterThan(sourceSize);
  });
});

// Resolve a CSS custom property to its browser-computed color, in the same
// format getComputedStyle returns for real elements, so it can be compared
// directly without hand-rolling hex/rgb conversion.
async function resolveColorToken(
  page: import('@playwright/test').Page,
  varName: string
): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.backgroundColor = `var(${v})`;
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).backgroundColor;
    el.remove();
    return rgb;
  }, varName);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Search Bar ticket chip colors — ${theme} theme`, () => {
    test('GIVEN GP and MP search results WHEN rendered THEN each chip background resolves to the canonical taxonomy token', async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      await page.goto(BASE);
      await page.click('[data-search-trigger]');
      await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

      const input = page.locator('[data-search-input]');

      for (const prefix of ['gp', 'mp'] as const) {
        await input.fill(`${prefix.toUpperCase()}-`);
        await page.waitForSelector(`.search-result-ticket--${prefix}`, { timeout: 5000 });

        const badge = page.locator(`.search-result-ticket--${prefix}`).first();
        const actual = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
        const expected = await resolveColorToken(page, `--color-badge-${prefix}`);
        expect(actual).toBe(expected);

        await input.fill('');
      }
    });
  });
}
