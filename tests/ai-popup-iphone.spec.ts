import { test, expect } from './fixtures';

/**
 * AI Popup – iPhone E2E Bug Tests
 *
 * These tests capture bugs found during iPhone emulation testing.
 * Written as RED tests first — they should FAIL until fixes are applied.
 *
 * Methodology: iPhone 14 viewport (390x664), touch-enabled, DPR 3.
 * Uses programmatic text selection since Playwright can't emulate iOS long-press natively.
 *
 * Run with: npx playwright test tests/ai-popup-iphone.spec.ts --project="Mobile Chrome"
 */

const TEST_POST = '/posts/claude-is-a-space-to-think';

/** Select text in .post-content and trigger popup via touchend */
async function selectAndShowPopup(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const p = document.querySelector('.post-content p');
    if (!p || !p.firstChild) throw new Error('No post-content paragraph found');
    const range = document.createRange();
    const textNode = p.firstChild;
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(textNode.textContent?.length || 30, 30));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.evaluate(() => {
    document.dispatchEvent(new Event('touchend', { bubbles: true }));
  });
  await page.waitForTimeout(100);
}

/** Set a fake JWT so the user appears logged in */
async function loginWithFakeJWT(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
    localStorage.setItem('gu-log-jwt', header + '.' + payload + '.fake');
  });
}

test.describe('AI Popup – iPhone Bugs', () => {
  test.beforeEach(async () => {
    const isMobile = test.info().project.name === 'Mobile Chrome';
    if (!isMobile) test.skip();
  });

  test('BUG-1: Bottom sheet must NOT overflow viewport', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup).toHaveClass(/ai-popup--mobile/);

    // The popup's bottom edge must not exceed the viewport height
    const overflow = await page.evaluate(() => {
      const popup = document.getElementById('ai-popup');
      if (!popup) return { ok: false, reason: 'no popup' };
      const rect = popup.getBoundingClientRect();
      return {
        ok: rect.bottom <= window.innerHeight,
        popupBottom: Math.round(rect.bottom),
        viewportHeight: window.innerHeight,
        overflow: Math.round(rect.bottom - window.innerHeight),
      };
    });

    expect(overflow.ok, `Popup overflows viewport by ${overflow.overflow}px (bottom=${overflow.popupBottom}, viewport=${overflow.viewportHeight})`).toBe(true);
  });

  test('BUG-3: Input field must remain visible when virtual keyboard is up', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Tap Ask AI to show input
    await popup.locator('[data-action="ask"]').tap();
    await page.waitForTimeout(200);

    const input = popup.locator('.ai-popup-question-input');
    await expect(input).toBeVisible();

    // Simulate iOS keyboard by shrinking viewport
    // iPhone keyboard is typically 260-320px tall
    const originalViewport = page.viewportSize()!;
    const keyboardHeight = 300;
    await page.setViewportSize({
      width: originalViewport.width,
      height: originalViewport.height - keyboardHeight,
    });
    await page.waitForTimeout(200);

    // The input field must still be within the (now smaller) viewport
    const inputVisible = await page.evaluate(() => {
      const input = document.querySelector('.ai-popup-question-input');
      if (!input) return { ok: false, reason: 'no input' };
      const rect = input.getBoundingClientRect();
      return {
        ok: rect.bottom <= window.innerHeight && rect.top >= 0,
        inputBottom: Math.round(rect.bottom),
        viewportHeight: window.innerHeight,
        gap: Math.round(rect.bottom - window.innerHeight),
      };
    });

    // Restore viewport
    await page.setViewportSize(originalViewport);

    expect(inputVisible.ok, `Input hidden behind keyboard: bottom=${inputVisible.inputBottom}, viewport=${inputVisible.viewportHeight}`).toBe(true);
  });

  test('BUG-4: Touch targets must meet Apple HIG minimum (44px height)', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // All interactive buttons in the mobile popup must have >= 44px height
    const buttonSizes = await page.evaluate(() => {
      const popup = document.getElementById('ai-popup');
      if (!popup) return [];
      return [...popup.querySelectorAll('button')].map(btn => {
        const rect = btn.getBoundingClientRect();
        return {
          text: btn.textContent?.trim().substring(0, 30) || '',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    });

    expect(buttonSizes.length).toBeGreaterThan(0);

    for (const btn of buttonSizes) {
      expect(btn.height, `Button "${btn.text}" height ${btn.height}px < 44px minimum`).toBeGreaterThanOrEqual(44);
    }
  });

  test('BUG-5: Bottom sheet must handle iOS safe area insets', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup).toHaveClass(/ai-popup--mobile/);

    // Check that the bottom sheet uses safe area padding
    const hasSafeArea = await page.evaluate(() => {
      const popup = document.getElementById('ai-popup');
      if (!popup) return false;

      // Check computed padding-bottom includes safe area
      // On devices with home indicator, env(safe-area-inset-bottom) > 0
      // In emulation it's 0, but the CSS should reference it
      const styles = document.querySelectorAll('style');
      for (const s of styles) {
        if (s.textContent?.includes('safe-area-inset-bottom') && s.textContent?.includes('ai-popup')) {
          return true;
        }
      }

      // Also check inline styles
      return popup.style.paddingBottom?.includes('safe-area') || false;
    });

    expect(hasSafeArea, 'Bottom sheet CSS must include env(safe-area-inset-bottom) for notched iPhones').toBe(true);
  });

  test('BUG-2: Selected text context must be preserved visually after tapping Ask AI', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Record what text was selected
    const textBefore = await page.evaluate(() => window.getSelection()?.toString().trim() || '');
    expect(textBefore.length).toBeGreaterThan(0);

    // Tap Ask AI
    await popup.locator('[data-action="ask"]').tap();
    await page.waitForTimeout(200);

    // After tapping, the popup should still show what text was selected
    // Either by preserving the browser selection OR showing a "selected text" indicator
    const hasVisualContext = await page.evaluate(() => {
      // Check 1: browser selection still exists
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) return true;

      // Check 2: popup shows the selected text somewhere (e.g., a quote block)
      const popup = document.getElementById('ai-popup');
      if (!popup) return false;
      const texts = popup.innerText;
      // The original selected text should appear somewhere in the popup
      // (even abbreviated) as context for the user
      return false; // Currently neither is implemented
    });

    expect(hasVisualContext, 'User must see what text they selected after tapping Ask AI').toBe(true);
  });

  test('UX-1: Mobile bottom sheet should have drag handle affordance', async ({ page }) => {
    await page.goto(TEST_POST);
    await loginWithFakeJWT(page);
    await page.reload();

    await selectAndShowPopup(page);

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup).toHaveClass(/ai-popup--mobile/);

    // Bottom sheet should have a visual drag handle (common iOS/Android pattern)
    const hasDragHandle = await page.evaluate(() => {
      const popup = document.getElementById('ai-popup');
      if (!popup) return false;
      // Look for a drag handle element (thin bar at top)
      return !!popup.querySelector('[class*="handle"], [class*="drag"], [aria-label*="drag"]');
    });

    expect(hasDragHandle, 'Mobile bottom sheet should have a drag handle for better UX').toBe(true);
  });
});
