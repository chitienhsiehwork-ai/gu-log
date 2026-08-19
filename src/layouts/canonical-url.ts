export function buildCanonicalUrl(site: string | URL | undefined, pathname: string): string {
  if (!site) {
    throw new TypeError('Canonical URL requires Astro.site');
  }

  const canonical = new URL('/', site);
  canonical.pathname = pathname;
  canonical.search = '';
  canonical.hash = '';
  return canonical.href;
}
