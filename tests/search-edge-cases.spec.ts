import { test, expect } from './fixtures';

/**
 * Search Edge Cases
 * 
 * Tests search functionality edge cases: empty input, no results, 
 * keyboard navigation, Cmd+K shortcut, Escape close, special chars.
 */

const BASE = 'http://localhost:4321';

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

  test('GIVEN search results WHEN pressing ArrowDown THEN highlights next result', async ({ page }) => {
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

  test('GIVEN highlighted result WHEN pressing Enter THEN navigates to that post', async ({ page }) => {
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

  test('GIVEN search results WHEN pressing ArrowUp from first THEN wraps to last', async ({ page }) => {
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
  test('GIVEN empty search input WHEN no text entered THEN no results shown', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const results = page.locator('[data-search-results]');
    const html = await results.innerHTML();
    expect(html.trim()).toBe('');
  });

  test('GIVEN search query with no matches WHEN searching THEN shows no-results message', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('zzzznonexistentquery12345');
    
    // Wait for debounce and search
    await expect(page.locator('.search-no-results')).toBeVisible({ timeout: 5000 });
  });

  test('GIVEN ticket ID search WHEN entering SP-THEN matches partial ticket IDs', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[data-search-trigger]');
    await page.waitForSelector('[data-search-modal][aria-hidden="false"]');

    const input = page.locator('[data-search-input]');
    await input.fill('SP-');
    await page.waitForSelector('.search-result-item', { timeout: 8000 });

    // Results should contain SP ticket badges
    const tickets = page.locator('.search-result-ticket');
    const count = await tickets.count();
    expect(count).toBeGreaterThan(0);
    
    const firstTicket = await tickets.first().textContent();
    expect(firstTicket).toMatch(/^SP-/);
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
