/**
 * Tribunal v2 — Writer Constraint Checkers
 *
 * Deterministic structural constraint checks for writer output.
 * These catch things LLMs can't reliably self-enforce:
 * URL immutability, heading order preservation, frontmatter protection.
 */

// ---------------------------------------------------------------------------
// URL extraction + diff
// ---------------------------------------------------------------------------

const URL_REGEX = /https?:\/\/[^\s\)>"'`\]]+/g;

/** Extract all unique URLs from content */
export function extractUrls(content: string): string[] {
  const matches = content.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

/** Check that URLs are unchanged between versions */
export function checkUrlsUnchanged(
  before: string,
  after: string,
): {
  pass: boolean;
  violations: Array<{ type: 'added' | 'removed' | 'changed'; url: string }>;
} {
  const beforeUrls = new Set(extractUrls(before));
  const afterUrls = new Set(extractUrls(after));

  const violations: Array<{ type: 'added' | 'removed' | 'changed'; url: string }> = [];

  for (const url of beforeUrls) {
    if (!afterUrls.has(url)) {
      violations.push({ type: 'removed', url });
    }
  }

  for (const url of afterUrls) {
    if (!beforeUrls.has(url)) {
      violations.push({ type: 'added', url });
    }
  }

  return { pass: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Heading extraction + diff
// ---------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
}

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/gm;

/** Extract markdown headings with level + text */
export function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let match;
  while ((match = HEADING_REGEX.exec(content)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim() });
  }
  // Reset lastIndex for reuse
  HEADING_REGEX.lastIndex = 0;
  return headings;
}

/** Check that markdown headings order is preserved */
export function checkHeadingsPreserved(
  before: string,
  after: string,
): {
  pass: boolean;
  violations: Array<{ type: 'added' | 'removed' | 'reordered'; heading: string }>;
} {
  const beforeHeadings = extractHeadings(before);
  const afterHeadings = extractHeadings(after);

  const violations: Array<{ type: 'added' | 'removed' | 'reordered'; heading: string }> = [];

  const beforeTexts = beforeHeadings.map((h) => h.text);
  const afterTexts = afterHeadings.map((h) => h.text);

  // Check for removed headings
  for (const h of beforeTexts) {
    if (!afterTexts.includes(h)) {
      violations.push({ type: 'removed', heading: h });
    }
  }

  // Check for added headings
  for (const h of afterTexts) {
    if (!beforeTexts.includes(h)) {
      violations.push({ type: 'added', heading: h });
    }
  }

  // Check for reordered headings (only among shared headings)
  const sharedBefore = beforeTexts.filter((h) => afterTexts.includes(h));
  const sharedAfter = afterTexts.filter((h) => beforeTexts.includes(h));

  if (sharedBefore.length === sharedAfter.length && violations.length === 0) {
    for (let i = 0; i < sharedBefore.length; i++) {
      if (sharedBefore[i] !== sharedAfter[i]) {
        violations.push({ type: 'reordered', heading: sharedAfter[i] });
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Frontmatter extraction + diff
// ---------------------------------------------------------------------------

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/** Parse frontmatter into key-value pairs (simple YAML-like parsing) */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return {};

  const lines = match[1].split('\n');
  const result: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }

  return result;
}

/** Check frontmatter is unchanged for protected fields */
export function checkFrontmatterPreserved(
  before: string,
  after: string,
  protectedFields: string[],
): {
  pass: boolean;
  violations: Array<{ field: string; before: string; after: string }>;
} {
  const beforeFm = parseFrontmatter(before);
  const afterFm = parseFrontmatter(after);

  const violations: Array<{ field: string; before: string; after: string }> = [];

  for (const field of protectedFields) {
    const bVal = beforeFm[field] ?? '';
    const aVal = afterFm[field] ?? '';
    if (bVal !== aVal) {
      violations.push({ field, before: bVal, after: aVal });
    }
  }

  return { pass: violations.length === 0, violations };
}
