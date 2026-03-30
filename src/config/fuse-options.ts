// Fuse.js search configuration — shared between SearchBar.astro and tests
// SSOT: change search behavior here, both production and tests use this.

import type { IFuseOptions } from 'fuse.js';

export type SearchEntry = {
  slug: string;
  ticketId: string | null;
  title: string;
  summary: string;
  tags: string[];
  lang: string;
  date: string;
  source: string;
};

export const fuseOptions: IFuseOptions<SearchEntry> = {
  includeMatches: true,
  threshold: 0.4,
  minMatchCharLength: 2,
  ignoreLocation: true, // Don't penalize matches that appear late in the string
  keys: [
    { name: 'ticketId', weight: 3 },
    { name: 'title', weight: 2 },
    { name: 'tags', weight: 1.5 },
    { name: 'summary', weight: 1 },
    { name: 'source', weight: 1 },
  ],
};
