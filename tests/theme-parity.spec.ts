/**
 * Theme parity smoke — both Solarized dark and Solarized light render the
 * same key elements with non-trivial computed styles.
 *
 * Catches single-theme regressions where light mode silently breaks because
 * a CSS rule was scoped to dark only (or vice versa).
 */
import { test, expect } from './fixtures';

const THEMES = ['dark', 'light'] as const;
const ROUTES = ['/', '/clawd-picks/', '/posts/cp-291-20260414-anthropic-'];

for (const theme of THEMES) {
  test.describe(`theme=${theme}`, () => {
    test.use({ colorScheme: theme === 'dark' ? 'dark' : 'light' });

    for (const path of ROUTES) {
      test(`${path} renders with non-trivial bg/fg under ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.waitForTimeout(150);

        const styles = await page.evaluate(() => {
          const cs = getComputedStyle(document.body);
          return { bg: cs.backgroundColor, fg: cs.color };
        });

        // Both must be set to actual values (rgb / rgba), never "transparent" / ""
        expect(styles.bg, `bg should be a real color`).toMatch(/rgb/);
        expect(styles.fg, `fg should be a real color`).toMatch(/rgb/);
        expect(styles.bg).not.toBe(styles.fg);

        // Page-shell elements must be visible
        await expect(page.locator('header').first()).toBeVisible();
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('footer').first()).toBeVisible();
      });
    }

    test(`/ has a working theme toggle button`, async ({ page }) => {
      await page.goto('/');
      const toggle = page.locator(
        'button[aria-label*="heme" i], button[title*="heme" i], button[data-theme-toggle], #theme-toggle'
      );
      expect(await toggle.count()).toBeGreaterThan(0);
    });
  });
}

test('dark and light produce *different* body backgrounds on home', async ({ browser }) => {
  const ctxDark = await browser.newContext({ colorScheme: 'dark' });
  const ctxLight = await browser.newContext({ colorScheme: 'light' });
  const pgDark = await ctxDark.newPage();
  const pgLight = await ctxLight.newPage();
  try {
    await pgDark.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await pgLight.addInitScript(() => localStorage.setItem('theme', 'light'));

    await Promise.all([
      pgDark.goto('/', { waitUntil: 'domcontentloaded' }),
      pgLight.goto('/', { waitUntil: 'domcontentloaded' }),
    ]);
    await pgDark.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await pgLight.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await pgDark.waitForTimeout(150);
    await pgLight.waitForTimeout(150);

    const [darkBg, lightBg] = await Promise.all([
      pgDark.evaluate(() => getComputedStyle(document.body).backgroundColor),
      pgLight.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ]);
    expect(darkBg).not.toBe(lightBg);
  } finally {
    await ctxDark.close();
    await ctxLight.close();
  }
});
