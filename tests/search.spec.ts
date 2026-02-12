import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4321';

test.describe('Search Bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // Open search modal
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');
  });

  test('GIVEN search results WHEN displaying date THEN should NOT show "undefined"', async ({ page }) => {
    // Type a broad query to get results
    const input = page.locator('[data-search-input]');
    await input.fill('showboat');
    // Wait for debounce + results
    await page.waitForSelector('.search-result-item', { timeout: 5000 });

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

  test('GIVEN multiple search results WHEN rendered THEN each entry should be visually separated', async ({ page }) => {
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

  test('GIVEN a search result WHEN viewing it THEN ticket badge, title, and source should be clearly distinct', async ({ page }) => {
    const input = page.locator('[data-search-input]');
    await input.fill('SP-');
    await page.waitForSelector('.search-result-item', { timeout: 5000 });

    const firstItem = page.locator('.search-result-item').first();

    // Ticket badge should exist and be styled
    const ticket = firstItem.locator('.search-result-ticket');
    await expect(ticket).toBeVisible();

    // Title should exist
    const title = firstItem.locator('.search-result-title');
    await expect(title).toBeVisible();

    // Title font size should be larger than source
    const titleSize = await title.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
    const source = firstItem.locator('.search-result-source');
    const sourceSize = await source.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
    expect(titleSize).toBeGreaterThan(sourceSize);
  });
});
