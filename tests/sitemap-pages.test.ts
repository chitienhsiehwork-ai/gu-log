import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSitemapFilter } from '../scripts/lib/sitemap-pages.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARTIFACTS = path.join(ROOT, 'src/pages/artifacts');
const SITE = 'https://gu-log.vercel.app';
const fixturePages = readdirSync(ARTIFACTS)
  .filter((name) => name.endsWith('-fixture.astro'))
  .map((name) => name.replace(/\.astro$/, ''));

describe('sitemap pages', () => {
  const inSitemap = createSitemapFilter(new Set(['/posts/taken-down-demo']));

  it('finds the artifacts fixtures', () => {
    expect(fixturePages.length).toBeGreaterThan(0);
  });

  it.each(fixturePages)('keeps /artifacts/%s/ out of the sitemap and the index', (name) => {
    expect(inSitemap(`${SITE}/artifacts/${name}/`)).toBe(false);
    const source = readFileSync(path.join(ARTIFACTS, `${name}.astro`), 'utf8');
    expect(source).toMatch(/<BaseLayout\b[^>]*\brobots="noindex, nofollow"/);
  });

  it('drops taken-down posts and keeps reader pages', () => {
    expect(inSitemap(`${SITE}/posts/taken-down-demo/`)).toBe(false);
    expect(inSitemap(`${SITE}/posts/live-post/`)).toBe(true);
    expect(inSitemap(`${SITE}/artifacts/gp-194-html-loop/`)).toBe(true);
    expect(inSitemap(`${SITE}/artifacts/`)).toBe(true);
  });
});
