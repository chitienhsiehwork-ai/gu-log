import type { FuseResult } from 'fuse.js';
import type { SearchEntry } from '../config/fuse-options';

export type SearchQueryClassification =
  | { kind: 'ticket-number'; numericComponent: string }
  | { kind: 'ticket-id'; normalizedTicketId: string }
  | { kind: 'fuzzy' };

export type SearchRankingInput = {
  query: string;
  searchIndex: readonly SearchEntry[];
  fuzzyResults: readonly FuseResult<SearchEntry>[];
  maxResults: number;
};

export type SearchRankingOutput = {
  results: FuseResult<SearchEntry>[];
  total: number;
};

type ParsedTicketId = {
  normalizedTicketId: string;
  numericComponent: string;
};

const BARE_TICKET_NUMBER = /^\d+$/;
const COMPLETE_TICKET_ID = /^([a-z]+)-(\d+)$/i;

function parseTicketId(ticketId: string | null): ParsedTicketId | null {
  if (!ticketId) return null;
  const match = COMPLETE_TICKET_ID.exec(ticketId.trim());
  if (!match) return null;

  return {
    normalizedTicketId: `${match[1].toUpperCase()}-${match[2]}`,
    numericComponent: match[2],
  };
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function classifySearchQuery(query: string): SearchQueryClassification {
  const trimmed = query.trim();
  if (BARE_TICKET_NUMBER.test(trimmed)) {
    return { kind: 'ticket-number', numericComponent: trimmed };
  }

  const ticketId = COMPLETE_TICKET_ID.exec(trimmed);
  if (ticketId) {
    return {
      kind: 'ticket-id',
      normalizedTicketId: `${ticketId[1].toUpperCase()}-${ticketId[2]}`,
    };
  }

  return { kind: 'fuzzy' };
}

function exactTicketTier(
  classification: SearchQueryClassification,
  searchIndex: readonly SearchEntry[]
): FuseResult<SearchEntry>[] {
  if (classification.kind === 'fuzzy') return [];

  return searchIndex
    .map((item, refIndex) => ({ item, refIndex, parsed: parseTicketId(item.ticketId) }))
    .filter(({ parsed }) => {
      if (!parsed) return false;
      if (classification.kind === 'ticket-number') {
        return parsed.numericComponent === classification.numericComponent;
      }
      return parsed.normalizedTicketId === classification.normalizedTicketId;
    })
    .sort((left, right) => {
      const ticketOrder = compareAscii(
        left.parsed!.normalizedTicketId,
        right.parsed!.normalizedTicketId
      );
      return ticketOrder || compareAscii(left.item.slug, right.item.slug);
    })
    .map(({ item, refIndex }) => ({ item, refIndex, score: 0, matches: [] }));
}

export function rankSearchResults({
  query,
  searchIndex,
  fuzzyResults,
  maxResults,
}: SearchRankingInput): SearchRankingOutput {
  const classification = classifySearchQuery(query);
  const exactResults = exactTicketTier(classification, searchIndex);
  const uniqueResults: FuseResult<SearchEntry>[] = [];
  const seenPostIds = new Set<string>();

  for (const result of [...exactResults, ...fuzzyResults]) {
    const postId = result.item.slug;
    if (seenPostIds.has(postId)) continue;
    seenPostIds.add(postId);
    uniqueResults.push(result);
  }

  const total = uniqueResults.length;
  const limit = Number.isFinite(maxResults) ? Math.max(0, Math.floor(maxResults)) : total;

  return {
    results: uniqueResults.slice(0, limit),
    total,
  };
}
