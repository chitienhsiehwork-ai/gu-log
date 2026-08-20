import { test, expect } from './fixtures';

const TEST_URL = '/artifacts/gp-245-trim-noop/';

test.describe('Code copy button theme contract', () => {
  test('resets copied feedback two seconds after the latest successful copy', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.resolve(),
        },
      });
    });
    await page.clock.install();

    await page.goto(TEST_URL);

    const copyButton = page.locator('.copy-button').first();
    const copyText = copyButton.locator('.copy-text');
    await copyButton.click();
    await expect(copyButton).toHaveClass(/copied/);
    await expect(copyText).toHaveText('Copied!');

    await page.clock.fastForward(1000);
    await copyButton.click();
    await expect(copyText).toHaveText('Copied!');

    await page.clock.fastForward(1001);
    await expect(copyButton).toHaveClass(/copied/);
    await expect(copyText).toHaveText('Copied!');

    await page.clock.fastForward(999);
    await expect(copyButton).not.toHaveClass(/copied/);
    await expect(copyText).toHaveText('Copy');
  });

  test('re-running the Astro page-load initializer keeps existing wrappers and initializes new code blocks', async ({
    page,
  }) => {
    await page.goto(TEST_URL);

    const wrappers = page.locator('.code-block-wrapper');
    const buttons = page.locator('.copy-button');
    const initialCount = await wrappers.count();
    expect(initialCount).toBeGreaterThan(0);
    await expect(buttons).toHaveCount(initialCount);

    await page.evaluate(() => {
      const pre = document.createElement('pre');
      pre.dataset.copyInitFixture = '';
      const code = document.createElement('code');
      code.textContent = 'new code block';
      pre.append(code);
      document.querySelector('main')?.append(pre);
      document.dispatchEvent(new Event('astro:page-load'));
    });

    await expect(wrappers).toHaveCount(initialCount + 1);
    await expect(buttons).toHaveCount(initialCount + 1);
    await expect(page.locator('.code-block-wrapper .code-block-wrapper')).toHaveCount(0);
    const addedWrapper = page.locator('pre[data-copy-init-fixture]').locator('..');
    await expect(addedWrapper).toHaveClass(/code-block-wrapper/);
    await expect(addedWrapper.locator('.copy-button')).toHaveCount(1);
  });

  test('GIVEN both themes WHEN code blocks render THEN the copy button uses the matching palette and exposes keyboard focus', async ({
    page,
  }) => {
    const response = await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    const buttons = page.locator('.copy-button');
    await expect(buttons).toHaveCount(2);

    const expected = {
      light: {
        background: 'rgba(253, 246, 227, 0.96)',
        color: 'rgb(51, 65, 85)',
      },
      dark: {
        background: 'rgba(39, 41, 52, 0.96)',
        color: 'rgb(217, 222, 242)',
      },
    };

    for (const theme of ['light', 'dark'] as const) {
      await page.mouse.move(0, 0);
      await page.evaluate((activeTheme) => {
        document.documentElement.dataset.theme = activeTheme;
      }, theme);

      const button = buttons.first();
      await expect(button).toHaveCSS('background-color', expected[theme].background);
      await expect(button).toHaveCSS('color', expected[theme].color);

      const styles = await button.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          opacity: style.opacity,
          hoverNone: matchMedia('(hover: none)').matches,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(styles.opacity, theme).toBe(styles.hoverNone ? '1' : '0');
      expect(styles.overflow, theme).toBe(0);

      if (!styles.hoverNone) {
        await buttons
          .first()
          .locator('..')
          .hover({ position: { x: 10, y: 10 } });
        await expect(buttons.first()).toHaveCSS('opacity', '1');
      }

      await page.mouse.move(0, 0);
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      await expect(button).toHaveCSS('opacity', '1');

      await button.evaluate((element) => element.blur());
      if (!styles.hoverNone) {
        await expect(button).toHaveCSS('opacity', '0');
      }
    }
  });
});
