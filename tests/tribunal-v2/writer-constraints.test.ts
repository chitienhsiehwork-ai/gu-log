import { describe, it, expect } from 'vitest';
import {
  extractUrls,
  checkUrlsUnchanged,
  extractHeadings,
  checkHeadingsPreserved,
  parseFrontmatter,
  checkFrontmatterPreserved,
} from '../../src/lib/tribunal-v2/writer-constraints';

// ============================================================================
// URL immutability
// ============================================================================

describe('extractUrls', () => {
  it('extracts markdown link URLs', () => {
    const content = 'Check [docs](https://example.com/docs) and [API](https://api.example.com)';
    const urls = extractUrls(content);
    expect(urls).toContain('https://example.com/docs');
    expect(urls).toContain('https://api.example.com');
  });

  it('extracts raw http URLs', () => {
    const content = 'Visit https://example.com or http://old.example.com for more';
    const urls = extractUrls(content);
    expect(urls).toContain('https://example.com');
    expect(urls).toContain('http://old.example.com');
  });

  it('deduplicates URLs', () => {
    const content = '[a](https://x.com) and [b](https://x.com)';
    const urls = extractUrls(content);
    expect(urls.filter((u) => u === 'https://x.com')).toHaveLength(1);
  });

  it('returns empty array for content with no URLs', () => {
    expect(extractUrls('Just plain text, no links here')).toEqual([]);
  });
});

describe('checkUrlsUnchanged', () => {
  it('returns pass when URLs are identical', () => {
    const content = 'Check [docs](https://a.com) and https://b.com';
    const result = checkUrlsUnchanged(content, content);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('detects removed URL', () => {
    const before = 'Read [docs](https://a.com) for details';
    const after = 'Read the docs for details';
    const result = checkUrlsUnchanged(before, after);
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      { type: 'removed', url: 'https://a.com' },
    ]);
  });

  it('detects added URL', () => {
    const before = 'Some text';
    const after = 'Some text with https://new.com';
    const result = checkUrlsUnchanged(before, after);
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      { type: 'added', url: 'https://new.com' },
    ]);
  });

  it('detects mutated URL (same domain, different path)', () => {
    const before = 'Visit [post](https://gu-log.vercel.app/posts/sp-1)';
    const after = 'Visit [post](https://gu-log.vercel.app/posts/sp-one)';
    const result = checkUrlsUnchanged(before, after);
    expect(result.pass).toBe(false);
    // Old URL removed, new URL added
    expect(result.violations).toContainEqual({
      type: 'removed',
      url: 'https://gu-log.vercel.app/posts/sp-1',
    });
    expect(result.violations).toContainEqual({
      type: 'added',
      url: 'https://gu-log.vercel.app/posts/sp-one',
    });
  });

  it('passes when content changes but URLs stay the same', () => {
    const before = 'Read [docs](https://a.com) for info';
    const after = 'Check out [documentation](https://a.com) here';
    const result = checkUrlsUnchanged(before, after);
    expect(result.pass).toBe(true);
  });

  it('handles empty content', () => {
    expect(checkUrlsUnchanged('', '').pass).toBe(true);
    expect(checkUrlsUnchanged('', 'https://new.com').pass).toBe(false);
    expect(checkUrlsUnchanged('https://old.com', '').pass).toBe(false);
  });
});

// ============================================================================
// Heading order preservation
// ============================================================================

describe('extractHeadings', () => {
  it('extracts heading level and text', () => {
    const content = '## First\nSome text\n### Sub\n## Second';
    const headings = extractHeadings(content);
    expect(headings).toEqual([
      { level: 2, text: 'First' },
      { level: 3, text: 'Sub' },
      { level: 2, text: 'Second' },
    ]);
  });

  it('returns empty for content without headings', () => {
    expect(extractHeadings('Just text, no headings')).toEqual([]);
  });

  it('handles h1 through h6', () => {
    const content = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(6);
    expect(headings[0]).toEqual({ level: 1, text: 'H1' });
    expect(headings[5]).toEqual({ level: 6, text: 'H6' });
  });
});

describe('checkHeadingsPreserved', () => {
  it('passes when heading list is identical', () => {
    const content = '## A\ntext\n## B\ntext\n## C';
    const result = checkHeadingsPreserved(content, content);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails when a heading is renamed', () => {
    const before = '## First Section\ntext\n## Second Section';
    const after = '## Opening\ntext\n## Second Section';
    const result = checkHeadingsPreserved(before, after);
    expect(result.pass).toBe(false);
    // Violation labels now include the heading level so demotions like
    // `## Foo` → `### Foo` can't hide behind text-only equality.
    expect(result.violations).toContainEqual({ type: 'removed', heading: '## First Section' });
    expect(result.violations).toContainEqual({ type: 'added', heading: '## Opening' });
  });

  it('fails when a heading level changes (## → ###) even if text is identical', () => {
    const before = '# Title\n## Section\ntext';
    const after = '# Title\n### Section\ntext';
    const result = checkHeadingsPreserved(before, after);
    expect(result.pass).toBe(false);
    // Same text, different level → reported as removed + added
    expect(result.violations).toContainEqual({ type: 'removed', heading: '## Section' });
    expect(result.violations).toContainEqual({ type: 'added', heading: '### Section' });
  });

  it('fails when headings are reordered', () => {
    const before = '## A\n## B\n## C';
    const after = '## A\n## C\n## B';
    const result = checkHeadingsPreserved(before, after);
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.type === 'reordered')).toBe(true);
  });

  it('fails when a new heading is inserted', () => {
    const before = '## A\n## B';
    const after = '## A\n## Summary\n## B';
    const result = checkHeadingsPreserved(before, after);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual({ type: 'added', heading: '## Summary' });
  });

  it('fails when a heading is removed', () => {
    const before = '## A\n## B\n## C';
    const after = '## A\n## C';
    const result = checkHeadingsPreserved(before, after);
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual({ type: 'removed', heading: '## B' });
  });

  it('handles empty content', () => {
    expect(checkHeadingsPreserved('', '').pass).toBe(true);
  });

  it('handles content with no headings', () => {
    const before = 'Just text';
    const after = 'Different text';
    expect(checkHeadingsPreserved(before, after).pass).toBe(true);
  });
});

// ============================================================================
// Frontmatter protection
// ============================================================================

describe('parseFrontmatter', () => {
  it('parses simple frontmatter', () => {
    const content = '---\ntitle: Hello\nlang: zh-tw\n---\nBody';
    const fm = parseFrontmatter(content);
    expect(fm.title).toBe('Hello');
    expect(fm.lang).toBe('zh-tw');
  });

  it('returns empty object for content without frontmatter', () => {
    expect(parseFrontmatter('Just body')).toEqual({});
  });
});

describe('checkFrontmatterPreserved', () => {
  const protectedFields = ['title', 'ticketId', 'sourceUrl', 'lang'];

  it('passes when protected fields are unchanged', () => {
    const before = '---\ntitle: Hello\nticketId: SP-100\nlang: zh-tw\n---\nBody A';
    const after = '---\ntitle: Hello\nticketId: SP-100\nlang: zh-tw\n---\nBody B';
    const result = checkFrontmatterPreserved(before, after, protectedFields);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails when title is modified', () => {
    const before = '---\ntitle: Original\nticketId: SP-100\n---\nBody';
    const after = '---\ntitle: Original (revised)\nticketId: SP-100\n---\nBody';
    const result = checkFrontmatterPreserved(before, after, protectedFields);
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      { field: 'title', before: 'Original', after: 'Original (revised)' },
    ]);
  });

  it('fails when ticketId is changed', () => {
    const before = '---\ntitle: A\nticketId: SP-100\n---\nBody';
    const after = '---\ntitle: A\nticketId: SP-101\n---\nBody';
    const result = checkFrontmatterPreserved(before, after, protectedFields);
    expect(result.pass).toBe(false);
    expect(result.violations[0].field).toBe('ticketId');
  });

  it('detects multiple violations', () => {
    const before = '---\ntitle: A\nticketId: SP-100\nsourceUrl: https://x.com/a\nlang: zh-tw\n---\n';
    const after = '---\ntitle: B\nticketId: SP-999\nsourceUrl: https://x.com/b\nlang: en\n---\n';
    const result = checkFrontmatterPreserved(before, after, protectedFields);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(4);
  });

  it('detects removal of a protected field', () => {
    const before = '---\ntitle: A\nsourceUrl: https://x.com\n---\n';
    const after = '---\ntitle: A\n---\n';
    const result = checkFrontmatterPreserved(before, after, ['sourceUrl']);
    expect(result.pass).toBe(false);
    expect(result.violations).toEqual([
      { field: 'sourceUrl', before: 'https://x.com', after: '' },
    ]);
  });

  it('allows unprotected fields to change', () => {
    const before = '---\ntitle: A\ndescription: old\n---\n';
    const after = '---\ntitle: A\ndescription: new\n---\n';
    // Only protect title, not description
    const result = checkFrontmatterPreserved(before, after, ['title']);
    expect(result.pass).toBe(true);
  });
});
