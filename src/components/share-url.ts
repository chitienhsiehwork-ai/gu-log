function hasUnsafeRawCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (character === '\\' || codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function parseShareUrl(value: string | null): URL | null {
  if (!value || value !== value.trim() || hasUnsafeRawCharacter(value)) return null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

    url.search = '';
    url.hash = '';
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Prefer the page's public canonical URL so protected preview details and
 * transient query/fragment data never leave the browser through share targets.
 */
export function getShareUrl(canonicalHref: string | null, currentHref: string): string {
  const canonical = parseShareUrl(canonicalHref);
  if (canonical) return canonical.href;

  const current = parseShareUrl(currentHref);
  if (current) return current.href;

  throw new TypeError('Share URL requires an absolute HTTP(S) page URL');
}
