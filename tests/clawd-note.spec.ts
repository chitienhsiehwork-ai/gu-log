import { test, expect } from './fixtures';

/**
 * Tests for ClawdNote Component
 * 
 * ClawdNote is a stylized blockquote for commentary.
 * Run with: npx playwright test tests/clawd-note.spec.ts
 */

test.describe('ClawdNote Component', () => {
  const testPostUrl = '/posts/claude-is-a-space-to-think';

  test('GIVEN a post with ClawdNote WHEN page loads THEN ClawdNote should be visible', async ({ page }) => {
    await page.goto(testPostUrl);
    
    // It renders as a blockquote with class claude-note
    const clawdNote = page.locator('.claude-note').first();
    await expect(clawdNote).toBeVisible();
  });

  test('GIVEN ClawdNote WHEN rendered THEN it should have a prefix', async ({ page }) => {
    await page.goto(testPostUrl);
    
    const prefix = page.locator('.claude-note .clawd-prefix').first();
    await expect(prefix).toBeVisible();
    await expect(prefix).toContainText('Clawd');
  });

  test('GIVEN ClawdNote content WHEN rendered THEN should not be empty', async ({ page }) => {
    await page.goto(testPostUrl);
    
    // The content is inside the blockquote
    const note = page.locator('.claude-note').first();
    const text = await note.textContent();
    
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
