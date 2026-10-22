/**
 * Internal-link checks for scripts/check-links.mjs. A link is internal when it
 * starts with `/` or uses the production origin, and broken when the built
 * dist/ has no matching file.
 *
 * check-links extracts MDX body links itself. Page chrome (nav, language
 * toggle, tag chips) never appears in MDX, so collectDistAnchorLinks reads
 * those links from the built HTML.
 */
import { statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const INTERNAL_ORIGINS = new Set(['https://gu-log.vercel.app', 'https://www.gu-log.vercel.app']);

export function isInternalLink(url) {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  // Exact origin matching prevents URLs that put the
  // gu-log.vercel.app domain inside a query parameter (e.g.
  // `https://api.qrserver.com/v1/create-qr-code/?data=https://gu-log.vercel.app`),
  // or use a different scheme/port from borrowing a file in dist.
  try {
    return INTERNAL_ORIGINS.has(new URL(url).origin);
  } catch {
    // not a valid absolute URL — fall through
  }
  return false;
}

export function checkInternalLink(url, distDir) {
  if (!isInternalLink(url)) return false;

  let path;
  try {
    // WHATWG URL parsing matches the browser: it removes query/fragment data
    // and normalizes literal or percent-encoded dot segments before the
    // pathname ever reaches the filesystem.
    const parsed = new URL(url, 'https://gu-log.vercel.app');
    if (!INTERNAL_ORIGINS.has(parsed.origin)) return false;
    // dist/ keeps raw characters in directory names (tags/Claude Code,
    // tags/斷詞) while pathname is percent-encoded.
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }

  path = path.replace(/\/$/, '') || '/';
  const distRoot = resolve(distDir);
  const resolvedPath = resolve(distRoot, `.${path}`);
  const candidates = [resolvedPath, join(resolvedPath, 'index.html'), resolvedPath + '.html'];
  const distPrefix = `${distRoot}${sep}`;

  // Only files count: a bare directory (dist/en/posts/) is a 404 on Vercel.
  return candidates.some(
    (candidate) =>
      candidate.startsWith(distPrefix) &&
      Boolean(statSync(candidate, { throwIfNoEntry: false })?.isFile())
  );
}

const ANCHOR_HREF = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
// Test fixture pages (src/pages/artifacts/*-fixture.astro) link to fake posts
// on purpose. Everything else readers can reach, the 404 page included, is scanned.
const FIXTURE_PAGE = /^artifacts\/[^/]+-fixture\//;

// Character references an attribute value can carry: Astro writes `&amp;`,
// MDX output (hast) writes `&#x26;`. Left encoded, the `#` reads as a fragment.
const CHAR_REF = /&(?:#x([\da-f]+)|#(\d+)|(amp|quot|apos|lt|gt));/gi;
const NAMED_REFS = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeAttribute(value) {
  return value.replace(CHAR_REF, (ref, hex, dec, name) => {
    if (name) return NAMED_REFS[name.toLowerCase()];
    const codePoint = hex ? parseInt(hex, 16) : Number(dec);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ref;
  });
}

// Scanned, not stripped with replace(): the output is only a list of URLs, and
// skipping each <script>…</script> span in one pass leaves nothing to re-join.
const SCRIPT_OPEN = /<script\b/gi;
const SCRIPT_CLOSE = /<\/script\b[^>]*>/gi;

function outsideScripts(html) {
  let markup = '';
  let pos = 0;
  for (;;) {
    SCRIPT_OPEN.lastIndex = pos;
    const open = SCRIPT_OPEN.exec(html);
    if (!open) return markup + html.slice(pos);
    markup += html.slice(pos, open.index);
    SCRIPT_CLOSE.lastIndex = open.index;
    const close = SCRIPT_CLOSE.exec(html);
    if (!close) return markup;
    pos = close.index + close[0].length;
  }
}

/** Internal `<a href>` targets in one HTML page, ignoring markup built as strings in <script>. */
export function extractInternalAnchorHrefs(html) {
  const markup = outsideScripts(html);
  return [...markup.matchAll(ANCHOR_HREF)]
    .map((match) => decodeAttribute((match[1] ?? match[2] ?? match[3]).trim()))
    .filter(isInternalLink);
}

/**
 * Internal `<a href>` targets across dist/ HTML, one entry per URL: `file` is
 * the first page it appears on and `context` counts the pages.
 */
export async function collectDistAnchorLinks(distDir) {
  const pages = (await readdir(distDir, { recursive: true }))
    .map((file) => file.split(sep).join('/'))
    .filter((file) => file.endsWith('.html') && !FIXTURE_PAGE.test(file))
    .sort();
  const byUrl = new Map();
  for (const page of pages) {
    const html = await readFile(join(distDir, page), 'utf-8');
    for (const url of new Set(extractInternalAnchorHrefs(html))) {
      const seen = byUrl.get(url);
      if (seen) seen.pages += 1;
      else byUrl.set(url, { url, file: `dist/${page}`, pages: 1 });
    }
  }
  return {
    pageCount: pages.length,
    links: [...byUrl.values()].map(({ url, file, pages: count }) => ({
      url,
      type: 'html',
      context: `<a href> on ${count} page(s)`,
      file,
    })),
  };
}
