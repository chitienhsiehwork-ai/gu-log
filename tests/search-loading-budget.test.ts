import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  new URL('../src/components/SearchBar.astro', import.meta.url),
  'utf8'
);

describe('Search loading budget', () => {
  it('loads Fuse with the locale index only after the first search', () => {
    expect(componentSource).not.toMatch(
      /(?:^|\n)\s*import\s+(?!type\b)[^;\n]+from\s+['"]fuse\.js['"]/
    );

    const loaderStart = componentSource.indexOf('async function loadSearchIndex');
    const loaderEnd = componentSource.indexOf('function ensureSearchIndex', loaderStart);
    expect(loaderStart).toBeGreaterThan(-1);
    expect(loaderEnd).toBeGreaterThan(loaderStart);

    const loaderSource = componentSource.slice(loaderStart, loaderEnd);
    expect(loaderSource).toContain('Promise.all([');
    expect(loaderSource).toContain("import('fuse.js')");
    expect(loaderSource).toContain('fetch(`/search-index.${currentLang}.json`)');
  });
});
