/**
 * Unit tests for scripts/dedup-gate.mjs
 *
 * Covers Layer 1 (URL match), Layer 2 (topic similarity), Layer 3 (queue pairwise),
 * plus the URL/keyword helpers that drive the thresholds.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dedupModule from '../scripts/dedup-gate.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

// dedup-gate.mjs is plain JS without .d.ts; widen for ergonomic destructuring.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dedup = dedupModule as any;
const {
  normalizeUrl,
  extractTweetId,
  extractYouTubeVideoId,
  applyCompounds,
  extractEnKeywords,
  extractCnBigrams,
  meaningfulOverlap,
  jaccard,
  computeSimilarity,
  layer1Match,
  formatLayer1Block,
  layer2Match,
  layer3QueueCheck,
  loadPublishedArticles,
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
    expect(normalizeUrl('https://example.com/x?utm_source=a&utm_medium=b&id=42')).toBe(
      'https://example.com/x?id=42'
    );
  });

  it('strips bare ref / source params', () => {
    expect(normalizeUrl('https://example.com/x?ref=hn&id=1')).toBe('https://example.com/x?id=1');
  });

  it('strips share / click tracking params (smid, fbclid, gclid, Mailchimp)', () => {
    expect(normalizeUrl('https://www.nytimes.com/2026/02/23/opinion/ai.html?smid=url-share')).toBe(
      'https://nytimes.com/2026/02/23/opinion/ai.html'
    );
    expect(
      normalizeUrl('https://example.com/x?fbclid=a&gclid=b&mc_cid=c&mc_eid=d&id=7&utm_term=e')
    ).toBe('https://example.com/x?id=7');
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
    expect(extractTweetId('https://twitter.com/karpathy/status/9876543210')).toBe('9876543210');
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

describe('extractYouTubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
  ])('extracts %s', (url, expected) => {
    expect(extractYouTubeVideoId(url)).toBe(expected);
  });

  it('rejects playlist-only and lookalike hosts', () => {
    expect(extractYouTubeVideoId('https://youtube.com/playlist?list=PL123')).toBeNull();
    expect(extractYouTubeVideoId('https://youtube.com.evil/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('normalizes every supported form to one identity URL', () => {
    const forms = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=10',
    ];
    expect(new Set(forms.map(normalizeUrl))).toEqual(
      new Set(['https://youtube.com/watch?v=dQw4w9WgXcQ'])
    );
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articles: any[] = [
    {
      file: 'gp-1-x.mdx',
      ticketId: 'GP-1',
      title: 'Auto Mode',
      tags: [],
      sourceUrl: 'https://claude.com/blog/auto-mode',
      normalizedUrl: normalizeUrl('https://claude.com/blog/auto-mode'),
      tweetId: null,
      keywordText: 'Auto Mode',
    },
    {
      file: 'mp-1-x.mdx',
      ticketId: 'MP-1',
      title: 'Tweet pick',
      tags: [],
      sourceUrl: 'https://x.com/simonw/status/12345',
      normalizedUrl: normalizeUrl('https://x.com/simonw/status/12345'),
      tweetId: '12345',
      youtubeVideoId: null,
      keywordText: 'Tweet pick',
    },
    {
      file: 'gp-2-youtube.mdx',
      ticketId: 'GP-2',
      title: 'YouTube pick',
      tags: [],
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      normalizedUrl: normalizeUrl('https://youtu.be/dQw4w9WgXcQ'),
      tweetId: null,
      youtubeVideoId: 'dQw4w9WgXcQ',
      keywordText: 'YouTube pick',
    },
  ];

  it('matches normalized URL aliases', () => {
    const [r] = layer1Match(
      'https://www.anthropic.com/engineering/claude-code-auto-mode',
      articles
    );
    expect(r?.article.ticketId).toBe('GP-1');
    expect(r?.reason).toBe('URL match');
  });

  it('matches tweet ID across x.com / twitter.com', () => {
    const [r] = layer1Match('https://twitter.com/simonw/status/12345', articles);
    expect(r?.article.ticketId).toBe('MP-1');
    expect(r?.reason).toBe('tweet ID match');
  });

  it('matches YouTube video ID across watch / shorts / youtu.be forms', () => {
    const [r] = layer1Match('https://youtube.com/shorts/dQw4w9WgXcQ', articles);
    expect(r?.article.ticketId).toBe('GP-2');
    expect(r?.reason).toBe('YouTube video ID match');
  });

  it('returns every article with the same source, not just the first', () => {
    const twin = { ...articles[0], file: 'mp-9-same-source.mdx', ticketId: 'MP-9' };
    const matches = layer1Match('https://www.anthropic.com/engineering/claude-code-auto-mode', [
      ...articles,
      twin,
    ]);
    expect(matches.map((m: { article: { ticketId: string } }) => m.article.ticketId)).toEqual([
      'GP-1',
      'MP-9',
    ]);
  });

  it('returns no match for another source', () => {
    expect(layer1Match('https://example.com/other', articles)).toEqual([]);
  });

  it('returns no match for an empty URL', () => {
    expect(layer1Match('', articles)).toEqual([]);
  });
});

describe('layer2Match (topic similarity)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articles: any[] = [
    {
      file: 'gp-100.mdx',
      ticketId: 'GP-100',
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
    expect(r.article?.ticketId).toBe('GP-100');
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

  it('flags duplicate YouTube IDs across URL forms', () => {
    const blocked = layer3QueueCheck([
      { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', title: 'a', tags: [] },
      { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'b', tags: [] },
    ]);
    expect(blocked.length).toBe(1);
    expect(blocked[0].reason).toBe('URL match');
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
      'gp',
    ]);
    expect(args.url).toBe('https://x.com/a/status/1');
    expect(args.title).toBe('Hi');
    expect(args.tags).toEqual(['a', 'b', 'c']);
    expect(args.series).toBe('GP');
  });

  it.each([
    ['SP', 'use "GP"'],
    ['CP', 'use "MP"'],
  ])('rejects retired series %s', (series, hint) => {
    expect(() => parseArgs(['--series', series])).toThrow(hint);
  });

  it('rejects unknown or missing series values', () => {
    expect(() => parseArgs(['--series', 'SD'])).toThrow('expected GP or MP');
    expect(() => parseArgs(['--series'])).toThrow('requires GP or MP');
  });

  it('parses --queue list of JSON strings', () => {
    const args = parseArgs(['--queue', '{"url":"u1","title":"t1"}', '{"url":"u2","title":"t2"}']);
    expect(args.queue.length).toBe(2);
    expect(args.queue[0].url).toBe('u1');
  });

  it('--dry-run sets dryRun true', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--identity-only stops the CLI contract at deterministic identity matching', () => {
    expect(parseArgs(['--identity-only']).identityOnly).toBe(true);
  });

  it('preserves --url after --series for identity-only candidate checks', () => {
    const args = parseArgs([
      '--series',
      'GP',
      '--url',
      'https://youtu.be/dQw4w9WgXcQ',
      '--identity-only',
    ]);
    expect(args.url).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(args.identityOnly).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// taken-down（openspec: post-takedown）：下架文章是「來源已封鎖」，不是「不存在」。
// ════════════════════════════════════════════════════════════════════════════
describe('taken-down posts are blocked sources', () => {
  const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
  const postsDir = makeTempDirectory('gu-log-dedup-takedown-');
  const write = (file: string, fm: string[]) =>
    fs.writeFileSync(path.join(postsDir, file), `---\n${fm.join('\n')}\n---\n`);
  write('gp-35-agent-teams.mdx', [
    'ticketId: "GP-35"',
    'title: "Claude Code Agent Teams 官方文件深入解析"',
    'sourceUrl: "https://code.claude.com/docs/en/agent-teams"',
    'tags: ["claude-code", "agent-teams"]',
    'status: "taken-down"',
  ]);
  write('mp-9-live.mdx', [
    'ticketId: "MP-9"',
    'title: "Codex CLI sandbox 設定筆記"',
    'sourceUrl: "https://example.com/codex-sandbox"',
    'tags: ["codex"]',
  ]);
  write('mp-8-deprecated.mdx', [
    'ticketId: "MP-8"',
    'title: "舊文"',
    'sourceUrl: "https://example.com/old"',
    'status: "deprecated"',
    'deprecatedBy: "MP-9"',
  ]);
  const articles = loadPublishedArticles(postsDir);

  it('keeps taken-down posts for identity matching and flags them', () => {
    const byTicket = Object.fromEntries(
      articles.map((article: { ticketId: string; takenDown: boolean }) => [
        article.ticketId,
        article.takenDown,
      ])
    );
    expect(byTicket).toEqual({ 'GP-35': true, 'MP-9': false });
  });

  it('Layer 1 BLOCKs a candidate from a taken-down source and says why', () => {
    const [match] = layer1Match(
      'https://code.claude.com/docs/en/agent-teams/?utm_source=x',
      articles
    );
    expect(match?.article.ticketId).toBe('GP-35');
    expect(formatLayer1Block(match)).toBe(
      'BLOCK: Source blocked — GP-35 was taken down (URL match): Claude Code Agent Teams 官方文件深入解析'
    );
    const [live] = layer1Match('https://example.com/codex-sandbox', articles);
    expect(formatLayer1Block(live)).toBe(
      'BLOCK: Duplicate of MP-9 (URL match): Codex CLI sandbox 設定筆記'
    );
  });

  it('Layer 2 never compares against a taken-down post', () => {
    const result = layer2Match(
      'Claude Code Agent Teams 官方文件深入解析',
      ['claude-code', 'agent-teams'],
      articles
    );
    expect(result.article?.ticketId).not.toBe('GP-35');
    expect(result.verdict).toBe('PASS');
  });
});
