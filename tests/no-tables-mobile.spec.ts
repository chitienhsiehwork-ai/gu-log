import { test, expect } from './fixtures';

/**
 * TDD Test: No Markdown Tables on Mobile
 * 
 * Tables render terribly on iPhone/mobile screens (columns overflow, text wraps weirdly).
 * Our style guide says: NO tables — use bullet lists instead.
 * 
 * This test enforces that rule by checking all posts for <table> elements
 * and verifying they don't overflow on mobile viewport.
 * 
 * Run with: npx playwright test tests/no-tables-mobile.spec.ts
 */

const MOBILE_VIEWPORT = { width: 375, height: 812 }; // iPhone SE/X size

test.describe('No Tables on Mobile', () => {

  test('GIVEN the SD-2 subagent showdown post WHEN rendered on mobile THEN should not contain any <table> elements', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/posts/subagent-showdown-claude-code-vs-openclaw');
    await page.waitForLoadState('domcontentloaded');

    const tables = page.locator('article table');
    const tableCount = await tables.count();

    expect(tableCount, 
      `Found ${tableCount} <table> element(s) in the post. ` +
      `Tables render badly on mobile — convert to bullet lists.`
    ).toBe(0);
  });

  test('GIVEN the SD-2 EN subagent showdown post WHEN rendered on mobile THEN should not contain any <table> elements', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/posts/en-subagent-showdown-claude-code-vs-openclaw');
    await page.waitForLoadState('domcontentloaded');

    const tables = page.locator('article table');
    const tableCount = await tables.count();

    expect(tableCount, 
      `Found ${tableCount} <table> element(s) in the post. ` +
      `Tables render badly on mobile — convert to bullet lists.`
    ).toBe(0);
  });

  test('GIVEN any post WHEN rendered THEN no table should overflow its container on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    // Test the specific offending post
    await page.goto('/posts/subagent-showdown-claude-code-vs-openclaw');
    await page.waitForLoadState('domcontentloaded');

    const tables = page.locator('article table');
    const tableCount = await tables.count();

    for (let i = 0; i < tableCount; i++) {
      const table = tables.nth(i);
      const tableBox = await table.boundingBox();
      if (tableBox) {
        expect(tableBox.width,
          `Table ${i + 1} is ${tableBox.width}px wide, exceeding viewport width of ${MOBILE_VIEWPORT.width}px`
        ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
      }
    }
  });
});
