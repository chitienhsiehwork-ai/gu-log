/**
 * A11y baseline — full WCAG 2 AA scan across the main route shapes.
 *
 * The existing color-contrast.spec.ts only runs the `color-contrast` rule.
 * This spec runs the broader `wcag2a` + `wcag2aa` ruleset (image-alt,
 * landmarks, link names, ARIA, heading order, label associations, etc.)
 * to catch regressions beyond contrast alone.
 */
import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  { name: 'Home (zh-tw)', path: '/' },
  { name: 'Home (en)', path: '/en/' },
  { name: 'Clawd Picks listing', path: '/clawd-picks/' },
  { name: 'Tags', path: '/tags' },
  { name: 'Glossary', path: '/glossary' },
  { name: 'Level Up index', path: '/level-up' },
  { name: 'CP post (zh-tw)', path: '/posts/cp-291-20260414-anthropic-' },
];

// Rules deliberately excluded:
//  - color-contrast: covered by tests/color-contrast.spec.ts (don't double-report)
//  - region: Astro layouts intentionally use <main> + multiple <article> blocks,
//    which trip the "all content in landmarks" heuristic in some configurations
const EXCLUDED_RULES = ['color-contrast'];

for (const route of ROUTES) {
  test(`a11y baseline — ${route.name} (${route.path})`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(EXCLUDED_RULES)
      // Third-party embeds aren't our DOM
      .exclude('iframe.giscus-frame')
      .analyze();

    if (results.violations.length > 0) {
      const lines = results.violations.flatMap((v) =>
        v.nodes.map(
          (n) => `[${v.id}] ${n.target.join(' > ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`
        )
      );
      // Soft-assert so we get the full list per route, not the first failure
      expect
        .soft(results.violations, `A11y violations on ${route.path}:\n  ${lines.join('\n  ')}`)
        .toHaveLength(0);
    }
  });
}
