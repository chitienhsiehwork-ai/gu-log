import { test, expect } from './fixtures';

test.describe('ShroomDogNote auto-fold', () => {
  const testPostUrl = '/posts/gp-205-20260517-addyosmani-dont-outsource-learning/';
  const sd26PostUrl = '/posts/sd-26-20260616-loop-engineering-at-gu-log/';

  test('GIVEN a long ShroomDogNote WHEN page loads THEN it is collapsed behind a toggle', async ({ page }) => {
    await page.goto(testPostUrl);

    const note = page.locator('.shroomdog-note').first();
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('data-collapsible', 'true');
    await expect(note).toHaveAttribute('data-collapsed', 'true');

    const toggle = note.locator('.shroomdog-note-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('展開完整 Note');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('GIVEN a collapsed ShroomDogNote WHEN reader clicks toggle THEN it expands and can collapse again', async ({ page }) => {
    await page.goto(testPostUrl);

    const note = page.locator('.shroomdog-note').first();
    const toggle = note.locator('.shroomdog-note-toggle');

    await toggle.click();
    await expect(note).toHaveAttribute('data-collapsed', 'false');
    await expect(toggle).toContainText('收合 Note');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(note).toHaveAttribute('data-collapsed', 'true');
    await expect(toggle).toContainText('展開完整 Note');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('GIVEN a visible ShroomDogNote toggle THEN expanding reveals meaningful hidden content', async ({
    page,
  }) => {
    await page.goto(sd26PostUrl);

    const badToggles = await page.locator('.shroomdog-note').evaluateAll((notes) =>
      notes
        .map((note, index) => {
          const content = note.querySelector<HTMLElement>('.shroomdog-note-content');
          const toggle = note.querySelector<HTMLButtonElement>('.shroomdog-note-toggle');
          if (!content || !toggle || toggle.hidden) return null;

          const threshold = Number(
            (note as HTMLElement).dataset.collapseThreshold ||
              getComputedStyle(content).getPropertyValue('--shroomdog-note-collapsed-height').replace('px', '') ||
              260
          );
          const hiddenHeight = content.scrollHeight - threshold;
          return hiddenHeight >= 72
            ? null
            : {
                index,
                hiddenHeight,
                label: toggle.textContent?.trim(),
                text: content.textContent?.trim().slice(0, 80),
              };
        })
        .filter(Boolean)
    );

    expect(badToggles).toEqual([]);
  });

  test('GIVEN SD-26 on mobile with larger text WHEN page loads THEN short single-paragraph notes do not show toggles', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = 'html { font-size: 22px !important; }';
      document.head.appendChild(style);
    });
    await page.goto(sd26PostUrl);

    const visibleToggles = await page.locator('.shroomdog-note').evaluateAll((notes) =>
      notes
        .map((note, index) => {
          const content = note.querySelector<HTMLElement>('.shroomdog-note-content');
          const toggle = note.querySelector<HTMLButtonElement>('.shroomdog-note-toggle');
          if (!content || !toggle || toggle.hidden) return null;

          return {
            index,
            paragraphCount: content.querySelectorAll('p').length,
            textLength: content.textContent?.trim().length,
            scrollHeight: content.scrollHeight,
            label: toggle.textContent?.trim(),
            text: content.textContent?.trim().slice(0, 80),
          };
        })
        .filter(Boolean)
    );

    expect(visibleToggles).toEqual([]);
  });
});
