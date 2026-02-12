import { test, expect } from './fixtures';

/**
 * BDD Tests for Post Pages
 * 
 * General tests for post page rendering and functionality.
 * Run with: npx playwright test tests/post-page.spec.ts
 */

test.describe('Post Page', () => {
  const testPostUrl = '/posts/claude-is-a-space-to-think';

  test('GIVEN a valid post URL WHEN page loads THEN title should be visible', async ({ page }) => {
    await page.goto(testPostUrl);
    
    const title = page.locator('h1').first();
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
  });

  test('GIVEN a post with headings WHEN rendered THEN all h2 headings should have IDs for anchoring', async ({ page }) => {
    await page.goto(testPostUrl);
    
    const h2Headings = page.locator('article h2');
    const count = await h2Headings.count();
    
    expect(count).toBeGreaterThan(0);
    
    for (let i = 0; i < count; i++) {
      const heading = h2Headings.nth(i);
      const id = await heading.getAttribute('id');
      expect(id).toBeTruthy();
    }
  });

  test('GIVEN a post WHEN rendered THEN source attribution should be visible', async ({ page }) => {
    await page.goto(testPostUrl);
    
    // Check for source link or attribution
    const sourceLink = page.locator('a[href*="anthropic.com"]');
    await expect(sourceLink).toBeVisible();
  });

  test('GIVEN a post with special characters in headings WHEN rendered THEN MDX should not break', async ({ page }) => {
    // This test catches the < symbol issue that broke TOC before
    await page.goto(testPostUrl);
    
    // Page should load without errors
    const article = page.locator('article');
    await expect(article).toBeVisible();
    
    // No error message should be visible
    const errorMessage = page.locator('text=Error');
    await expect(errorMessage).not.toBeVisible();
  });
});

test.describe('Post Navigation', () => {
  test('GIVEN home page WHEN clicking a post link THEN should navigate to post', async ({ page }) => {
    await page.goto('/');
    
    // Click first post link
    const postLink = page.locator('a[href^="/posts/"]').first();
    const href = await postLink.getAttribute('href');
    
    await postLink.click();
    
    // Should navigate to post page
    await expect(page).toHaveURL(new RegExp(href!));
    
    // Post content should be visible
    await expect(page.locator('article')).toBeVisible();
  });
});
