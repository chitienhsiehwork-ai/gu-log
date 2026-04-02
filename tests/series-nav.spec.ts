import { test, expect } from './fixtures';

/**
 * BDD Tests for Series-aware Navigation (Issue #83)
 *
 * Tests that posts in a series show SeriesNav component with:
 * - Series name and progress indicator
 * - Series-aware prev/next links (not chronological)
 * - Full series article list with read/unread indicators
 *
 * Run with: npx playwright test tests/series-nav.spec.ts
 */

// ECC Series: SP-143 is order 1, SP-144 is order 2, SP-153 is order 8
// Use SP-144 (order 2) as a mid-series post for prev/next tests
const ECC_MID_POST = '/posts/sp-144-20260402-ecc-instinct-system';
const ECC_FIRST_POST = '/posts/sp-143-20260402-ecc-autonomous-loops';
const ECC_LAST_POST = '/posts/sp-153-20260402-ecc-iterative-retrieval';

// SD Deep Dive: SD-11 is order 1, SD-12 is order 2, SD-16 is order 6
const SD_MID_POST = '/posts/sd-12-20260402-claude-code-bad-patterns';
const SD_FIRST_POST = '/posts/sd-11-20260402-ai-agent-memory-architecture';

// Post WITHOUT series
const NO_SERIES_POST = '/posts/claude-is-a-space-to-think';

// EN version
const ECC_MID_POST_EN = '/en/posts/en-sp-144-20260402-ecc-instinct-system';

test.describe('SeriesNav Component — Presence', () => {
  test('1. Post with series shows SeriesNav component', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).toBeVisible();
  });

  test('2. SeriesNav displays correct series name', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).toContainText('Everything Claude Code 全解析');
  });

  test('3. SeriesNav shows progress indicator', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    // SP-144 is order 2 of 8 in ECC series
    const progressIndicator = page.locator('[data-series-progress]');
    await expect(progressIndicator).toBeVisible();
    await expect(progressIndicator).toContainText('2');
    await expect(progressIndicator).toContainText('8');
  });

  test('8. Post WITHOUT series does NOT show SeriesNav', async ({ page }) => {
    await page.goto(NO_SERIES_POST);

    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).not.toBeVisible();
  });
});

test.describe('SeriesNav Component — Prev/Next Navigation', () => {
  test('4. Series prev link points to correct series sibling (not chronological)', async ({
    page,
  }) => {
    await page.goto(ECC_MID_POST);

    // SP-144 (order 2) prev should be SP-143 (order 1), not chronological neighbor
    const seriesPrevLink = page.locator('[data-series-prev]');
    await expect(seriesPrevLink).toBeVisible();

    const href = await seriesPrevLink.getAttribute('href');
    expect(href).toContain('sp-143');
  });

  test('5. Series next link points to correct series sibling', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    // SP-144 (order 2) next should be SP-146 (order 3)
    const seriesNextLink = page.locator('[data-series-next]');
    await expect(seriesNextLink).toBeVisible();

    const href = await seriesNextLink.getAttribute('href');
    expect(href).toContain('sp-146');
  });

  test('6. First post in series has no series-prev link', async ({ page }) => {
    await page.goto(ECC_FIRST_POST);

    // SP-143 is order 1, should have no prev
    const seriesPrevLink = page.locator('[data-series-prev]');
    await expect(seriesPrevLink).not.toBeVisible();
  });

  test('7. Last post in series has no series-next link', async ({ page }) => {
    await page.goto(ECC_LAST_POST);

    // SP-153 is order 8 (last), should have no next
    const seriesNextLink = page.locator('[data-series-next]');
    await expect(seriesNextLink).not.toBeVisible();
  });
});

test.describe('SeriesNav Component — Article List', () => {
  test('9. Original PrevNextNav still exists on posts with series (both navs coexist)', async ({
    page,
  }) => {
    await page.goto(ECC_MID_POST);

    // SeriesNav should be present
    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).toBeVisible();

    // Original PrevNextNav should also be present
    const prevNextNav = page.locator('.prev-next-nav');
    await expect(prevNextNav).toBeVisible();
  });

  test('10. SeriesNav shows full series article list', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    // ECC series has 8 articles - ensure list is visible (expand if collapsed)
    const seriesList = page.locator('[data-series-list]');
    const isListVisible = await seriesList.isVisible();
    if (!isListVisible) {
      const toggleBtn = page.locator('[data-series-list-toggle]');
      await toggleBtn.click();
    }

    await expect(seriesList).toBeVisible();

    const listItems = seriesList.locator('[data-series-item]');
    await expect(listItems).toHaveCount(8);
  });

  test('11. Series list marks current article distinctly', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    // Ensure list is visible (expand if collapsed)
    const seriesList = page.locator('[data-series-list]');
    const isListVisible = await seriesList.isVisible();
    if (!isListVisible) {
      const toggleBtn = page.locator('[data-series-list-toggle]');
      await toggleBtn.click();
    }

    // Current article (SP-144) should be marked distinctly (e.g., aria-current or class)
    const currentItem = page.locator('[data-series-current]');
    await expect(currentItem).toBeVisible();
  });

  test('12. Read/unread indicators present in series list', async ({ page }) => {
    await page.goto(ECC_MID_POST);

    // Ensure list is visible (expand if collapsed)
    const seriesList = page.locator('[data-series-list]');
    const isListVisible = await seriesList.isVisible();
    if (!isListVisible) {
      const toggleBtn = page.locator('[data-series-list-toggle]');
      await toggleBtn.click();
    }

    // Each series item should have a read indicator element
    const readIndicators = page.locator('[data-read-indicator]');
    const count = await readIndicators.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('SeriesNav Component — English Version', () => {
  test('13. English version (/en/posts/) shows SeriesNav correctly', async ({ page }) => {
    await page.goto(ECC_MID_POST_EN);

    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).toBeVisible();

    // Should show series name
    await expect(seriesNav).toContainText('Everything Claude Code');
  });
});

test.describe('SeriesNav Component — Mobile Responsive', () => {
  test('14. Mobile responsive — series list does not overflow', async ({ page }) => {
    // Use mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ECC_MID_POST);

    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).toBeVisible();

    // Check that the series nav doesn't overflow viewport
    const navBox = await seriesNav.boundingBox();
    expect(navBox).not.toBeNull();
    if (navBox) {
      // Width should not exceed viewport
      expect(navBox.x + navBox.width).toBeLessThanOrEqual(400);
    }
  });
});

test.describe('SD Deep Dive Series Navigation', () => {
  test('SD series: first post has no prev, next points to SD-12', async ({ page }) => {
    await page.goto(SD_FIRST_POST);

    const seriesNav = page.locator('[data-series-nav]');
    await expect(seriesNav).toBeVisible();

    // No prev for first
    const seriesPrevLink = page.locator('[data-series-prev]');
    await expect(seriesPrevLink).not.toBeVisible();

    // Next should be SD-12
    const seriesNextLink = page.locator('[data-series-next]');
    await expect(seriesNextLink).toBeVisible();
    const href = await seriesNextLink.getAttribute('href');
    expect(href).toContain('sd-12');
  });

  test('SD series: mid post has both prev and next', async ({ page }) => {
    await page.goto(SD_MID_POST);

    const seriesPrevLink = page.locator('[data-series-prev]');
    await expect(seriesPrevLink).toBeVisible();

    const seriesNextLink = page.locator('[data-series-next]');
    await expect(seriesNextLink).toBeVisible();
  });
});
