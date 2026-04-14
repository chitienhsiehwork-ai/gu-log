#!/usr/bin/env node
/**
 * gu-log Post Validator — Deterministic quality gate
 *
 * All checks are programmatic. No LLM. No advisory. All blocking.
 * Exit code 0 = pass, 1 = fail.
 *
 * Usage:
 *   node scripts/validate-posts.mjs                    # validate all posts
 *   node scripts/validate-posts.mjs file1.mdx file2.mdx  # validate specific files
 *   node scripts/validate-posts.mjs --check-duplicates # scan all posts for duplicates
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeUrl,
  extractTweetId,
  computeSimilarity,
  REJECT_THRESHOLD,
  FLAG_THRESHOLD,
  MIN_EN_OVERLAP,
} from './dedup-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');
const _COUNTER_FILE = path.join(__dirname, 'article-counter.json');

// ─── Config ────────────────────────────────────────────────────────
const _VALID_PREFIXES = ['SP', 'CP', 'SD', 'Lv'];
const VALID_LANGS = ['zh-tw', 'en'];
// PENDING is a legitimate in-flight ticket state used by the sp-pipeline
// and by manual drafters working on parallel branches. The deploy step
// swaps PENDING for a real number allocated from article-counter.json at
// the last moment (see CONTRIBUTING.md §並行撰寫防 ID collision).
const TICKET_PATTERN = /^(SP|CP|SD|Lv)-(?:\d+|PENDING)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /^https?:\/\/.+/;
const MIN_CONTENT_LENGTH = 200; // characters, excluding frontmatter
const REDUNDANT_BOTTOM_CITATION_PATTERNS = [
  /\n---\s*\n+\*\*原文來源[：:]\*\*/,
  /\n---\s*\n+\*\*Original source[：:]\*\*/i,
  /\n---\s*\n+\*\*Source[：:]\*\*/i,
  /\n##\s*原文出處/,
];
const CLAWD_NOTE_REDUNDANT_PREFIX = [
  /<ClawdNote>\s*\n?\s*\*\*Clawd[：:]\*\*/i,
  /<ClawdNote>\s*\n?\s*Clawd[：:]\s/i,
];

// ─── Helpers ───────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const raw = match[1];

  // Simple YAML parser for flat fields
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w[\w.]*?):\s*(.+)/);
    if (kv) {
      let val = kv[2].trim();
      // Strip quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      fm[kv[1]] = val;
    }
  }

  // Parse nested objects (e.g., translatedBy.model, translatedBy.harness)
  const nestedMatch = raw.match(/^(\w+):\s*\n((?:\s+\w+:.*\n?)+)/gm);
  if (nestedMatch) {
    for (const block of nestedMatch) {
      const lines = block.split('\n');
      const parentKey = lines[0].match(/^(\w+):/)?.[1];
      if (parentKey) {
        fm[parentKey] = {};
        for (let i = 1; i < lines.length; i++) {
          const childMatch = lines[i].match(/^\s+(\w+):\s*(.+)/);
          if (childMatch) {
            let val = childMatch[2].trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            fm[parentKey][childMatch[1]] = val;
          }
        }
      }
    }
  }

  // Parse tags array
  const tagsMatch = raw.match(/tags:\s*\[(.*?)\]/s);
  if (tagsMatch) {
    fm.tags = tagsMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/["']/g, ''))
      .filter(Boolean);
  }

  return fm;
}

function getBaseFilename(filename) {
  return filename.startsWith('en-') ? filename.slice(3) : filename;
}

function getContentBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
  return match ? match[1] : '';
}

// ─── Validation Rules ──────────────────────────────────────────────
function validatePost(filepath, allPosts) {
  const filename = path.basename(filepath);
  const content = fs.readFileSync(filepath, 'utf-8');
  const fm = parseFrontmatter(content);
  const body = getContentBody(content);
  const errors = [];
  const warnings = [];

  // ── Rule 1: Frontmatter exists ──
  if (!fm) {
    errors.push('Missing or malformed frontmatter (--- block)');
    return { filename, errors, warnings };
  }

  // ── Rule 2: Required fields ──
  const required = ['title', 'originalDate', 'source', 'sourceUrl', 'summary', 'lang'];
  for (const field of required) {
    if (!fm[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // ── Rule 3: ticketId present and valid format ──
  if (!fm.ticketId) {
    errors.push('Missing ticketId');
  } else if (!TICKET_PATTERN.test(fm.ticketId)) {
    errors.push(`Invalid ticketId format: "${fm.ticketId}" (expected SP-N, CP-N, SD-N, or Lv-N)`);
  }

  // ── Rule 4: Date formats ──
  if (fm.originalDate && !DATE_PATTERN.test(fm.originalDate)) {
    errors.push(`Invalid originalDate format: "${fm.originalDate}" (expected YYYY-MM-DD)`);
  }
  if (fm.translatedDate && !DATE_PATTERN.test(fm.translatedDate)) {
    errors.push(`Invalid translatedDate format: "${fm.translatedDate}" (expected YYYY-MM-DD)`);
  }

  // ── Rule 5: sourceUrl is valid URL ──
  if (fm.sourceUrl && !URL_PATTERN.test(fm.sourceUrl)) {
    errors.push(`Invalid sourceUrl: "${fm.sourceUrl}" (must start with http:// or https://)`);
  }

  // ── Rule 6: lang matches filename convention ──
  if (fm.lang) {
    if (!VALID_LANGS.includes(fm.lang)) {
      errors.push(`Invalid lang: "${fm.lang}" (expected: ${VALID_LANGS.join(', ')})`);
    }
    const isEnFile = filename.startsWith('en-');
    if (fm.lang === 'en' && !isEnFile) {
      errors.push(`lang is "en" but filename doesn't start with "en-"`);
    }
    if (fm.lang === 'zh-tw' && isEnFile) {
      errors.push(`lang is "zh-tw" but filename starts with "en-"`);
    }
  }

  // ── Rule 7: tags is an array (if present) ──
  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    errors.push('tags must be an array');
  }

  // ── Rule 8: No duplicate bottom citations ──
  for (const pattern of REDUNDANT_BOTTOM_CITATION_PATTERNS) {
    if (pattern.test(content)) {
      errors.push('Redundant bottom citation found (source is already shown at top by layout)');
      break;
    }
  }

  // ── Rule 9: ClawdNote no redundant prefix ──
  for (const pattern of CLAWD_NOTE_REDUNDANT_PREFIX) {
    if (pattern.test(content)) {
      errors.push('ClawdNote contains redundant "Clawd:" prefix (component auto-adds it)');
      break;
    }
  }

  // ── Rule 10: Minimum content length ──
  // Strip imports and component tags for length check
  const cleanBody = body
    .replace(/^import\s+.*$/gm, '')
    .replace(/<\/?[\w]+[^>]*>/g, '')
    .trim();
  if (cleanBody.length < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short (${cleanBody.length} chars, minimum ${MIN_CONTENT_LENGTH})`);
  }

  // ── Rule 11: summary not too long (for index page) ──
  if (fm.summary && fm.summary.length > 300) {
    warnings.push(`summary is ${fm.summary.length} chars (recommend ≤300 for index page)`);
  }

  // ── Rule 12: ticketId uniqueness (cross-file check) ──
  // Exempt PENDING — multiple parallel drafts legitimately share the
  // PENDING placeholder; real numbers get allocated per-draft at deploy.
  if (fm.ticketId && allPosts && !fm.ticketId.endsWith('-PENDING')) {
    const sameTicket = allPosts.filter(
      (p) => p.ticketId === fm.ticketId && getBaseFilename(p.filename) !== getBaseFilename(filename)
    );
    if (sameTicket.length > 0) {
      errors.push(
        `Duplicate ticketId "${fm.ticketId}" also in: ${sameTicket.map((p) => p.filename).join(', ')}`
      );
    }
  }

  // ── Rule 13: Translation pair ticketId consistency ──
  if (fm.ticketId && allPosts) {
    const baseName = getBaseFilename(filename);
    const pair = allPosts.find(
      (p) => getBaseFilename(p.filename) === baseName && p.filename !== filename
    );
    if (pair && pair.ticketId && pair.ticketId !== fm.ticketId) {
      errors.push(
        `Translation pair ticketId mismatch: this="${fm.ticketId}", pair="${pair.ticketId}" (${pair.filename})`
      );
    }
  }

  // ── Rule 14: translatedBy.model must have version number ──
  if (fm.translatedBy?.model) {
    const model = fm.translatedBy.model;
    // Must contain a version number (e.g., "Opus 4.6", "Sonnet 4.5", "Gemini 3 Pro")
    if (!/\d+\.\d+|\d+ Pro|\d+ Flash/i.test(model)) {
      errors.push(
        `translatedBy.model "${model}" missing version — use full name like "Opus 4.6" (run: node scripts/detect-model.mjs <model-id>)`
      );
    }
  }

  // ── Rule 16: At least one kaomoji per post (brand voice) ──
  // Strip code blocks before checking — kaomoji in code doesn't count
  const bodyNoCode = body
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`[^`\n]+`/g, ''); // inline code
  // Match parenthesized expressions containing distinctive kaomoji face characters
  // Broad kaomoji detection (synced with add-kaomoji.mjs)
  const KAOMOJI_PATTERN = /[（(][^)）\n]{0,40}[ω◕ᴗᗜ◍˃˂╥‿▽∀■□﹏ﾟ°⊙≧≦¬╯╮╰⌐・ˊˋ๑ㅂᵔᗒ˘ᴖ⤙◞◟⇀↼‶∇▿△ᐛ]/;
  if (filename !== 'demo.mdx' && filename !== 'en-demo.mdx' && !KAOMOJI_PATTERN.test(bodyNoCode)) {
    errors.push('Missing kaomoji — every gu-log post needs at least one (brand voice)');
  }

  // ── Rule 15: Filename includes date ──
  const dateInFilename = filename.match(/\d{8}/);
  if (!dateInFilename) {
    warnings.push('Filename does not contain a date (YYYYMMDD)');
  }

  // ── Rule 17: No raw ```mermaid code fences ──
  // Astro doesn't auto-render mermaid code fences — must use <Mermaid chart={...} /> component.
  // Match ```mermaid (with optional whitespace) that's NOT inside another code block example.
  const mermaidFencePattern = /^```mermaid\s*$/m;
  if (mermaidFencePattern.test(body)) {
    errors.push(
      'Raw ```mermaid code fence detected — use <Mermaid chart={`...`} /> component instead. ' +
        'See src/components/Mermaid.astro for usage.'
    );
  }

  return { filename, errors, warnings };
}

// ─── Duplicate Detection ────────────────────────────────────────────
/**
 * Load all active (non-deprecated) zh-tw articles for duplicate scanning.
 * Returns array of article metadata objects.
 */
function loadActiveZhTwArticles() {
  const allFiles = fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'));
  const articles = [];

  for (const file of allFiles) {
    const filePath = path.join(POSTS_DIR, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm || !fm.ticketId) continue;
    // Skip deprecated articles
    if (fm.status === 'deprecated') continue;
    // Only zh-tw (no en- prefix, already filtered above, but double-check lang)
    if (fm.lang && fm.lang !== 'zh-tw') continue;

    const sourceUrl = fm.sourceUrl ?? '';
    // Self-referential / placeholder URLs (e.g. SD originals that have no
    // external source) must NOT participate in URL match — otherwise every
    // SD post that lists `gu-log.vercel.app` as a placeholder source becomes
    // a "duplicate" of every other SD post.
    const isPlaceholderUrl =
      /\/\/(www\.)?gu-log\.vercel\.app\/?$/i.test(sourceUrl) || sourceUrl === '';
    const normalizedUrl = isPlaceholderUrl ? '' : normalizeUrl(sourceUrl);
    const tweetId = extractTweetId(sourceUrl);

    articles.push({
      file,
      ticketId: fm.ticketId,
      title: fm.title ?? '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      sourceUrl,
      normalizedUrl,
      tweetId,
      status: fm.status ?? 'active',
      seriesName: fm.series && typeof fm.series === 'object' ? (fm.series.name ?? '') : '',
      keywordText: `${fm.title ?? ''} ${fm.summary ?? ''} ${Array.isArray(fm.tags) ? fm.tags.join(' ') : ''}`,
    });
  }

  return articles;
}

/**
 * Run pairwise duplicate check across all active zh-tw articles.
 * Returns array of duplicate groups.
 *
 * NOTE: this bulk audit uses STRICTER thresholds than the new-article gate
 * (`scripts/dedup-gate.mjs`). When auditing existing published content, the
 * cost of a false positive is high (humans must triage 36 false alarms to
 * find 0 real ones), and the cost of a missed duplicate is low (the article
 * is already public). The single-candidate gate stays loose to catch
 * potential dupes for review at write time; this scan only flags pairs that
 * are corroborated on multiple signals.
 *
 *   URL match           → also requires title similarity ≥ 0.4 OR meaningful
 *                         English overlap ≥ 4. Without this, deliberate series
 *                         that share a sourceUrl (ECC SP-143…SP-153 from one
 *                         GitHub repo, batch-340 SP-60/61/62 from one digest)
 *                         all fire as false positives.
 *   Topic similarity    → score ≥ 0.5 AND overlap ≥ 4 (vs the single-candidate
 *                         gate's 0.3 / 2). At 0.30 with overlap 2, any two
 *                         articles that mention `claude-code` plus one other
 *                         token cross the line, which on a Claude-focused
 *                         blog is essentially every pair.
 */
const SCAN_TITLE_OVERLAP_REQUIRED = 0.4;
const SCAN_MIN_TITLE_EN_OVERLAP = 4;
const SCAN_TOPIC_REJECT_THRESHOLD = 0.5;
// At overlap=4, two articles sharing `claude-code` + `agent` + `ai` + one
// other token cross the line — basically every pair on a Claude-focused
// blog. Overlap ≥ 5 requires meaningfully more vocabulary in common, which
// is what we actually want to flag as a "same topic" pair.
const SCAN_TOPIC_MIN_EN_OVERLAP = 5;

// Series markers for title-based fallback detection. Catches multi-part
// articles that don't yet have `series.name` set in frontmatter.
const SERIES_MARKERS = [
  /[（(]\s*上\s*[）)]/, // （上）
  /[（(]\s*下\s*[）)]/, // （下）
  /[（(]\s*中\s*[）)]/, // （中）
  /系列\s*\d+\s*[/／]\s*\d+/, // 系列 1/2
  /[（(]\s*\d+\s*[/／]\s*\d+\s*[）)]/, // (1/2)
  /part\s*\d/i, // part 1, Part 2
];

function isMultiPartSeries(titleA, titleB) {
  const hasMarkerA = SERIES_MARKERS.some((re) => re.test(titleA));
  const hasMarkerB = SERIES_MARKERS.some((re) => re.test(titleB));
  return hasMarkerA && hasMarkerB;
}

function checkDuplicates() {
  const articles = loadActiveZhTwArticles();
  console.log(`\nScanning ${articles.length} active zh-tw articles for duplicates...\n`);

  // Build URL frequency map: URLs shared by 3+ articles are multi-article
  // sources (e.g., newsletter issues, podcast episode pages) — not duplicates.
  const urlCounts = new Map();
  for (const art of articles) {
    if (art.normalizedUrl) {
      urlCounts.set(art.normalizedUrl, (urlCounts.get(art.normalizedUrl) ?? 0) + 1);
    }
  }
  const multiArticleUrls = new Set(
    [...urlCounts.entries()].filter(([, count]) => count >= 3).map(([url]) => url)
  );
  if (multiArticleUrls.size > 0) {
    console.log(
      `  Detected ${multiArticleUrls.size} multi-article source URL(s) (3+ articles share URL, skipping URL dedup for these).\n`
    );
  }

  const groups = [];
  const alreadyGrouped = new Set();

  for (let i = 0; i < articles.length; i++) {
    if (alreadyGrouped.has(i)) continue;

    const a = articles[i];
    const group = { representative: a, duplicates: [] };

    for (let j = i + 1; j < articles.length; j++) {
      if (alreadyGrouped.has(j)) continue;

      const b = articles[j];
      let matchReason = null;
      let score = 0;

      // Series exemption (definitive): articles explicitly marked as part
      // of the same `series.name` are intentional multi-part coverage.
      if (a.seriesName && b.seriesName && a.seriesName === b.seriesName) {
        continue;
      }
      // Series exemption (fallback): title heuristic catches multi-part
      // articles that don't yet have `series.name` set in frontmatter
      // (e.g., "（上）" / "（下）", "Part 1" / "Part 2").
      if (isMultiPartSeries(a.title, b.title)) {
        continue;
      }

      // Layer 1: URL or tweet ID match — but only if titles also corroborate
      // and the URL isn't a known multi-article source. A series of articles
      // sharing one sourceUrl is not a duplicate.
      const isMultiArticleUrl = a.normalizedUrl && multiArticleUrls.has(a.normalizedUrl);
      const urlOrTweetMatch =
        !isMultiArticleUrl &&
        ((a.normalizedUrl && b.normalizedUrl && a.normalizedUrl === b.normalizedUrl) ||
          (a.tweetId && b.tweetId && a.tweetId === b.tweetId));

      if (urlOrTweetMatch) {
        const titleSim = computeSimilarity(a.title, b.title);
        if (
          titleSim.score >= SCAN_TITLE_OVERLAP_REQUIRED ||
          titleSim.enOverlap >= SCAN_MIN_TITLE_EN_OVERLAP
        ) {
          matchReason = `URL match + title corroboration (titleSim: ${titleSim.score.toFixed(3)}, overlap: ${titleSim.enOverlap})`;
          score = 1.0;
        }
      }

      // Layer 2: topic similarity — stricter for bulk audit.
      if (!matchReason) {
        // title-to-title (tight match)
        const titleSim = computeSimilarity(a.title, b.title);
        // full keyword text (broad match)
        const fullSim = computeSimilarity(a.keywordText, b.keywordText);
        const best = titleSim.score >= fullSim.score ? titleSim : fullSim;

        if (
          best.score >= SCAN_TOPIC_REJECT_THRESHOLD &&
          best.enOverlap >= SCAN_TOPIC_MIN_EN_OVERLAP
        ) {
          matchReason = `topic similarity (score: ${best.score.toFixed(3)}, overlap: ${best.enOverlap})`;
          score = best.score;
        } else if (best.score >= FLAG_THRESHOLD) {
          matchReason = `topic similarity WARN (score: ${best.score.toFixed(3)})`;
          score = best.score;
        }
      }

      // Only hard-block matches count as duplicates (URL+title corroboration or BLOCK-level similarity)
      // WARN-level similarity is advisory and does not fail the check
      const isHardBlock = matchReason !== null && !matchReason.startsWith('topic similarity WARN');
      if (isHardBlock) {
        group.duplicates.push({ article: b, reason: matchReason, score });
        alreadyGrouped.add(j);
      }
    }

    if (group.duplicates.length > 0) {
      alreadyGrouped.add(i);
      groups.push(group);
    }
  }

  // Report
  let activeGroupCount = 0;

  if (groups.length === 0) {
    console.log('  No duplicates found.\n');
  } else {
    for (const { representative, duplicates } of groups) {
      const allActive = duplicates.every((d) => d.article.status !== 'deprecated');
      const hasActiveDup = duplicates.some((d) => d.article.status !== 'deprecated');

      if (hasActiveDup) {
        activeGroupCount++;
        console.log(`  [ACTIVE DUPLICATE GROUP]`);
      } else {
        console.log(`  [already deprecated]`);
      }

      console.log(`    Base:  ${representative.ticketId} — ${representative.file}`);
      console.log(`           "${representative.title}"`);
      console.log(`           status: ${representative.status || 'active'}`);

      for (const { article, reason } of duplicates) {
        console.log(`    Dup:   ${article.ticketId} — ${article.file}`);
        console.log(`           "${article.title}"`);
        console.log(`           status: ${article.status || 'active'}, reason: ${reason}`);
      }
      console.log('');
    }
  }

  const totalGroups = groups.length;
  console.log(
    `Summary: ${totalGroups} duplicate group(s) found, ${activeGroupCount} with active (non-deprecated) duplicates.\n`
  );

  if (activeGroupCount > 0) {
    console.log(
      `FAILED: ${activeGroupCount} active duplicate group(s) detected. Deprecate or remove duplicates before merging.`
    );
    process.exit(1);
  } else {
    console.log('PASSED: No active duplicates found.');
    process.exit(0);
  }
}

// ─── Main ──────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  // --check-duplicates mode: scan all published articles for URL/topic dupes
  if (args.includes('--check-duplicates')) {
    checkDuplicates();
    return; // checkDuplicates() calls process.exit()
  }

  // Load all posts for cross-file checks
  const allFiles = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
  const allPosts = allFiles.map((f) => {
    const content = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8');
    const fm = parseFrontmatter(content);
    return { filename: f, ticketId: fm?.ticketId || '' };
  });

  // Determine which files to validate
  let filesToValidate;
  if (args.length > 0) {
    filesToValidate = args.map((f) => {
      // Accept both full path and just filename
      if (fs.existsSync(f)) return f;
      const fullPath = path.join(POSTS_DIR, path.basename(f));
      if (fs.existsSync(fullPath)) return fullPath;
      console.error(`❌ File not found: ${f}`);
      process.exit(1);
    });
  } else {
    filesToValidate = allFiles.map((f) => path.join(POSTS_DIR, f));
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filepath of filesToValidate) {
    const result = validatePost(filepath, allPosts);

    if (result.errors.length > 0 || result.warnings.length > 0) {
      console.log(`\n📄 ${result.filename}`);

      for (const err of result.errors) {
        console.log(`  ❌ ${err}`);
        totalErrors++;
      }
      for (const warn of result.warnings) {
        console.log(`  ⚠️  ${warn}`);
        totalWarnings++;
      }
    }
  }

  console.log('');
  if (totalErrors > 0) {
    console.log(
      `❌ FAILED: ${totalErrors} error(s), ${totalWarnings} warning(s) in ${filesToValidate.length} file(s)`
    );
    process.exit(1);
  } else {
    console.log(
      `✓ PASSED: ${filesToValidate.length} file(s) validated, ${totalWarnings} warning(s)`
    );
    process.exit(0);
  }
}

main();
