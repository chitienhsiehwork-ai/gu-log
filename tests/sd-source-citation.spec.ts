import { test, expect } from './fixtures';

const BASE = 'http://localhost:4321';

test.describe('SD Posts: Source Citation', () => {
  test('GIVEN an SD (ShroomDog Original) post WHEN viewing THEN source citation should NOT be shown', async ({
    page,
  }) => {
    // Navigate to SD-1 post
    await page.goto(BASE + '/posts/sd-1-20260209-openclaw-talk-deep-dive');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('article.post')).toBeVisible();

    // The source citation block should not exist for SD posts
    const citation = page.locator('.source-citation');
    await expect(citation).toHaveCount(0);
  });

  test('GIVEN a GP (Gu-log Picks) post WHEN viewing THEN source citation SHOULD be shown', async ({
    page,
  }) => {
    await page.goto(BASE + '/posts/gp-24-20260204-claude-is-a-space-to-think');
    await page.waitForLoadState('domcontentloaded');

    const citation = page.locator('.source-citation');
    await expect(citation).toBeVisible();
    await expect(citation).toHaveAttribute('href', /^https?:\/\//);
    const box = await citation.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});
