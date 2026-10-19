import { describe, expect, it } from 'vitest';
import type { FuseResult, FuseResultMatch } from 'fuse.js';
import Fuse from 'fuse.js/basic';
import { fuseOptions, type SearchEntry } from '../src/config/fuse-options';
import { classifySearchQuery, rankSearchResults } from '../src/lib/search-ranking';

const sharedEntry = {
  summary: 'Controlled ranking fixture',
  tags: [],
  lang: 'zh-tw',
  date: '2026-08-08',
  source: 'Fixture',
  sourceUrl: 'https://example.com/source',
};

function entry(
  slug: string,
  ticketId: string | null,
  overrides: Partial<SearchEntry> = {}
): SearchEntry {
  return {
    ...sharedEntry,
    slug,
    ticketId,
    title: slug,
    ...overrides,
  };
}

function fuseResult(
  item: SearchEntry,
  refIndex: number,
  matches: readonly FuseResultMatch[] = []
): FuseResult<SearchEntry> {
  return { item, refIndex, score: refIndex / 100, matches };
}

describe('search query classification', () => {
  it('only classifies trimmed complete bare numbers and complete ticket IDs as structured', () => {
    expect(classifySearchQuery(' 250 ')).toEqual({
      kind: 'ticket-number',
      numericComponent: '250',
    });
    expect(classifySearchQuery(' gp-250 ')).toEqual({
      kind: 'ticket-id',
      normalizedTicketId: 'GP-250',
    });
    expect(classifySearchQuery('Claude 250 tokens')).toEqual({ kind: 'fuzzy' });
    expect(classifySearchQuery('GP 250')).toEqual({ kind: 'fuzzy' });
  });

  it('does not normalize leading zeroes into a different ticket number', () => {
    const gp250 = entry('gp-250', 'GP-250');
    const ranked = rankSearchResults({
      query: '0250',
      searchIndex: [gp250],
      fuzzyResults: [],
      maxResults: 15,
    });

    expect(ranked.results).toEqual([]);
    expect(ranked.total).toBe(0);
  });
});

describe('structured ticket ranking', () => {
  it('places every same-number ticket in normalized ASCII order before field-only fuzzy matches', () => {
    const mp250 = entry('mp-250', 'mp-250');
    const gp250 = entry('gp-250', 'GP-250');
    const sd250 = entry('sd-250', 'SD-250');
    const zz250 = entry('zz-250', 'ZZ-250');
    const titleOnly = entry('title-only', 'GP-999', { title: '250 appears only in title' });
    const summaryOnly = entry('summary-only', null, { summary: 'Summary mentions 250' });
    const sourceOnly = entry('source-only', null, { source: 'Source 250' });
    const urlOnly = entry('url-only', null, { sourceUrl: 'https://example.com/250' });
    const searchIndex = [mp250, titleOnly, zz250, gp250, summaryOnly, sd250, sourceOnly, urlOnly];
    const fuzzyResults = [titleOnly, summaryOnly, sourceOnly, urlOnly, mp250, gp250].map(
      (item, index) => fuseResult(item, index)
    );

    const ranked = rankSearchResults({ query: '250', searchIndex, fuzzyResults, maxResults: 20 });

    expect(ranked.results.map(({ item }) => item.slug)).toEqual([
      'gp-250',
      'mp-250',
      'sd-250',
      'zz-250',
      'title-only',
      'summary-only',
      'source-only',
      'url-only',
    ]);
    expect(ranked.total).toBe(8);
  });

  it('puts a case-insensitive full ticket ID exact match before fuzzy fallback', () => {
    const exact = entry('gp-250', 'GP-250');
    const fuzzyFirst = entry('fuzzy-first', 'MP-777', { title: 'GP-250 migration notes' });
    const fuzzyMatch: readonly FuseResultMatch[] = [
      { indices: [[0, 5]], key: 'title', value: fuzzyFirst.title },
    ];
    const fuzzyResults = [fuseResult(fuzzyFirst, 0, fuzzyMatch), fuseResult(exact, 1)];

    const ranked = rankSearchResults({
      query: ' gp-250 ',
      searchIndex: [fuzzyFirst, exact],
      fuzzyResults,
      maxResults: 15,
    });

    expect(ranked.results.map(({ item }) => item.slug)).toEqual(['gp-250', 'fuzzy-first']);
    expect(ranked.results[1]).toBe(fuzzyResults[0]);
    expect(ranked.results[1]?.matches).toBe(fuzzyMatch);
  });

  it('keeps mixed-text Fuse ranking unchanged', () => {
    const entries = [
      entry('ticket-250', 'GP-250', { title: 'Unrelated ticket' }),
      entry('claude-tokens', 'MP-8', { title: 'Claude 250 tokens' }),
      entry('token-budget', 'SD-3', { summary: 'Claude tokens and context budgets' }),
    ];
    const fuse = new Fuse(entries, fuseOptions);
    const fuzzyResults = fuse.search('Claude 250 tokens');

    const ranked = rankSearchResults({
      query: 'Claude 250 tokens',
      searchIndex: entries,
      fuzzyResults,
      maxResults: 15,
    });

    expect(ranked.results).toEqual(fuzzyResults);
  });

  it('deduplicates exact and fuzzy results by stable post identity', () => {
    const exact = entry('gp-250', 'GP-250');
    const other = entry('other', 'MP-1', { title: '250 in title' });
    const ranked = rankSearchResults({
      query: '250',
      searchIndex: [exact, other],
      fuzzyResults: [
        fuseResult(exact, 0),
        fuseResult(exact, 0),
        fuseResult(other, 1),
        fuseResult(other, 1),
      ],
      maxResults: 15,
    });

    expect(ranked.results.map(({ item }) => item.slug)).toEqual(['gp-250', 'other']);
    expect(ranked.total).toBe(2);
  });

  it('computes the unique total before applying maxResults', () => {
    const gp250 = entry('gp-250', 'GP-250');
    const mp250 = entry('mp-250', 'MP-250');
    const fuzzyEntries = [entry('fuzzy-a', null), entry('fuzzy-b', null), entry('fuzzy-c', null)];
    const ranked = rankSearchResults({
      query: '250',
      searchIndex: [mp250, ...fuzzyEntries, gp250],
      fuzzyResults: fuzzyEntries.map((item, index) => fuseResult(item, index)),
      maxResults: 3,
    });

    expect(ranked.total).toBe(5);
    expect(ranked.results.map(({ item }) => item.slug)).toEqual(['gp-250', 'mp-250', 'fuzzy-a']);
  });
});
