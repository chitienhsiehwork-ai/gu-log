import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

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
  { name: 'Clawd Picks listing', path: '/clawd-picks/' },
  { name: 'About', path: '/about/' },
];

const THEMES = ['dark', 'light'] as const;

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
          .analyze();

        // Collect violations with useful debug info
        const violations = results.violations.flatMap(v =>
          v.nodes.map(n => ({
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
