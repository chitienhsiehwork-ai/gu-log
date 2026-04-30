/**
 * Unit tests for scripts/dedup-gate.mjs
 *
 * Covers Layer 1 (URL match), Layer 2 (topic similarity), Layer 3 (queue pairwise),
 * plus the URL/keyword helpers that drive the thresholds.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module without types
import * as dedup from '../scripts/dedup-gate.mjs';

const {
  normalizeUrl,
  extractTweetId,
  applyCompounds,
  extractEnKeywords,
  extractCnBigrams,
  meaningfulOverlap,
  jaccard,
  computeSimilarity,
  layer1Match,
  layer2Match,
  layer3QueueCheck,
  parseArgs,
  REJECT_THRESHOLD,
  FLAG_THRESHOLD,
  MIN_EN_OVERLAP,
} = dedup;

describe('normalizeUrl', () => {
  it('strips www prefix', () => {
    expect(normalizeUrl('https://www.anthropic.com/foo')).toBe('https://anthropic.com/foo');
  });

  it('strips m. mobile prefix', () => {
    expect(normalizeUrl('https://m.example.com/path')).toBe('https://example.com/path');
  });

  it('strips trailing slashes', () => {
    expect(normalizeUrl('https://anthropic.com/blog/')).toBe('https://anthropic.com/blog');
  });

  it('strips utm_* params', () => {
    expect(
      normalizeUrl('https://example.com/x?utm_source=a&utm_medium=b&id=42')
    ).toBe('https://example.com/x?id=42');
  });

  it('strips bare ref / source params', () => {
    expect(normalizeUrl('https://example.com/x?ref=hn&id=1')).toBe(
      'https://example.com/x?id=1'
    );
  });

  it('applies known alias claude.com/blog/auto-mode → anthropic.com/engineering/...', () => {
    expect(normalizeUrl('https://claude.com/blog/auto-mode')).toBe(
      'https://anthropic.com/engineering/claude-code-auto-mode'
    );
  });

  it('returns lowercased fallback for malformed URLs', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl(null)).toBe('');
  });

  it('strips surrounding quotes', () => {
    expect(normalizeUrl('"https://example.com/x"')).toBe('https://example.com/x');
  });
});

describe('extractTweetId', () => {
  it('extracts from x.com URL', () => {
    expect(extractTweetId('https://x.com/simonw/status/1234567890')).toBe('1234567890');
  });

  it('extracts from twitter.com URL', () => {
    expect(extractTweetId('https://twitter.com/karpathy/status/9876543210')).toBe(
      '9876543210'
    );
  });

  it('handles mobile/www subdomains', () => {
    expect(extractTweetId('https://www.x.com/user/status/111')).toBe('111');
  });

  it('returns null for non-tweet URLs', () => {
    expect(extractTweetId('https://anthropic.com/blog')).toBeNull();
    expect(extractTweetId('https://x.com/simonw')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractTweetId('')).toBeNull();
    expect(extractTweetId(null)).toBeNull();
  });
});

describe('applyCompounds', () => {
  it('rewrites "claude code" → "claude-code"', () => {
    expect(applyCompounds('Claude Code is great')).toBe('claude-code is great');
  });

  it('preserves already-hyphenated form', () => {
    expect(applyCompounds('claude-code')).toBe('claude-code');
  });

  it('handles "vibe coding" and "auto mode"', () => {
    expect(applyCompounds('Vibe Coding via Auto Mode')).toBe('vibe-coding via auto-mode');
  });
});

describe('extractEnKeywords', () => {
  it('captures hyphenated compounds as single tokens', () => {
    const tokens = extractEnKeywords('Claude Code is great');
    expect(tokens.has('claude-code')).toBe(true);
    // Fragments should NOT also appear
    expect(tokens.has('claude')).toBe(false);
    expect(tokens.has('code')).toBe(false);
  });

  it('drops 1-char fragments', () => {
    const tokens = extractEnKeywords('a b c hello');
    expect(tokens.has('a')).toBe(false);
    expect(tokens.has('hello')).toBe(true);
  });
});

describe('extractCnBigrams', () => {
  it('splits Chinese text into character bigrams', () => {
    const bigrams = extractCnBigrams('翻譯文章');
    expect([...bigrams].sort()).toEqual(['文章', '翻譯', '譯文']);
  });

  it('returns empty set for non-Chinese text', () => {
    expect(extractCnBigrams('hello world').size).toBe(0);
  });
});

describe('jaccard', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns intersection / union otherwise', () => {
    // {a,b} ∩ {b,c} = {b}; ∪ = {a,b,c} → 1/3
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });

  it('returns 0 when either side is empty', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('meaningfulOverlap', () => {
  it('drops standalone domain stop words like "ai" / "agent"', () => {
    const a = new Set(['ai', 'agent', 'workflow']);
    const b = new Set(['ai', 'agent', 'workflow']);
    expect(meaningfulOverlap(a, b)).toBe(1); // only "workflow" counts
  });

  it('keeps hyphenated compounds even when they contain a stop word', () => {
    const a = new Set(['claude-code']);
    const b = new Set(['claude-code']);
    expect(meaningfulOverlap(a, b)).toBe(1);
  });
});

describe('computeSimilarity', () => {
  it('returns 0 for unrelated texts', () => {
    const r = computeSimilarity('cooking pasta recipes', '量子力學入門');
    expect(r.score).toBe(0);
  });

  it('returns high score + overlap for near-identical text', () => {
    const r = computeSimilarity(
      'agent teams claude-code workflow',
      'agent teams claude-code workflow'
    );
    // Score is enSim * 0.7 + cnSim * 0.3. Identical English-only text → 0.7.
    expect(r.score).toBeGreaterThanOrEqual(0.7);
    expect(r.enOverlap).toBeGreaterThanOrEqual(MIN_EN_OVERLAP);
  });
});

describe('layer1Match (URL gate)', () => {
  const articles = [
    {
      file: 'sp-1-x.mdx',
      ticketId: 'SP-1',
      title: 'Auto Mode',
      tags: [],
      sourceUrl: 'https://claude.com/blog/auto-mode',
      normalizedUrl: normalizeUrl('https://claude.com/blog/auto-mode'),
      tweetId: null,
      keywordText: 'Auto Mode',
    },
    {
      file: 'cp-1-x.mdx',
      ticketId: 'CP-1',
      title: 'Tweet pick',
      tags: [],
      sourceUrl: 'https://x.com/simonw/status/12345',
      normalizedUrl: normalizeUrl('https://x.com/simonw/status/12345'),
      tweetId: '12345',
      keywordText: 'Tweet pick',
    },
  ];

  it('matches normalized URL aliases', () => {
    const r = layer1Match(
      'https://www.anthropic.com/engineering/claude-code-auto-mode',
      articles
    );
    expect(r?.article.ticketId).toBe('SP-1');
    expect(r?.reason).toBe('URL match');
  });

  it('matches tweet ID across x.com / twitter.com', () => {
    const r = layer1Match('https://twitter.com/simonw/status/12345', articles);
    expect(r?.article.ticketId).toBe('CP-1');
    expect(r?.reason).toBe('tweet ID match');
  });

  it('returns null on no match', () => {
    expect(layer1Match('https://example.com/other', articles)).toBeNull();
  });

  it('returns null on empty URL', () => {
    expect(layer1Match('', articles)).toBeNull();
  });
});

describe('layer2Match (topic similarity)', () => {
  const articles = [
    {
      file: 'sp-100.mdx',
      ticketId: 'SP-100',
      title: 'Building agent teams with claude-code',
      tags: ['agent-teams', 'claude-code'],
      sourceUrl: '',
      normalizedUrl: '',
      tweetId: null,
      keywordText: 'Building agent teams with claude-code',
    },
  ];

  it('BLOCKs when score >= REJECT_THRESHOLD with enough overlap', () => {
    const r = layer2Match(
      'How to build agent teams with claude-code',
      ['agent-teams', 'claude-code'],
      articles
    );
    expect(r.verdict).toBe('BLOCK');
    expect(r.score).toBeGreaterThanOrEqual(REJECT_THRESHOLD);
    expect(r.article?.ticketId).toBe('SP-100');
  });

  it('PASSes for unrelated topics', () => {
    const r = layer2Match('Sourdough bread baking', ['food'], articles);
    expect(r.verdict).toBe('PASS');
  });

  it('PASSes when corpus is empty', () => {
    const r = layer2Match('anything', [], []);
    expect(r.verdict).toBe('PASS');
    expect(r.article).toBeNull();
  });

  it('thresholds are sane (FLAG < REJECT)', () => {
    expect(FLAG_THRESHOLD).toBeLessThan(REJECT_THRESHOLD);
    expect(MIN_EN_OVERLAP).toBeGreaterThanOrEqual(2);
  });
});

describe('layer3QueueCheck (intra-queue pairwise)', () => {
  it('flags duplicate tweet IDs across x.com / twitter.com', () => {
    const blocked = layer3QueueCheck([
      { url: 'https://x.com/a/status/100', title: 'X1', tags: [] },
      { url: 'https://twitter.com/a/status/100', title: 'X2', tags: [] },
    ]);
    expect(blocked.length).toBe(1);
    expect(blocked[0].reason).toBe('URL match');
  });

  it('flags duplicate normalized URLs', () => {
    const blocked = layer3QueueCheck([
      { url: 'https://www.anthropic.com/blog/x', title: 'a', tags: [] },
      { url: 'https://anthropic.com/blog/x/', title: 'b', tags: [] },
    ]);
    expect(blocked.length).toBe(1);
  });

  it('flags topic-similar pairs', () => {
    const blocked = layer3QueueCheck([
      {
        url: 'https://example.com/a',
        title: 'agent teams claude-code workflow',
        tags: ['agent-teams', 'claude-code'],
      },
      {
        url: 'https://example.com/b',
        title: 'agent teams claude-code workflow guide',
        tags: ['agent-teams', 'claude-code'],
      },
    ]);
    expect(blocked.length).toBe(1);
    expect(blocked[0].reason).toMatch(/topic similarity/);
  });

  it('returns empty for unrelated items', () => {
    const blocked = layer3QueueCheck([
      { url: 'https://example.com/cooking', title: 'pasta recipes', tags: [] },
      { url: 'https://example.com/quantum', title: '量子力學入門', tags: [] },
    ]);
    expect(blocked.length).toBe(0);
  });
});

describe('parseArgs', () => {
  it('parses single-candidate flags', () => {
    const args = parseArgs([
      '--url',
      'https://x.com/a/status/1',
      '--title',
      'Hi',
      '--tags',
      'a, b ,c',
      '--series',
      'sp',
    ]);
    expect(args.url).toBe('https://x.com/a/status/1');
    expect(args.title).toBe('Hi');
    expect(args.tags).toEqual(['a', 'b', 'c']);
    expect(args.series).toBe('SP');
  });

  it('parses --queue list of JSON strings', () => {
    const args = parseArgs([
      '--queue',
      '{"url":"u1","title":"t1"}',
      '{"url":"u2","title":"t2"}',
    ]);
    expect(args.queue.length).toBe(2);
    expect(args.queue[0].url).toBe('u1');
  });

  it('--dry-run sets dryRun true', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });
});
