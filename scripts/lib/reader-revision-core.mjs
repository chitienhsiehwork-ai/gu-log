import { parseFrontmatter } from 'astro/markdown';
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
  const astroParts = parseFrontmatter(content);
  if (astroParts.rawFrontmatter === '') {
    return {
      frontmatter: {},
      frontmatterRaw: '',
      frontmatterFormat: 'yaml',
      frontmatterStartLine: 1,
      body: content,
      bodyStartLine: 1,
    };
  }

  const boundaries = ['---', '+++']
    .map((delimiter) => ({
      delimiter,
      marker: `${delimiter}${astroParts.rawFrontmatter}${delimiter}`,
    }))
    .map((candidate) => ({ ...candidate, index: content.indexOf(candidate.marker) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index);
  const boundary = boundaries[0];
  if (!boundary) {
    throw new Error('Astro 已解析 frontmatter，但無法定位原始 delimiter boundary');
  }

  const openingBreak = astroParts.rawFrontmatter.match(/^\r?\n/u)?.[0] ?? '';
  const closingBreak = astroParts.rawFrontmatter.match(/\r?\n$/u)?.[0] ?? '';
  const frontmatterRaw = astroParts.rawFrontmatter.slice(
    openingBreak.length,
    astroParts.rawFrontmatter.length - closingBreak.length
  );
  const frontmatterStartOffset = boundary.index + boundary.delimiter.length + openingBreak.length;
  const boundaryEndOffset = boundary.index + boundary.marker.length;
  const trailingBreak = content.slice(boundaryEndOffset).match(/^\r?\n/u)?.[0] ?? '';
  const bodyStartOffset = boundaryEndOffset + trailingBreak.length;

  return {
    // Keep the existing YAML parser for legacy Reader Tracker hash stability;
    // Astro owns boundary detection and TOML parsing.
    frontmatter:
      boundary.delimiter === '---' ? (parse(frontmatterRaw) ?? {}) : astroParts.frontmatter,
    frontmatterRaw,
    frontmatterFormat: boundary.delimiter === '---' ? 'yaml' : 'toml',
    frontmatterStartLine: (content.slice(0, frontmatterStartOffset).match(/\n/gu)?.length ?? 0) + 1,
    body: content.slice(bodyStartOffset),
    bodyStartLine: (content.slice(0, bodyStartOffset).match(/\n/gu)?.length ?? 0) + 1,
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
