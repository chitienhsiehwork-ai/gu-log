import { test, expect } from './fixtures';

/**
 * Tests for MoguNote Component
 *
 * MoguNote is a stylized blockquote for commentary.
 * Run with: npx playwright test tests/mogu-note.spec.ts
 */

test.describe('MoguNote Component', () => {
  const testPostUrl = '/posts/gp-24-20260204-claude-is-a-space-to-think';
  const chineseCollapsiblePostUrl = '/posts/gp-230-20260616-agentic-code-review';
  const englishCollapsiblePostUrl =
    '/en/posts/en-gp-227-20260615-dimillian-codex-mobile-control-center';

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
    await expect(prefix.getByRole('link', { name: 'Mogu 詞彙說明' })).toHaveAttribute(
      'href',
      '/glossary#mogu'
    );
  });

  test('GIVEN MoguNote content WHEN rendered THEN should not be empty', async ({ page }) => {
    await page.goto(testPostUrl);

    // The content is inside the blockquote
    const note = page.locator('.mogu-note').first();
    const text = await note.textContent();

    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('GIVEN an English collapsible MoguNote WHEN toggled THEN controls stay English', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(englishCollapsiblePostUrl);

    const note = page.locator('.mogu-note[data-collapsible="true"]').first();
    const summaryLabel = note.locator('.mogu-note-summary-label');
    const toggle = note.locator('.mogu-note-toggle');

    await expect(summaryLabel).toHaveText('Summary');
    await expect(toggle).toHaveText(/Expand full note/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveText(/Collapse/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(toggle).toHaveText(/Expand full note/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('GIVEN a Chinese collapsible MoguNote WHEN toggled THEN controls stay Chinese', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(chineseCollapsiblePostUrl);

    const note = page.locator('.mogu-note[data-collapsible="true"]').first();
    const summaryLabel = note.locator('.mogu-note-summary-label');
    const toggle = note.locator('.mogu-note-toggle');

    await expect(summaryLabel).toHaveText('短版');
    await expect(toggle).toHaveText(/展開長註解/);

    await toggle.click();
    await expect(toggle).toHaveText(/收合/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
