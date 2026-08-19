import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildCanonicalUrl } from '../src/layouts/canonical-url';

describe('buildCanonicalUrl', () => {
  it('keeps BaseLayout canonical metadata on the confined builder', () => {
    const layout = readFileSync('src/layouts/BaseLayout.astro', 'utf8');

    expect(layout).toContain('buildCanonicalUrl(Astro.site, currentPath)');
    expect(layout).not.toContain('new URL(currentPath, Astro.site)');
  });

  it.each([
    ['/posts/gp-24-example', 'https://gu-log.vercel.app/posts/gp-24-example'],
    ['/en/posts/gp-24-example/', 'https://gu-log.vercel.app/en/posts/gp-24-example/'],
    ['', 'https://gu-log.vercel.app/'],
  ])('keeps ordinary pathname %s on the configured site', (pathname, expected) => {
    expect(buildCanonicalUrl('https://gu-log.vercel.app', pathname)).toBe(expected);
  });

  it.each([
    ['//evil.example/posts/gp-24', 'https://gu-log.vercel.app//evil.example/posts/gp-24'],
    ['/\\evil.example/posts/gp-24', 'https://gu-log.vercel.app//evil.example/posts/gp-24'],
    ['evil.example/posts/gp-24', 'https://gu-log.vercel.app/evil.example/posts/gp-24'],
  ])('confines adversarial pathname %s to the configured origin', (pathname, expected) => {
    const canonical = new URL(buildCanonicalUrl('https://gu-log.vercel.app', pathname));

    expect(canonical.origin).toBe('https://gu-log.vercel.app');
    expect(canonical.href).toBe(expected);
  });

  it('treats query and fragment delimiters in the pathname as path data', () => {
    expect(
      buildCanonicalUrl('https://gu-log.vercel.app/?old=1#old', '/posts/a?token=x#secret')
    ).toBe('https://gu-log.vercel.app/posts/a%3Ftoken=x%23secret');
  });

  it('fails closed when Astro.site is unavailable', () => {
    expect(() => buildCanonicalUrl(undefined, '/posts/gp-24')).toThrow(
      'Canonical URL requires Astro.site'
    );
  });
});
