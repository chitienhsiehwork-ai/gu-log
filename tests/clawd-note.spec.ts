import { test, expect } from './fixtures';

/**
 * Tests for MoguNote Component
 *
 * MoguNote is a stylized blockquote for commentary.
 * Run with: npx playwright test tests/mogu-note.spec.ts
 */

test.describe('MoguNote Component', () => {
  const testPostUrl = '/posts/claude-is-a-space-to-think';

  test('GIVEN a post with MoguNote WHEN page loads THEN MoguNote should be visible', async ({
    page,
  }) => {
    await page.goto(testPostUrl);

    const moguNote = page.locator('.mogu-note').first();
    await expect(moguNote).toBeVisible();
  });

  test('GIVEN MoguNote WHEN rendered THEN it should have a prefix', async ({ page }) => {
    await page.goto(testPostUrl);

    const prefix = page.locator('.mogu-note .mogu-prefix').first();
    await expect(prefix).toBeVisible();
    await expect(prefix).toContainText('Mogu');
  });

  test('GIVEN MoguNote content WHEN rendered THEN should not be empty', async ({ page }) => {
    await page.goto(testPostUrl);

    // The content is inside the blockquote
    const note = page.locator('.mogu-note').first();
    const text = await note.textContent();

    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
