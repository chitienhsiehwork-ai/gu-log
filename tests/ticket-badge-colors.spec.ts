import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Ticket Badge Color Consistency Tests (#597)
 *
 * Deterministic canonical-article regression guard: mp-6 is flanked on both
 * sides (by originalDate, across the whole zh-tw collection) by other MP
 * posts — mp-15 (prev) and mp-17 (next) — so the typed article badge and
 * neutral `.prev-next-nav .nav-ticket` metadata are both present on this page.
 * No data-dependent skip needed.
 */

const MP_POST_PATH = '/posts/mp-6-20260203-sholto-continual-learning';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;

// Resolve a CSS custom property to its browser-computed color, in the same
// format getComputedStyle returns for real elements, so it can be compared
// directly without hand-rolling hex/rgb conversion.
async function resolveColorToken(page: Page, varName: string): Promise<string> {
  return page.evaluate((v: string) => {
    const el = document.createElement('div');
    el.style.color = `var(${v})`;
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).color;
    el.remove();
    return rgb;
  }, varName);
}

for (const theme of ['dark', 'light'] as const) {
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`Ticket Badge Colors — ${theme} theme, ${viewportName}`, () => {
      test.use({ viewport });

      test('GIVEN the canonical MP post WHEN checking article metadata THEN the badge keeps MP color while onward navigation stays neutral', async ({
        page,
      }) => {
        await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
        await page.goto(MP_POST_PATH);
        await page.waitForLoadState('networkidle');

        const mpToken = await resolveColorToken(page, '--color-badge-mp');
        const gpToken = await resolveColorToken(page, '--color-badge-gp');
        expect(mpToken).not.toBe(gpToken);

        const metaBadge = page.locator('.post-meta-row .ticket-mp');
        await expect(metaBadge).toBeVisible();
        const metaColor = await metaBadge.evaluate((el) => getComputedStyle(el).color);
        expect(metaColor).toBe(mpToken);
        expect(metaColor).not.toBe(gpToken);

        const neutralToken = await resolveColorToken(page, '--color-text-muted');
        const navBadges = page.locator('.prev-next-nav .nav-ticket');
        const navCount = await navBadges.count();
        expect(navCount).toBeGreaterThan(0);
        for (let i = 0; i < navCount; i++) {
          const navColor = await navBadges.nth(i).evaluate((el) => getComputedStyle(el).color);
          expect(navColor).toBe(neutralToken);
          expect(navColor).not.toBe(mpToken);
          expect(navColor).not.toBe(gpToken);
        }
      });
    });
  }
}
