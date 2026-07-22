import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Renders key pages at mobile + desktop widths and asserts there is NO
// horizontal overflow — i.e. document.scrollWidth must not exceed the viewport.
// This is the "you can scroll sideways / the layout blew out" bug. It shows up
// most often on bespoke /artifacts/ pages and on posts that embed raw HTML,
// where a width:100vw element or a negative-inset decoration pushes past the
// viewport edge.
//
// Coverage is the high-risk subset on purpose — every /artifacts/ page (auto-
// discovered) plus the home page and one HTML-heavy post — NOT all ~3k pages,
// so the gate stays fast. If a blowout ever ships from somewhere else, add the
// offending route to ROUTES rather than widening to the whole site.

const here = dirname(fileURLToPath(import.meta.url));
const artifactsDir = resolve(here, '../src/pages/artifacts');

const artifactRoutes = readdirSync(artifactsDir)
  .filter((f) => f.endsWith('.astro'))
  .map((f) => `/artifacts/${f.replace(/\.astro$/, '')}/`);

const ROUTES = ['/', '/posts/gp-245-20260624-mattpocockuk-skill-no-op/', ...artifactRoutes];

const WIDTHS = [
  { label: 'mobile-390', width: 390, height: 844 },
  { label: 'desktop-1280', width: 1280, height: 800 },
];

for (const route of ROUTES) {
  for (const vp of WIDTHS) {
    test(`no horizontal overflow: ${route} @ ${vp.label}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await ctx.newPage();
      await page.goto(route, { waitUntil: 'networkidle' });
      const { scrollW, innerW, offenders } = await page.evaluate(() => {
        const vw = window.innerWidth;
        const out: string[] = [];
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1 || r.left < -1) {
            const cls = typeof el.className === 'string' ? el.className : '';
            out.push(`${el.tagName}.${cls}`.trim().slice(0, 60));
          }
        });
        return {
          scrollW: document.documentElement.scrollWidth,
          innerW: vw,
          offenders: out.slice(0, 8),
        };
      });
      await ctx.close();
      expect(
        scrollW,
        `Horizontal overflow on ${route} @ ${vp.width}px: scrollWidth ${scrollW} > viewport ${innerW}. First offenders: ${offenders.join(' | ')}`
      ).toBeLessThanOrEqual(innerW + 1);
    });
  }
}
