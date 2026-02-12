import { test, expect } from './fixtures';

/**
 * BDD Tests for ClawdNote Component
 * 
 * ClawdNote is a collapsible note component that appears in posts.
 * Run with: npx playwright test tests/clawd-note.spec.ts
 */

test.describe('ClawdNote Component', () => {
  // Use a post that definitely has ClawdNote
  const testPostUrl = '/posts/claude-is-a-space-to-think';

  test('GIVEN a post with ClawdNote WHEN page loads THEN ClawdNote should be visible', async ({ page }) => {
    await page.goto(testPostUrl);
    
    const clawdNote = page.locator('.clawd-note').first();
    await expect(clawdNote).toBeVisible();
  });

  test('GIVEN ClawdNote is collapsed WHEN user clicks header THEN content should expand', async ({ page }) => {
    await page.goto(testPostUrl);
    
    const container = page.locator('.clawd-note .toggle-container').first();
    const header = page.locator('.clawd-note .toggle-header').first();
    
    // Get initial state
    const initialState = await container.getAttribute('data-open');
    
    // If initially closed, click to open
    if (initialState === 'false') {
      await header.click();
      await expect(container).toHaveAttribute('data-open', 'true');
    }
    
    // Click to toggle
    await header.click();
    
    // State should have changed
    const newState = await container.getAttribute('data-open');
    expect(newState).not.toBe(initialState === 'false' ? 'true' : 'false');
  });

  test('GIVEN ClawdNote content WHEN rendered THEN should not be empty', async ({ page }) => {
    await page.goto(testPostUrl);
    
    const content = page.locator('.clawd-note .toggle-content').first();
    const text = await content.textContent();
    
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
