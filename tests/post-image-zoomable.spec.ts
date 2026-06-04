import { test, expect } from './fixtures';

const FIXTURE = '/artifacts/zoomable-post-image-fixture/';

test.describe('Zoomable post images', () => {
  test('opens and closes an expanded image without losing the opener', async ({ page }) => {
    await page.goto(FIXTURE);

    const openers = page.locator('[data-post-image-open]');
    await expect(openers).toHaveCount(2);

    const firstOpener = openers.first();
    await firstOpener.focus();
    await expect(firstOpener).toBeFocused();
    await firstOpener.press('Enter');

    const dialog = page.locator('[data-post-image-dialog]').first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    const expanded = dialog.locator('[data-post-image-expanded-img]');
    await expect(expanded).toHaveAttribute('src', /wide-figure/);

    const close = dialog.locator('[data-post-image-close]');
    await expect(close).toBeFocused();
    await close.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(firstOpener).toBeFocused();
  });

  test('keeps mobile pinch/pan CSS contract and safe close target', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(FIXTURE);

    await page.locator('[data-post-image-open]').first().click();
    const dialog = page.locator('[data-post-image-dialog]').first();
    await expect(dialog).toBeVisible();

    const touchAction = await dialog.evaluate((el) => getComputedStyle(el).touchAction);
    expect(['manipulation', 'pan-x pan-y pinch-zoom']).toContain(touchAction);

    const scrollTouchAction = await dialog
      .locator('[data-post-image-scroll]')
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(['manipulation', 'pan-x pan-y pinch-zoom']).toContain(scrollTouchAction);

    const closeBox = await dialog.locator('[data-post-image-close]').boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
  });
});
