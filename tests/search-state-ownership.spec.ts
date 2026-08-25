import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

async function waitForSearchReady(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('[data-search-modal]')
        .evaluate((searchModal) => searchModal.parentElement === document.body)
    )
    .toBe(true);
}

test.describe('Search modal state ownership', () => {
  test('restores body overflow without removing inert state owned elsewhere', async ({ page }) => {
    await page.goto('/');
    await waitForSearchReady(page);
    await page.evaluate(() => {
      document.body.style.overflow = 'clip';
      const sentinel = document.createElement('div');
      sentinel.id = 'search-state-owner-sentinel';
      sentinel.setAttribute('inert', '');
      document.body.appendChild(sentinel);
      const transient = document.createElement('div');
      transient.id = 'search-transient-sentinel';
      document.body.appendChild(transient);
    });

    await page.locator('[data-search-trigger]').click();
    await expect(page.locator('[data-search-modal]')).toHaveAttribute('aria-hidden', 'false');
    const transient = page.locator('#search-transient-sentinel');
    await expect(transient).toHaveAttribute('inert', '');
    const transientHandle = await transient.elementHandle();
    if (!transientHandle) throw new Error('transient sentinel was not found');
    await transientHandle.evaluate((element) => element.remove());
    await page.keyboard.press('Escape');
    await transientHandle.evaluate((element) => document.body.appendChild(element));

    await expect(page.locator('[data-search-modal]')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#search-state-owner-sentinel')).toHaveAttribute('inert', '');
    await expect(transient).not.toHaveAttribute('inert', '');
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('clip');
  });

  test('preserves a PostImage dialog body lock and focus when search closes', async ({ page }) => {
    await page.goto('/artifacts/zoomable-post-image-fixture/');
    await waitForSearchReady(page);

    await page.locator('[data-post-image-open]').first().click();
    const imageDialog = page.locator('[data-post-image-dialog]').first();
    const imageClose = imageDialog.locator('[data-post-image-close]');
    await expect(imageDialog).toBeVisible();
    await expect(imageClose).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/post-image-dialog-open/);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.keyboard.press('Meta+k');
    const searchModal = page.locator('[data-search-modal]');
    await expect(searchModal).toHaveAttribute('aria-hidden', 'false');
    await searchModal.click({ position: { x: 5, y: 5 } });

    await expect(searchModal).toHaveAttribute('aria-hidden', 'true');
    await expect(imageDialog).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/post-image-dialog-open/);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect(imageClose).toBeFocused();
  });
});
