import { test, expect } from './fixtures';

const TEST_URL = '/artifacts/gp-245-trim-noop/';

test.describe('Code copy button theme contract', () => {
  test('GIVEN both themes WHEN code blocks render THEN the copy button uses the matching palette', async ({
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
      await page.evaluate((activeTheme) => {
        document.documentElement.dataset.theme = activeTheme;
      }, theme);
      await page.waitForTimeout(250);

      const styles = await buttons.first().evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          background: style.backgroundColor,
          color: style.color,
          opacity: style.opacity,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(styles.background, theme).toBe(expected[theme].background);
      expect(styles.color, theme).toBe(expected[theme].color);
      expect(styles.opacity, theme).toBe('1');
      expect(styles.overflow, theme).toBe(0);
    }
  });
});
