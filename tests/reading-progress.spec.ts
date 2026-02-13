import { test, expect } from './fixtures';

/**
 * Reading Progress Bar Tests
 * 
 * Tests the reading progress indicator that appears at the top.
 * Covers: initial state, scroll progress, completion.
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

test.describe('Reading Progress Bar', () => {
  test('GIVEN a post page WHEN loaded THEN progress bar should exist at 0%', async ({ page }) => {
    await page.goto(TEST_POST);
    
    const progressBar = page.locator('#reading-progress');
    await expect(progressBar).toBeAttached();
    
    // Initial width should be 0% or very small
    const width = await progressBar.evaluate(el => parseFloat(el.style.width) || 0);
    expect(width).toBeLessThan(5);
  });

  test('GIVEN a post page WHEN scrolled to middle THEN progress should be around 50%', async ({ page }) => {
    await page.goto(TEST_POST);
    await page.waitForLoadState('networkidle');
    
    // Scroll to roughly middle of page
    await page.evaluate(() => {
      const scrollHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      window.scrollTo(0, (scrollHeight - viewportHeight) / 2);
    });
    
    // Wait for RAF update
    await page.waitForTimeout(200);
    
    const progressBar = page.locator('#reading-progress');
    const width = await progressBar.evaluate(el => parseFloat(el.style.width) || 0);
    
    // Should be roughly in the middle (30-70% range)
    expect(width).toBeGreaterThan(20);
    expect(width).toBeLessThan(80);
  });

  test('GIVEN a post page WHEN scrolled to bottom THEN progress should be 100%', async ({ page }) => {
    await page.goto(TEST_POST);
    await page.waitForLoadState('networkidle');
    
    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    
    const progressBar = page.locator('#reading-progress');
    const width = await progressBar.evaluate(el => parseFloat(el.style.width) || 0);
    
    expect(width).toBe(100);
  });

  test('GIVEN progress bar WHEN viewed THEN should be fixed at top of viewport', async ({ page }) => {
    await page.goto(TEST_POST);
    
    const progressBar = page.locator('#reading-progress');
    const position = await progressBar.evaluate(el => window.getComputedStyle(el).position);
    expect(position).toBe('fixed');
    
    const top = await progressBar.evaluate(el => window.getComputedStyle(el).top);
    expect(top).toBe('0px');
  });
});
