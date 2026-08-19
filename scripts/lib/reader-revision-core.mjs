import { parse } from 'yaml';

// This legacy hash projection is intentionally frozen. Expanding the emoji
// policy surface must not invalidate every existing Reader Tracker record.
export const READER_REVISION_FRONTMATTER_KEYS = Object.freeze([
  'ticketId',
  'title',
  'originalDate',
  'translatedDate',
  'source',
  'sourceUrl',
  'author',
  'summary',
  'lang',
  'tags',
  'status',
  'deprecatedBy',
  'deprecatedReason',
  'retiredReason',
  'retiredAt',
  'series',
]);

export function extractPostParts(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      frontmatter: {},
      frontmatterRaw: '',
      body: content,
      bodyStartLine: 1,
    };
  }
  return {
    frontmatter: parse(match[1]) ?? {},
    frontmatterRaw: match[1],
    body: content.slice(match[0].length),
    bodyStartLine: match[0].split('\n').length,
  };
}

export function stableReaderValue(value) {
  if (Array.isArray(value)) return value.map(stableReaderValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableReaderValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function readerRevisionCanonicalJSON(frontmatter, body) {
  const readerVisibleFrontmatter = {};
  for (const key of READER_REVISION_FRONTMATTER_KEYS) {
    if (frontmatter[key] !== undefined) {
      readerVisibleFrontmatter[key] = stableReaderValue(frontmatter[key]);
    }
  }
  return JSON.stringify({ frontmatter: readerVisibleFrontmatter, body }, null, 2);
}
