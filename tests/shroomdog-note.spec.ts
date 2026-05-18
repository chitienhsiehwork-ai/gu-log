import { test, expect } from './fixtures';

test.describe('ShroomDogNote auto-fold', () => {
  const testPostUrl = '/posts/sp-205-20260517-addyosmani-dont-outsource-learning/';

  test('GIVEN a long ShroomDogNote WHEN page loads THEN it is collapsed behind a toggle', async ({ page }) => {
    await page.goto(testPostUrl);

    const note = page.locator('.shroomdog-note').first();
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('data-collapsible', 'true');
    await expect(note).toHaveAttribute('data-collapsed', 'true');

    const toggle = note.locator('.shroomdog-note-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('展開完整 ShroomDogNote');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('GIVEN a collapsed ShroomDogNote WHEN reader clicks toggle THEN it expands and can collapse again', async ({ page }) => {
    await page.goto(testPostUrl);

    const note = page.locator('.shroomdog-note').first();
    const toggle = note.locator('.shroomdog-note-toggle');

    await toggle.click();
    await expect(note).toHaveAttribute('data-collapsed', 'false');
    await expect(toggle).toContainText('收合 ShroomDogNote');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(note).toHaveAttribute('data-collapsed', 'true');
    await expect(toggle).toContainText('展開完整 ShroomDogNote');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
