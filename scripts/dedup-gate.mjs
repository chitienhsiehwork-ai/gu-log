#!/usr/bin/env node
/**
 * dedup-gate.mjs — Unified Dedup Gate for gu-log
 *
 * Single entry point for all article dedup checks.
 *
 * 3 layers:
 *   Layer 1: URL match (normalized + tweet/YouTube ID extraction + alias map)
 *   Layer 2: Topic similarity (compound tokens, cross-series Jaccard)
 *   Layer 3: Intra-queue pairwise comparison (--queue flag)
 *
 * CLI:
 *   node scripts/dedup-gate.mjs --url URL --title TITLE [--tags t1,t2] [--series GP|MP|SD|Lv]
 *   node scripts/dedup-gate.mjs --queue '{"url":...}' '{"url":...}'   (batch mode)
 *   node scripts/dedup-gate.mjs ... --dry-run
 *
 * Output (stdout):
 *   BLOCK: Duplicate of GP-127 (URL match)
 *   BLOCK: Source blocked — GP-35 was taken down (URL match): <title>
 *   WARN: Source taken down as GP-35 (URL match) — a new GP reading guide needs ...
 *   WARN: Similar to MP-238 (score: 0.24)
 *   PASS
 *
 * Taken-down posts (openspec: post-takedown) are blocked sources, not live
 * articles: Layer 1 still matches their URL / tweet / YouTube identity and
 * blocks with "Source blocked", while Layer 2 never compares against them
 * because their content is gone. Layer 1 looks at every article with the same
 * source. The one exception is a --series GP candidate whose source was taken
 * down only as GP and matches no live post: it gets a WARN, because a new GP
 * reading guide may reuse that source with a valid sourceDistance stamp, which
 * scripts/check-takedown-ratchet.mjs checks at commit. A source also taken down
 * as MP stays blocked for GP too. This file stays self-contained (the
 * gp-pipeline Go tests run a lone copy of it), so the status is read inline.
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

// Domain stop words: only demote standalone occurrences, NOT inside compounds.
// Includes frequent person/handle names — these indicate WHO the article covers,
// not WHAT topic, so they shouldn't count toward topic similarity overlap.
const DOMAIN_STOP_WORDS = new Set([
  // Tech domain terms
  'ai',
  'agent',
  'claude',
  'code',
  'anthropic',
  'coding',
  // Frequently-covered person names (cause false positives in pairwise scan)
  'simon',
  'willison',
  'simonw',
  'boris',
  'cherny',
  'bcherny',
  'karpathy',
  'rauchg',
  'andrew',
  'ng',
]);

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

// Tracking / share params that never change which article a URL points to
// (utm_* is stripped by prefix). One list for dedup, validate-posts and the
// takedown ratchet, so a share link cannot slip past a blocked source.
const TRACKING_PARAMS = new Set([
  'ref',
  'source',
  'smid', // NYT share links (?smid=url-share)
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

function normalizeUrl(raw) {
  if (!raw) return '';
  const url = raw.trim().replace(/^['"]|['"]$/g, '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }

  const youtubeVideoId = extractYouTubeVideoId(url);
  if (youtubeVideoId) {
    return `https://youtube.com/watch?v=${youtubeVideoId}`;
  }

  // Strip www / m subdomain
  let host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, '');

  const kept = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(k) && !k.startsWith('utm_')) {
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

/** Extract one YouTube video ID across watch / shorts / youtu.be URL forms. */
function extractYouTubeVideoId(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = null;
  if (host === 'youtu.be') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length === 1) videoId = parts[0];
  } else if (host === 'youtube.com') {
    if (parsed.pathname.replace(/\/+$/, '') === '/watch') {
      const values = parsed.searchParams.getAll('v');
      if (values.length === 1) videoId = values[0];
    } else {
      const match = parsed.pathname.match(/^\/shorts\/([^/]+)\/?$/);
      if (match) videoId = match[1];
    }
  }
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
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

/**
 * The Layer 1 identity of a source URL: normalized URL, tweet ID and YouTube
 * video ID. Anything compared with layer1Match() carries these three fields.
 */
function sourceIdentity(sourceUrl) {
  return {
    sourceUrl: sourceUrl ?? '',
    normalizedUrl: normalizeUrl(sourceUrl),
    tweetId: extractTweetId(sourceUrl),
    youtubeVideoId: extractYouTubeVideoId(sourceUrl),
  };
}

const TAKEN_DOWN_STATUS = 'taken-down';

function loadPublishedArticles(postsDir = POSTS_DIR) {
  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'));
  const articles = [];

  for (const file of files) {
    const filePath = path.join(postsDir, file);
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

    articles.push({
      file,
      ticketId: data.ticketId,
      title: data.title ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      ...sourceIdentity(data.sourceUrl),
      takenDown: data.status === TAKEN_DOWN_STATUS,
      keywordText: `${data.title ?? ''} ${data.summary ?? ''} ${Array.isArray(data.tags) ? data.tags.join(' ') : ''}`,
    });
  }

  return articles;
}

// ─── Layer 1: URL match ───────────────────────────────────────────────────────

/**
 * Every article whose source identity equals the candidate's, in corpus
 * order: callers decide on all of them (a source taken down as both a GP and
 * an MP stays blocked for a GP reading guide), so the first hit is not enough.
 */
function layer1Match(candidateUrl, articles) {
  if (!candidateUrl) return [];

  const normCandidate = normalizeUrl(candidateUrl);
  const candidateTweetId = extractTweetId(candidateUrl);
  const candidateYouTubeVideoId = extractYouTubeVideoId(candidateUrl);

  const matches = [];
  for (const art of articles) {
    // Tweet ID match (x.com vs twitter.com, mobile vs desktop)
    if (candidateTweetId && art.tweetId && candidateTweetId === art.tweetId) {
      matches.push({ article: art, reason: 'tweet ID match' });
      continue;
    }

    // YouTube identity match (watch vs shorts vs youtu.be).
    if (
      candidateYouTubeVideoId &&
      art.youtubeVideoId &&
      candidateYouTubeVideoId === art.youtubeVideoId
    ) {
      matches.push({ article: art, reason: 'YouTube video ID match' });
      continue;
    }

    // Normalized URL exact match
    if (normCandidate && art.normalizedUrl && normCandidate === art.normalizedUrl) {
      matches.push({ article: art, reason: 'URL match' });
    }
  }

  return matches;
}

const GP_TICKET = /^GP-(?:\d+|PENDING)$/;

/**
 * The Layer 1 verdict over every article with the candidate's source. A live
 * duplicate blocks as usual. A GP candidate whose source was taken down only
 * as GP gets a WARN (the takedown ratchet requires a valid source-distance
 * stamp at commit); any taken-down non-GP post keeps the source blocked.
 */
function layer1Verdict(matches, series) {
  const live = matches.find(({ article }) => !article.takenDown);
  if (live) return { verdict: 'BLOCK', line: formatLayer1Block(live) };
  const nonGp = matches.find(({ article }) => !GP_TICKET.test(article.ticketId));
  if (series !== 'GP' || nonGp) {
    return { verdict: 'BLOCK', line: formatLayer1Block(nonGp ?? matches[0]) };
  }
  const takenDownAs = matches
    .map(({ article, reason }) => `${article.ticketId} (${reason})`)
    .join(', ');
  return {
    verdict: 'WARN',
    line: `WARN: Source taken down as ${takenDownAs} — a new GP reading guide may use it only with a valid sourceDistance stamp (tools/gp-pipeline/gp-pipeline stamp); the takedown ratchet checks it at commit`,
  };
}

/** The stdout line for a Layer 1 hit; a taken-down match is a blocked source. */
function formatLayer1Block({ article, reason }) {
  if (article.takenDown) {
    return `BLOCK: Source blocked — ${article.ticketId} was taken down (${reason}): ${article.title}`;
  }
  return `BLOCK: Duplicate of ${article.ticketId} (${reason}): ${article.title}`;
}

// ─── Layer 2: Topic similarity ────────────────────────────────────────────────

function layer2Match(candidateTitle, candidateTags, articles) {
  const candidateTex = `${candidateTitle} ${candidateTags.join(' ')}`;
  let best = { score: 0, enOverlap: 0, article: null };

  for (const art of articles) {
    // A taken-down post's content is gone; only its source identity blocks.
    if (art.takenDown) continue;
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
      const youtubeA = extractYouTubeVideoId(a.url);
      const youtubeB = extractYouTubeVideoId(b.url);

      if (
        (tweetA && tweetB && tweetA === tweetB) ||
        (youtubeA && youtubeB && youtubeA === youtubeB) ||
        (normA && normB && normA === normB)
      ) {
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
    identityOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];

    if (flag === '--dry-run') {
      args.dryRun = true;
    } else if (flag === '--identity-only') {
      args.identityOnly = true;
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
    } else if (flag === '--series') {
      if (!next || next.startsWith('--')) {
        throw new Error('--series requires GP, MP, SD or Lv');
      }
      const upper = next.toUpperCase();
      if (upper === 'SP') {
        throw new Error('retired series "SP"; use "GP"');
      }
      if (upper === 'CP') {
        throw new Error('retired series "CP"; use "MP"');
      }
      const series = { GP: 'GP', MP: 'MP', SD: 'SD', LV: 'Lv' }[upper];
      if (!series) {
        throw new Error(`unsupported series "${next}"; expected GP, MP, SD or Lv`);
      }
      args.series = series;
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
      'Usage: node scripts/dedup-gate.mjs --url URL --title TITLE [--tags t1,t2] [--series GP|MP|SD|Lv] [--dry-run]\n'
    );
    process.exit(2);
  }

  // Layer 1: URL
  const urlMatches = layer1Match(args.url, articles);
  let sourceWarning = null;
  if (urlMatches.length > 0) {
    const { verdict, line } = layer1Verdict(urlMatches, args.series);
    if (verdict === 'BLOCK') {
      process.stdout.write(line + '\n');
      if (!args.dryRun) process.exit(1);
      process.exit(0);
    }
    sourceWarning = line;
  }

  if (args.identityOnly) {
    process.stdout.write(`${sourceWarning ?? 'PASS'}\n`);
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
    process.stdout.write([sourceWarning, msg].filter(Boolean).join('\n') + '\n');
    process.exit(0);
  }

  process.stdout.write(`${sourceWarning ?? 'PASS'}\n`);
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

// ─── Exports (validate-posts.mjs --check-duplicates, check-takedown-ratchet.mjs) ─
export {
  normalizeUrl,
  extractTweetId,
  extractYouTubeVideoId,
  applyCompounds,
  extractEnKeywords,
  extractCnBigrams,
  meaningfulOverlap,
  jaccard,
  computeSimilarity,
  sourceIdentity,
  layer1Match,
  layer1Verdict,
  formatLayer1Block,
  layer2Match,
  layer3QueueCheck,
  loadPublishedArticles,
  parseArgs,
  REJECT_THRESHOLD,
  FLAG_THRESHOLD,
  MIN_EN_OVERLAP,
};
