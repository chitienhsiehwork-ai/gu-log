#!/usr/bin/env node
/**
 * dedup-gate.mjs — Unified Dedup Gate for gu-log
 *
 * Single entry point for all article dedup checks.
 *
 * 3 layers:
 *   Layer 1: URL match (normalized + tweet ID extraction + alias map)
 *   Layer 2: Topic similarity (compound tokens, cross-series Jaccard)
 *   Layer 3: Intra-queue pairwise comparison (--queue flag)
 *
 * CLI:
 *   node scripts/dedup-gate.mjs --url URL --title TITLE [--tags t1,t2] [--series CP|SP]
 *   node scripts/dedup-gate.mjs --queue '{"url":...}' '{"url":...}'   (batch mode)
 *   node scripts/dedup-gate.mjs ... --dry-run
 *
 * Output (stdout):
 *   BLOCK: Duplicate of SP-127 (URL match)
 *   WARN: Similar to CP-238 (score: 0.24)
 *   PASS
 *
 * Exit codes:
 *   0 = PASS or WARN (pipeline may continue)
 *   1 = BLOCK (pipeline must stop)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');

// ─── Thresholds ──────────────────────────────────────────────────────────────

const REJECT_THRESHOLD = 0.3;
const FLAG_THRESHOLD = 0.18;
const MIN_EN_OVERLAP = 2; // reduced from 3 per spec

// ─── Compound token map ───────────────────────────────────────────────────────
// Order matters: longer/more-specific first
const COMPOUND_TOKENS = [
  ['claude code', 'claude-code'],
  ['claude-code', 'claude-code'], // already hyphenated
  ['agent teams', 'agent-teams'],
  ['agent-teams', 'agent-teams'],
  ['auto mode', 'auto-mode'],
  ['auto-mode', 'auto-mode'],
  ['vibe coding', 'vibe-coding'],
  ['vibe-coding', 'vibe-coding'],
];

// Domain stop words: only demote standalone occurrences, NOT inside compounds
const DOMAIN_STOP_WORDS = new Set(['ai', 'agent', 'claude', 'code', 'anthropic', 'coding']);

// ─── URL utilities ────────────────────────────────────────────────────────────

// Known URL alias pairs: [fromHost, fromPathPrefix] → [toHost, toPath]
const URL_ALIASES = [
  [
    ['claude.com', '/blog/auto-mode'],
    ['anthropic.com', '/engineering/claude-code-auto-mode'],
  ],
  [
    ['www.anthropic.com', ''],
    ['anthropic.com', ''],
  ],
  [
    ['www.claude.com', ''],
    ['claude.com', ''],
  ],
];

function normalizeUrl(raw) {
  if (!raw) return '';
  const url = raw.trim().replace(/^['"]|['"]$/g, '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }

  // Strip www / m subdomain
  let host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, '');

  // Strip tracking params
  const STRIP_PARAMS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'ref',
    'source',
  ];
  const kept = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!STRIP_PARAMS.includes(k) && !k.startsWith('utm_')) {
      kept.push(`${k}=${v}`);
    }
  }

  let pathStr = parsed.pathname.replace(/\/+$/, '');

  // Apply alias map
  for (const [[aliasHost, aliasPath], [targetHost, targetPath]] of URL_ALIASES) {
    const normAlias = aliasHost.replace(/^(www|m)\./, '');
    if (host === normAlias && (aliasPath === '' || pathStr.startsWith(aliasPath))) {
      if (aliasPath !== '') {
        host = targetHost;
        pathStr = targetPath;
      } else {
        host = targetHost;
      }
      break;
    }
  }

  const query = kept.join('&');
  return `https://${host}${pathStr}${query ? '?' + query : ''}`;
}

/** Extract tweet status ID from x.com/twitter.com URLs. Returns null if not a tweet URL. */
function extractTweetId(url) {
  if (!url) return null;
  const match = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
  return match ? match[1] : null;
}

// ─── Keyword / similarity utilities ──────────────────────────────────────────

/**
 * Replace known compound phrases with single hyphenated tokens before tokenizing.
 * This prevents stop-word demotion from eating discriminating terms like "claude-code".
 */
function applyCompounds(text) {
  let out = text.toLowerCase();
  for (const [phrase, token] of COMPOUND_TOKENS) {
    // Replace whole-word occurrences (handle hyphens as word boundaries)
    const escaped = phrase.replace(/[-]/g, '[-\\s]').replace(/\s/g, '[-\\s]');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), token);
  }
  return out;
}

/** Extract English keyword tokens (2+ chars). */
function extractEnKeywords(text) {
  // First apply compound substitution
  const processed = applyCompounds(text);

  const tokens = new Set();
  // Match hyphenated compound tokens first (e.g. claude-code, auto-mode)
  const compoundMatches = processed.match(/[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+/g) ?? [];
  for (const t of compoundMatches) {
    tokens.add(t);
  }

  // Then plain English words (2+ chars)
  const wordMatches = processed.match(/[a-z][a-z0-9]{1,}/g) ?? [];
  for (const w of wordMatches) {
    // Skip if it's a fragment of an already-captured compound
    let isFragment = false;
    for (const comp of compoundMatches) {
      if (comp.split('-').includes(w)) {
        isFragment = true;
        break;
      }
    }
    if (!isFragment) {
      tokens.add(w);
    }
  }

  return tokens;
}

/** "Meaningful" overlap = shared English tokens minus standalone stop words. */
function meaningfulOverlap(setA, setB) {
  const shared = new Set([...setA].filter((t) => setB.has(t)));
  // A token is standalone (not a compound) if it has no hyphen
  const meaningful = new Set(
    [...shared].filter((t) => t.includes('-') || !DOMAIN_STOP_WORDS.has(t))
  );
  return meaningful.size;
}

/** Extract Chinese bigrams. */
function extractCnBigrams(text) {
  const chars = text.match(/[\u4e00-\u9fff]/g) ?? [];
  const bigrams = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.add(chars[i] + chars[i + 1]);
  }
  return bigrams;
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const item of setA) {
    if (setB.has(item)) inter++;
  }
  return inter / (setA.size + setB.size - inter);
}

/**
 * Compute topic similarity score between two texts.
 * Returns { score, enOverlap }.
 */
function computeSimilarity(textA, textB) {
  const enA = extractEnKeywords(textA);
  const enB = extractEnKeywords(textB);
  const cnA = extractCnBigrams(textA);
  const cnB = extractCnBigrams(textB);

  const enSim = jaccard(enA, enB);
  const cnSim = jaccard(cnA, cnB);
  const score = enSim * 0.7 + cnSim * 0.3;
  const enOverlap = meaningfulOverlap(enA, enB);

  return { score, enOverlap };
}

// ─── Article loading ──────────────────────────────────────────────────────────

function loadPublishedArticles() {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'));
  const articles = [];

  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);
    let data;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      ({ data } = matter(raw));
    } catch {
      continue;
    }

    if (!data || !data.ticketId) continue;
    // Skip deprecated articles (they're excluded from dedup comparisons)
    if (data.status === 'deprecated') continue;

    const sourceUrl = data.sourceUrl ?? '';
    const normalizedUrl = normalizeUrl(sourceUrl);
    const tweetId = extractTweetId(sourceUrl);

    articles.push({
      file,
      ticketId: data.ticketId,
      title: data.title ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      sourceUrl,
      normalizedUrl,
      tweetId,
      keywordText: `${data.title ?? ''} ${data.summary ?? ''} ${Array.isArray(data.tags) ? data.tags.join(' ') : ''}`,
    });
  }

  return articles;
}

// ─── Layer 1: URL match ───────────────────────────────────────────────────────

function layer1Match(candidateUrl, articles) {
  if (!candidateUrl) return null;

  const normCandidate = normalizeUrl(candidateUrl);
  const candidateTweetId = extractTweetId(candidateUrl);

  for (const art of articles) {
    // Tweet ID match (x.com vs twitter.com, mobile vs desktop)
    if (candidateTweetId && art.tweetId && candidateTweetId === art.tweetId) {
      return { article: art, reason: 'tweet ID match' };
    }

    // Normalized URL exact match
    if (normCandidate && art.normalizedUrl && normCandidate === art.normalizedUrl) {
      return { article: art, reason: 'URL match' };
    }
  }

  return null;
}

// ─── Layer 2: Topic similarity ────────────────────────────────────────────────

function layer2Match(candidateTitle, candidateTags, articles) {
  const candidateTex = `${candidateTitle} ${candidateTags.join(' ')}`;
  let best = { score: 0, enOverlap: 0, article: null };

  for (const art of articles) {
    // Title-to-title (tight match)
    const titleSim = computeSimilarity(candidateTitle, art.title);
    // Full-to-full (broad match)
    const fullSim = computeSimilarity(candidateTex, art.keywordText);

    const { score, enOverlap } = titleSim.score >= fullSim.score ? titleSim : fullSim;

    if (score > best.score) {
      best = { score, enOverlap, article: art };
    }
  }

  if (!best.article) return { verdict: 'PASS', score: 0, article: null };

  const { score, enOverlap, article } = best;

  if (score >= REJECT_THRESHOLD && enOverlap >= MIN_EN_OVERLAP) {
    return { verdict: 'BLOCK', score, article };
  }
  if (score >= FLAG_THRESHOLD) {
    return { verdict: 'WARN', score, article };
  }
  return { verdict: 'PASS', score, article };
}

// ─── Layer 3: Intra-queue pairwise ───────────────────────────────────────────

/**
 * Given a list of queue items [{url, title, tags}], find pairs that are duplicates.
 * Returns list of { indexA, indexB, reason, score } for blocked pairs.
 */
function layer3QueueCheck(items) {
  const blocked = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];

      // URL match
      const normA = normalizeUrl(a.url);
      const normB = normalizeUrl(b.url);
      const tweetA = extractTweetId(a.url);
      const tweetB = extractTweetId(b.url);

      if ((tweetA && tweetB && tweetA === tweetB) || (normA && normB && normA === normB)) {
        blocked.push({ indexA: i, indexB: j, reason: 'URL match', score: 1.0 });
        continue;
      }

      // Topic similarity
      const { score, enOverlap } = computeSimilarity(
        `${a.title} ${(a.tags ?? []).join(' ')}`,
        `${b.title} ${(b.tags ?? []).join(' ')}`
      );
      if (score >= REJECT_THRESHOLD && enOverlap >= MIN_EN_OVERLAP) {
        blocked.push({
          indexA: i,
          indexB: j,
          reason: `topic similarity ${score.toFixed(3)}`,
          score,
        });
      }
    }
  }

  return blocked;
}

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    url: '',
    title: '',
    tags: [],
    series: '',
    queue: [],
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];

    if (flag === '--dry-run') {
      args.dryRun = true;
    } else if (flag === '--url' && next) {
      args.url = next;
      i++;
    } else if (flag === '--title' && next) {
      args.title = next;
      i++;
    } else if (flag === '--tags' && next) {
      args.tags = next
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      i++;
    } else if (flag === '--series' && next) {
      args.series = next.toUpperCase();
      i++;
    } else if (flag === '--queue') {
      // Consume all remaining positional args after --queue as JSON objects
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        try {
          args.queue.push(JSON.parse(argv[i]));
        } catch {
          // Try as a file path
          try {
            args.queue.push(JSON.parse(fs.readFileSync(argv[i], 'utf8')));
          } catch {
            process.stderr.write(`WARN: could not parse queue item: ${argv[i]}\n`);
          }
        }
        i++;
      }
      i--; // step back one since the for loop will i++
    }
  }

  return args;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  const articles = loadPublishedArticles();

  // ── Queue / batch mode (Layer 3) ──
  if (args.queue.length > 0) {
    const blockedPairs = layer3QueueCheck(args.queue);
    if (blockedPairs.length === 0) {
      process.stdout.write('PASS\n');
      process.exit(0);
    }

    const lines = blockedPairs.map(
      ({ indexA, indexB, reason }) =>
        `BLOCK: Queue item[${indexB}] is duplicate of item[${indexA}] (${reason})`
    );
    process.stdout.write(lines.join('\n') + '\n');

    if (!args.dryRun) {
      process.exit(1);
    }
    process.exit(0);
  }

  // ── Single candidate check ──
  if (!args.url && !args.title) {
    process.stderr.write(
      'Usage: node scripts/dedup-gate.mjs --url URL --title TITLE [--tags t1,t2] [--series CP|SP] [--dry-run]\n'
    );
    process.exit(2);
  }

  // Layer 1: URL
  const urlMatch = layer1Match(args.url, articles);
  if (urlMatch) {
    const { article, reason } = urlMatch;
    const msg = `BLOCK: Duplicate of ${article.ticketId} (${reason}): ${article.title}`;
    process.stdout.write(msg + '\n');
    if (!args.dryRun) process.exit(1);
    process.exit(0);
  }

  // Layer 2: Topic similarity (cross-series — all zh-tw articles)
  const topicResult = layer2Match(args.title, args.tags, articles);
  if (topicResult.verdict === 'BLOCK') {
    const { article, score } = topicResult;
    const msg = `BLOCK: Duplicate of ${article.ticketId} (topic similarity: ${score.toFixed(3)}): ${article.title}`;
    process.stdout.write(msg + '\n');
    if (!args.dryRun) process.exit(1);
    process.exit(0);
  }

  if (topicResult.verdict === 'WARN') {
    const { article, score } = topicResult;
    const msg = `WARN: Similar to ${article.ticketId} (score: ${score.toFixed(3)}): ${article.title}`;
    process.stdout.write(msg + '\n');
    process.exit(0);
  }

  process.stdout.write('PASS\n');
  process.exit(0);
}

// Only run as CLI entry point (not when imported as a module)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(2);
  }
}

// ─── Exports (for use by validate-posts.mjs --check-duplicates) ───────────────
export {
  normalizeUrl,
  extractTweetId,
  computeSimilarity,
  layer1Match,
  layer2Match,
  loadPublishedArticles,
  REJECT_THRESHOLD,
  FLAG_THRESHOLD,
  MIN_EN_OVERLAP,
};
