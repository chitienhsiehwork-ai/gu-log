import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { selectPostTextAndShowPopup } from './helpers/ai-popup';

/**
 * Color Contrast Accessibility Tests (axe-core)
 *
 * Checks WCAG 2.1 AA contrast ratios across all page types:
 * - Normal text ≥ 4.5:1
 * - Large text (≥18pt or ≥14pt bold) ≥ 3:1
 *
 * Run with: npx playwright test tests/color-contrast.spec.ts
 */

// Sample pages covering different layouts
const PAGES = [
  { name: 'Home', path: '/' },
  { name: 'Post (zh-tw)', path: '/posts/agentic-note-taking-verbatim-trap/' },
  { name: 'Mogu Picks listing', path: '/mogu-picks/' },
  { name: 'About', path: '/about/' },
];

const THEMES = ['dark', 'light'] as const;
const TEST_POST = '/posts/gp-24-20260204-claude-is-a-space-to-think';

for (const theme of THEMES) {
  test.describe(`Color contrast — ${theme} theme`, () => {
    for (const pg of PAGES) {
      test(`${pg.name} (${pg.path}) passes WCAG AA`, async ({ page }) => {
        // Set theme before navigation via localStorage
        await page.addInitScript((t) => {
          localStorage.setItem('theme', t);
        }, theme);

        await page.goto(pg.path, { waitUntil: 'networkidle' });

        // Force theme class on <html> in case the toggle script reads differently
        await page.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
        }, theme);

        // Wait for styles to settle
        await page.waitForTimeout(300);

        const results = await new AxeBuilder({ page })
          .withRules(['color-contrast'])
          // Exclude third-party embed UI (giscus iframe) from first-party contrast audit.
          // Giscus is hosted on giscus.app and themed via remote CSS URL, so local test runs
          // can otherwise produce external-noise violations unrelated to this repo's DOM/CSS.
          .exclude('iframe.giscus-frame')
          // WCAG 2.1 SC 1.4.3: text that is part of an inactive UI component has no
          // contrast requirement. aria-disabled="true" marks that state explicitly.
          .exclude('[aria-disabled="true"]')
          .analyze();

        // Collect violations with useful debug info
        const violations = results.violations.flatMap((v) =>
          v.nodes.map((n) => ({
            html: n.html.slice(0, 120),
            target: n.target.join(' > '),
            message: n.failureSummary?.split('\n')[1]?.trim() ?? n.failureSummary,
          }))
        );

        if (violations.length > 0) {
          const report = violations
            .map((v, i) => `  ${i + 1}. ${v.target}\n     ${v.html}\n     ${v.message}`)
            .join('\n');
          expect.soft(violations, `Contrast violations (${theme}):\n${report}`).toHaveLength(0);
        }
      });
    }
  });
}
for (const theme of THEMES) {
  test(`AI popup auth error passes WCAG AA — ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('theme', t);
    }, theme);
    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: 9999999999 }));
      localStorage.setItem('gu-log-jwt', `${header}.${payload}.fake-signature`);
    });
    await page.reload();
    await page.route('**/ai/edit', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Token has expired' }),
      });
    });

    const popup = await selectPostTextAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();
    await popup.locator('.ai-popup-edit-input').fill('Make it clearer');
    await popup.locator('[data-action="submit-edit"]').click();
    await expect(popup.locator('.ai-popup-result--auth-error')).toBeVisible({ timeout: 10000 });

    const results = await new AxeBuilder({ page })
      .include('.ai-popup-result--auth-error')
      .withRules(['color-contrast'])
      .analyze();

    const violations = results.violations.flatMap((violation) =>
      violation.nodes.map((node) => ({
        target: node.target.join(' > '),
        message: node.failureSummary?.split('\n')[1]?.trim() ?? node.failureSummary,
      }))
    );

    expect(violations, `Auth error contrast violations (${theme})`).toHaveLength(0);
  });
}

test.describe('DiffBlock color contrast', () => {
  for (const theme of THEMES) {
    test(`${theme} theme passes WCAG AA`, async ({ page }) => {
      await page.addInitScript((activeTheme) => {
        localStorage.setItem('theme', activeTheme);
      }, theme);
      await page.goto('/posts/sd-19-20260409-lightning-talk-ralph-loop/', {
        waitUntil: 'networkidle',
      });
      await page.evaluate((activeTheme) => {
        document.documentElement.dataset.theme = activeTheme;
      }, theme);
      await page.waitForTimeout(300);

      const results = await new AxeBuilder({ page })
        .include('.diff-block')
        .withRules(['color-contrast'])
        .analyze();

      const violations = results.violations.flatMap((violation) =>
        violation.nodes.map((node) => ({
          target: node.target.join(' > '),
          message: node.failureSummary,
        }))
      );
      expect(violations).toEqual([]);

      const body = page.locator('.diff-body').first();
      await body.evaluate((element) => {
        element.textContent = 'W'.repeat(120);
      });
      const overflow = await body.evaluate((element) => ({
        body: element.scrollWidth - element.clientWidth,
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect(overflow).toEqual({ body: 0, document: 0 });
    });
  }
});
