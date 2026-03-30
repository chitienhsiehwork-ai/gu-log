/**
 * Search Relevance TDD Suite
 *
 * Every time a search query doesn't return expected results on gu-log,
 * add a test case here FIRST (red), then fix the algorithm (green).
 *
 * Run: pnpm test:search-relevance
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Fuse from 'fuse.js';
import { fuseOptions, type SearchEntry } from '../src/config/fuse-options';
import { getSearchIndex } from './helpers/search-index-loader';

let fuseZh: Fuse<SearchEntry>;
let fuseEn: Fuse<SearchEntry>;

beforeAll(async () => {
  const { zhIndex, enIndex } = await getSearchIndex();
  fuseZh = new Fuse(zhIndex, fuseOptions);
  fuseEn = new Fuse(enIndex, fuseOptions);
});

/** Helper: search and return ticketIds of top N results */
function searchTickets(fuse: Fuse<SearchEntry>, query: string, limit = 10): (string | null)[] {
  return fuse.search(query, { limit }).map((r) => r.item.ticketId);
}

// ============================================================
// Test cases — add new ones here as regressions are found
// ============================================================

describe('Search Relevance — zh-tw', () => {
  it('should find SP-90 (Simon Willison Interactive Explanations) when searching "interactive"', () => {
    const tickets = searchTickets(fuseZh, 'interactive');
    expect(tickets).toContain('SP-90');
  });

  it('should find SP-90 when searching "interactive explanation"', () => {
    const tickets = searchTickets(fuseZh, 'interactive explanation');
    expect(tickets).toContain('SP-90');
  });

  it('should find Simon Willison posts when searching "simon willison"', () => {
    const results = fuseZh.search('simon willison', { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    // At least one result should mention Simon Willison in title, source, or tags
    const hasSimon = results.some(
      (r) =>
        r.item.title.toLowerCase().includes('simon') ||
        r.item.source.toLowerCase().includes('simon') ||
        r.item.tags.some((t) => t.toLowerCase().includes('simon'))
    );
    expect(hasSimon).toBe(true);
  });
});

describe('Search Relevance — en', () => {
  it('should find interactive explanation posts when searching "interactive"', () => {
    const results = fuseEn.search('interactive', { limit: 10 });
    // Should return at least 1 result
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('Search Relevance — highlight quality', () => {
  it('should not produce single-character match indices for "interactive"', () => {
    const results = fuseZh.search('interactive', { limit: 5 });
    const sp90 = results.find((r) => r.item.ticketId === 'SP-90');
    expect(sp90).toBeDefined();

    // Check that match indices are meaningful (>= 3 chars each)
    for (const match of sp90!.matches || []) {
      const longIndices = match.indices.filter(([s, e]) => e - s >= 2);
      // At least one meaningful match should exist
      if (match.key === 'title' || match.key === 'summary') {
        expect(longIndices.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Search Relevance — ticket ID', () => {
  it('should find exact ticket by ID prefix', () => {
    const tickets = searchTickets(fuseZh, 'SP-90');
    expect(tickets[0]).toBe('SP-90');
  });
});
