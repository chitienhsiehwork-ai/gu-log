/**
 * Link extraction for scripts/check-links.mjs: pulls the frontmatter
 * sourceUrl, markdown links and HTML hrefs out of one MDX post.
 */

// Skip these URL patterns entirely (not real links)
const SKIP_PATTERNS = [
  /^mailto:/,
  /^tel:/,
  /^javascript:/,
  /^#/,
  /^data:/,
  /^\{\{/, // template expressions
  /^\$\{/, // template literals
];

export function isReservedExampleUrl(value) {
  try {
    const hostname = new URL(value, 'https://gu-log.invalid').hostname.toLowerCase();
    return hostname === 'example.com' || hostname.endsWith('.example.com');
  } catch {
    return false;
  }
}

// Drop trailing ">" and any trailing ")" that has no matching "(" in the URL.
// One pass from the end, so a long run of ")" stays linear.
function trimUnmatchedTail(url) {
  let unmatched = url.split(')').length - url.split('(').length;
  let end = url.length;
  while (end > 0 && (url[end - 1] === '>' || (url[end - 1] === ')' && unmatched-- > 0))) end--;
  return url.slice(0, end);
}

export function extractLinks(content, filePath) {
  const links = [];
  const seen = new Set();

  function add(url, type, context) {
    url = trimUnmatchedTail(url.trim());
    if (!url || SKIP_PATTERNS.some((p) => p.test(url)) || isReservedExampleUrl(url)) return;
    const key = `${url}|${filePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ url, type, context, file: filePath });
  }

  // Strip fenced code blocks and inline code to avoid false positives
  const stripped = content
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`[^`\n]+`/g, ''); // inline code

  // 1. Frontmatter sourceUrl (use original content for frontmatter)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const sourceUrlMatch = fmMatch[1].match(/sourceUrl:\s*['"]([^'"]+)['"]/);
    if (sourceUrlMatch) {
      add(sourceUrlMatch[1], 'sourceUrl', 'frontmatter');
    }
  }

  // 2. Markdown links: [text](url). The URL has no whitespace and may hold one
  // level of balanced parentheses (CommonMark allows `Foo_(bar)`), so the first
  // ")" that closes nothing ends it. Deeper nesting is not matched at all.
  const mdLinkRe = /\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
  let m;
  while ((m = mdLinkRe.exec(stripped)) !== null) {
    add(m[2], 'markdown', m[1] || 'link');
  }

  // 3. HTML href="url"
  const hrefRe = /href=["']([^"']+)["']/g;
  while ((m = hrefRe.exec(stripped)) !== null) {
    add(m[1], 'html', 'href');
  }

  return links;
}
