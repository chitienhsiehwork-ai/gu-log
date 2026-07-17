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
import { fileURLToPath, pathToFileURL } from 'url';
import { normalizeUrl, extractTweetId, computeSimilarity, FLAG_THRESHOLD } from './dedup-gate.mjs';
import { loadPostMap, findMissingPairs, reminderText } from './check-translation-pairs.mjs';
import { MODEL_MAP } from './detect-model.mjs';

// Claude's 5-generation models (Sonnet 5, Fable 5, ...) ship as whole-number
// release names with no minor version, unlike the 4.x Opus/Sonnet line. Rule
// 15 below still wants to block genuinely incomplete names (e.g. "Opus 4"),
// so treat every display name already known to detect-model.mjs's MODEL_MAP
// as complete on its own — adding a model there is enough to make it valid
// frontmatter, no regex edit needed here.
const KNOWN_MODEL_DISPLAY_NAMES = new Set(Object.values(MODEL_MAP).map((n) => n.toLowerCase()));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');
const _COUNTER_FILE = path.join(__dirname, 'article-counter.json');

// ─── Config ────────────────────────────────────────────────────────
const _VALID_PREFIXES = ['GP', 'MP', 'SD', 'Lv'];
const VALID_LANGS = ['zh-tw', 'en'];
// PENDING is a legitimate in-flight ticket state used by the gp-pipeline
// and by manual drafters working on parallel branches. The deploy step
// swaps PENDING for a real number allocated from article-counter.json at
// the last moment (see CONTRIBUTING.md §並行撰寫防 ID collision).
const TICKET_PATTERN = /^(GP|MP|SD|Lv)-(?:\d+|PENDING)$/;
const RETIRED_TICKET_PATTERN = /^(SP|CP)-(\d+|PENDING)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /^https?:\/\/.+/;
const MIN_CONTENT_LENGTH = 200; // characters, excluding frontmatter
const REDUNDANT_BOTTOM_CITATION_PATTERNS = [
  /\n---\s*\n+\*\*原文來源[：:]\*\*/,
  /\n---\s*\n+\*\*Original source[：:]\*\*/i,
  /\n---\s*\n+\*\*Source[：:]\*\*/i,
  /\n##\s*原文出處/,
];
const MOGU_NOTE_REDUNDANT_PREFIX = [
  /<MoguNote\b[^>]*>\s*\n?\s*\*\*Mogu[：:]\*\*/i,
  /<MoguNote\b[^>]*>\s*\n?\s*Mogu[：:]\s/i,
];
const LONG_MOGU_NOTE_CHARS = 420;
const MAX_MOGU_NOTE_SUMMARY_CHARS = 120;
const RETIRED_SERIES_TAGS = new Set([
  'clawd-picks',
  'mogu-picks',
  'shroom-picks',
  'shroomdog-picks',
  'gu-log-picks',
]);
// CJK Unified Ideograph guard for en-*.mdx bodies (Rule 19). `\p{Unified_Ideograph}`
// is the CJK Unified Ideographs block only — kaomoji-adjacent scripts like
// katakana (ツ) or Greek (ω) are outside it and never trip this rule.
// Known limitation: this only scans MDX source text, so it cannot catch
// hardcoded user-visible strings baked into .astro components.
const CJK_UNIFIED_IDEOGRAPH_PATTERN = /\p{Unified_Ideograph}/gu;
// MDX requires {/* */} comments; HTML <!-- --> breaks the build.
const CJK_ESCAPE_MARKERS = ['{/* cjk-ok */}', '<!-- cjk-ok -->'];
const containsCjkEscape = (line) => CJK_ESCAPE_MARKERS.some((m) => line.includes(m));
// Grandfather baseline: en-* CJK Unified Ideograph lines that already existed
// when Rule 19 shipped (GP-251 uiux fix task, 2026-07-06), so the guard
// shipped CI-green without a mass content-editing PR. All 14 original entries
// have since been resolved — 11 legitimate citations/kaomoji got explicit
// `cjk-ok` escapes, and the three-line English GP-193 translation bug got
// retranslated
// (fix/en-gp-193-untranslated-comments) — so this baseline is empty. Keep the
// Map (and this comment) as the burn-down mechanism for the next time a
// mass-adoption PR needs to ship CI-green before every line is fixed: add an
// entry, downgrade it to a warning, and delete the entry once resolved.
//
// Keyed by exact trimmed line text (not line number) so unrelated edits
// elsewhere in the file — which shift line numbers — don't silently drop a
// line out of the baseline or let a false match through. Only editing the
// flagged line itself invalidates its baseline entry, which is the correct
// trigger to revisit it.
const CJK_GRANDFATHERED_LINES = new Map([]);

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

function getFrontmatterText(content) {
  return content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
}

function retiredTicketDiagnostic(value) {
  const match = value.match(RETIRED_TICKET_PATTERN);
  if (!match) return null;
  const replacement = match[1] === 'SP' ? 'GP' : 'MP';
  return `Retired ticket reference ${value}; use ${replacement}-${match[2]}`;
}

/**
 * Find retired ticket IDs only in reference-bearing frontmatter fields. This
 * avoids treating a factual mention in a title or source attribution as a
 * schema reference while still handling inline and block YAML arrays.
 */
function findRetiredTicketReferences(fmText) {
  const references = [];
  const lines = fmText.split('\n');
  let inAcknowledgedOverlap = false;
  let overlapIndent = 0;

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const fieldMatch = line.match(/^\s*(deprecatedBy|acknowledgedOverlapWith):\s*(.*)$/);
    if (fieldMatch) {
      inAcknowledgedOverlap = fieldMatch[1] === 'acknowledgedOverlapWith';
      overlapIndent = indent;
      references.push(...(fieldMatch[2].match(/\b(?:SP|CP)-(?:\d+|PENDING)\b/g) ?? []));
      continue;
    }

    if (inAcknowledgedOverlap) {
      if (line.trim() && indent <= overlapIndent) {
        inAcknowledgedOverlap = false;
        continue;
      }
      references.push(...(line.match(/\b(?:SP|CP)-(?:\d+|PENDING)\b/g) ?? []));
    }
  }

  return [...new Set(references)];
}

// Strip markup tags to a fixpoint so nested fragments (e.g. `<scr<x>ipt`)
// cannot survive a single-pass replace; output is only used for counting.
function stripMarkupTags(text) {
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text;
}

function getScoreBlock(fmText, judge) {
  const lines = fmText.split('\n');
  const start = lines.findIndex((line) => line === `  ${judge}:`);
  if (start === -1) return '';

  const blockLines = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith('    ')) break;
    blockLines.push(line);
  }
  return blockLines.join('\n');
}

function validateScoreBlock(fmText, judge, dimensions) {
  const errors = [];
  const block = getScoreBlock(fmText, judge);
  if (!block) {
    return [`Missing scores.${judge} block`];
  }

  for (const dim of dimensions) {
    if (!new RegExp(`^ {4}${dim}:\\s*(?:10|[0-9])\\s*$`, 'm').test(block)) {
      errors.push(`scores.${judge}.${dim} must be an integer 0-10`);
    }
  }
  if (!/^ {4}score:\s*(?:10|[0-9])\s*$/m.test(block)) {
    errors.push(`scores.${judge}.score must be an integer 0-10`);
  }
  if (!/^ {4}date:\s*"\d{4}-\d{2}-\d{2}"\s*$/m.test(block)) {
    errors.push(`scores.${judge}.date must be quoted YYYY-MM-DD`);
  }
  if (!/^ {4}model:\s*"[^"]+"\s*$/m.test(block)) {
    errors.push(`scores.${judge}.model is required`);
  }
  return errors;
}

function extractMoguNotes(content) {
  const notes = [];
  const pattern = /<MoguNote\b([^>]*)>([\s\S]*?)<\/MoguNote>/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    const summaryMatch =
      attrs.match(/\bsummary\s*=\s*"([^"]*)"/) ??
      attrs.match(/\bsummary\s*=\s*'([^']*)'/) ??
      attrs.match(/\bsummary\s*=\s*\{`([^`]*)`\}/) ??
      attrs.match(/\bsummary\s*=\s*\{"([^"]*)"\}/) ??
      attrs.match(/\bsummary\s*=\s*\{'([^']*)'\}/);

    const text = stripMarkupTags(
      inner.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '')
    ).replace(/\s+/g, '');

    notes.push({
      index: notes.length + 1,
      length: text.length,
      hasSummary: Boolean(summaryMatch?.[1]?.trim()),
      summaryLength: summaryMatch?.[1]?.trim().length ?? 0,
    });
  }

  return notes;
}

// ─── Validation Rules ──────────────────────────────────────────────
function validatePost(filepath, allPosts, options = {}) {
  const filename = path.basename(filepath);
  const content = fs.readFileSync(filepath, 'utf-8');
  const fm = parseFrontmatter(content);
  const fmText = getFrontmatterText(content);
  const body = getContentBody(content);
  const errors = [];
  const warnings = [];

  // ── Rule 1: Frontmatter exists ──
  if (!fm) {
    errors.push('Missing or malformed frontmatter (--- block)');
    return { filename, errors, warnings };
  }

  // ── Rule 2: Required fields ──
  const required = [
    'title',
    'originalDate',
    'translatedDate',
    'source',
    'sourceUrl',
    'summary',
    'lang',
  ];
  for (const field of required) {
    if (!fm[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // ── Rule 3: ticketId present and valid format ──
  if (!fm.ticketId) {
    errors.push('Missing ticketId');
  } else if (!TICKET_PATTERN.test(fm.ticketId)) {
    const retiredDiagnostic = retiredTicketDiagnostic(fm.ticketId);
    errors.push(
      retiredDiagnostic ??
        `Invalid ticketId format: "${fm.ticketId}" (expected GP-N, MP-N, SD-N, or Lv-N)`
    );
  }

  for (const reference of findRetiredTicketReferences(fmText)) {
    errors.push(retiredTicketDiagnostic(reference));
  }

  // GP/MP ticket identity and filename identity are one contract. The en-
  // locale prefix is transport-only and is removed before comparing.
  const gpMpTicket = fm.ticketId?.match(/^(GP|MP)-(\d+|PENDING)$/);
  if (gpMpTicket) {
    const expectedPrefix = `${gpMpTicket[1].toLowerCase()}-${gpMpTicket[2].toLowerCase()}-`;
    const baseFilename = getBaseFilename(filename).toLowerCase();
    if (!baseFilename.startsWith(expectedPrefix)) {
      errors.push(
        `GP/MP filename must match ticketId ${fm.ticketId}; expected filename starting with "${expectedPrefix}"`
      );
    }
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
  } else if (Array.isArray(fm.tags)) {
    for (const tag of fm.tags) {
      if (RETIRED_SERIES_TAGS.has(tag)) {
        errors.push(
          `Retired series tag "${tag}" is not allowed; series identity comes from ticketId`
        );
      }
    }
  }

  if (/^\s+clawdNote\s*:/m.test(fmText)) {
    errors.push('Retired score key clawdNote; use moguNote');
  }
  if (/\bClawdNote\b/.test(body)) {
    errors.push('Retired ClawdNote component/import; use MoguNote');
  }

  // ── Rule 8: No duplicate bottom citations ──
  for (const pattern of REDUNDANT_BOTTOM_CITATION_PATTERNS) {
    if (pattern.test(content)) {
      errors.push('Redundant bottom citation found (source is already shown at top by layout)');
      break;
    }
  }

  // ── Rule 9: MoguNote no redundant prefix ──
  for (const pattern of MOGU_NOTE_REDUNDANT_PREFIX) {
    if (pattern.test(content)) {
      errors.push('MoguNote contains redundant "Mogu:" prefix (component auto-adds it)');
      break;
    }
  }

  // ── Rule 10: Long MoguNote requires writer-authored summary ──
  if (options.enforceLongMoguNoteSummary) {
    for (const note of extractMoguNotes(content)) {
      if (note.length > LONG_MOGU_NOTE_CHARS && !note.hasSummary) {
        errors.push(
          `MoguNote #${note.index} is long (${note.length} chars) and needs summary="短版一句話"`
        );
      }
      if (note.summaryLength > MAX_MOGU_NOTE_SUMMARY_CHARS) {
        errors.push(
          `MoguNote #${note.index} summary is too long (${note.summaryLength} chars, max ${MAX_MOGU_NOTE_SUMMARY_CHARS})`
        );
      }
    }
  }

  // ── Rule 11: Minimum content length ──
  // Strip imports and component tags for length check
  const cleanBody = stripMarkupTags(body.replace(/^import\s+.*$/gm, '')).trim();
  if (cleanBody.length < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short (${cleanBody.length} chars, minimum ${MIN_CONTENT_LENGTH})`);
  }

  // ── Rule 12: summary not too long (for index page) ──
  if (fm.summary && fm.summary.length > 300) {
    warnings.push(`summary is ${fm.summary.length} chars (recommend ≤300 for index page)`);
  }

  // ── Rule 13: ticketId uniqueness (cross-file check) ──
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

  // ── Rule 14: Translation pair ticketId consistency ──
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

  // ── Rule 14.5: model signature (translatedBy) is mandatory for every post ──
  // Translations (GP/MP) render it as "translated by"; originals (SD/Lv) as
  // "written by". Either way, readers must see which model produced the post.
  if (!fm.translatedBy) {
    errors.push('Missing translatedBy (model signature) — every post needs model + harness');
  } else {
    if (!fm.translatedBy.model) {
      errors.push('translatedBy.model is required (model signature)');
    }
    if (!fm.translatedBy.harness) {
      errors.push('translatedBy.harness is required (model signature)');
    }
  }

  // ── Rule 15: translatedBy.model must have version number ──
  if (fm.translatedBy?.model) {
    const model = fm.translatedBy.model;
    // Must contain a version number (e.g., "Opus 4.6", "Sonnet 4.5", "Gemini 3 Pro")
    // or be a known whole-number release name (e.g. "Sonnet 5", "Fable 5").
    if (
      !/\d+\.\d+|\d+ Pro|\d+ Flash/i.test(model) &&
      !KNOWN_MODEL_DISPLAY_NAMES.has(model.trim().toLowerCase())
    ) {
      errors.push(
        `translatedBy.model "${model}" missing version — use full name like "Opus 4.6" (run: node scripts/detect-model.mjs <model-id>)`
      );
    }
  }

  // ── Rule 15: Tribunal score completeness ──
  // Version-aware dimension ownership (move-clarity-vibe-to-fresheyes):
  //   tribunalVersion >= 9 → Vibe is 4 dims (no clarity); Fresh Eyes is 5 dims
  //                          (clarity moved here as a hard gate).
  //   tribunalVersion <= 8 → legacy: Vibe 5 dims (with clarity); FreshEyes 4.
  // Without this branch a correctly-stamped v9 post (clarity under freshEyes,
  // absent from vibe) is REJECTED at pre-commit/CI — a hard blocker.
  const hasTribunalScores = /^ {2}(?:tribunalVersion|librarian|factCheck|freshEyes|vibe):/m.test(
    fmText
  );
  const tribunalVersionMatch = fmText.match(/^ {2}tribunalVersion:\s*(\d+)/m);
  const tribunalVersion = Number(tribunalVersionMatch?.[1] ?? 8);
  const VIBE_DIMS_V8 = ['persona', 'moguNote', 'vibe', 'clarity', 'narrative'];
  const VIBE_DIMS_V9 = ['persona', 'moguNote', 'vibe', 'narrative'];
  const FRESH_DIMS_V8 = ['readability', 'firstImpression', 'payoffDensity', 'lengthFit'];
  const FRESH_DIMS_V9 = ['readability', 'firstImpression', 'payoffDensity', 'lengthFit', 'clarity'];
  const vibeDims = tribunalVersion >= 9 ? VIBE_DIMS_V9 : VIBE_DIMS_V8;
  const freshDims = tribunalVersion >= 9 ? FRESH_DIMS_V9 : FRESH_DIMS_V8;
  // VALIDATE_PARTIAL_SCORES=1: mid-tribunal mode for cheap validation in
  // scripts/tribunal.sh — writer rewrites happen BEFORE later stages have
  // scored, so requiring all four blocks here is a guaranteed failure.
  // Relaxes ONLY block *presence*; any block that exists is still fully
  // structure-checked. Deploy / pre-commit / CI never set this, so the
  // final gate stays strict.
  const partialScores = process.env.VALIDATE_PARTIAL_SCORES === '1';
  const requireOrSkipMissing = (scoreErrors) =>
    partialScores ? scoreErrors.filter((e) => !e.startsWith('Missing scores')) : scoreErrors;
  if (hasTribunalScores && tribunalVersionMatch && tribunalVersion >= 8) {
    errors.push(
      ...requireOrSkipMissing([
        ...validateScoreBlock(fmText, 'librarian', [
          'glossary',
          'crossRef',
          'sourceAlign',
          'attribution',
        ]),
        ...validateScoreBlock(fmText, 'factCheck', [
          'accuracy',
          'fidelity',
          'consistency',
          'sourceBoundary',
          'commentarySeparation',
        ]),
        ...validateScoreBlock(fmText, 'freshEyes', freshDims),
        ...validateScoreBlock(fmText, 'vibe', vibeDims),
      ])
    );
  } else if (fm.ticketId?.startsWith('SD-')) {
    if (!partialScores && !/^scores:\s*$/m.test(fmText)) {
      errors.push('Missing scores block — every SD post needs freshEyes + vibe scores');
    }
    errors.push(
      ...requireOrSkipMissing([
        ...validateScoreBlock(fmText, 'freshEyes', ['readability', 'firstImpression']),
        ...validateScoreBlock(fmText, 'vibe', vibeDims),
      ])
    );
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

  // ── Rule 17: Filename includes date ──
  const dateInFilename = filename.match(/\d{8}/);
  if (!dateInFilename) {
    warnings.push('Filename does not contain a date (YYYYMMDD)');
  }

  // ── Rule 18: No raw ```mermaid code fences ──
  // Astro doesn't auto-render mermaid code fences — must use <Mermaid chart={...} /> component.
  // Match ```mermaid (with optional whitespace) that's NOT inside another code block example.
  const mermaidFencePattern = /^```mermaid\s*$/m;
  if (mermaidFencePattern.test(body)) {
    errors.push(
      'Raw ```mermaid code fence detected — use <Mermaid chart={`...`} /> component instead. ' +
        'See src/components/Mermaid.astro for usage.'
    );
  }

  // ── Rule 19: en-*.mdx body must not contain CJK Unified Ideographs ──
  // Catches untranslated zh-tw leftovers in en posts. Legitimate cases (a
  // quoted Chinese name, a kaomoji with a real ideograph like 益) opt out with
  // a `<!-- cjk-ok -->` comment on the same line. A deliberately bilingual
  // *code example* opts out block-wide by putting the marker on the opening
  // ``` fence line instead — an inline comment on a code line would render
  // as literal garbage text in the published snippet. Frontmatter is exempt
  // (source/attribution fields legitimately carry original-language names).
  if (filename.startsWith('en-')) {
    const bodyStartOffset = content.length - body.length;
    const bodyStartLine = content.slice(0, bodyStartOffset).split('\n').length;
    let inEscapedFence = false;
    body.split('\n').forEach((line, idx) => {
      if (/^\s*```/.test(line)) {
        if (inEscapedFence) {
          inEscapedFence = false; // closing fence of an escaped block
        } else if (containsCjkEscape(line)) {
          inEscapedFence = true; // opening fence marked as escaped
        }
        return;
      }
      if (inEscapedFence || containsCjkEscape(line)) return;
      const matches = line.match(CJK_UNIFIED_IDEOGRAPH_PATTERN);
      if (matches) {
        const lineNo = bodyStartLine + idx;
        const chars = [...new Set(matches)].join('');
        if (CJK_GRANDFATHERED_LINES.get(filename)?.has(line.trim())) {
          warnings.push(
            `CJK Unified Ideograph "${chars}" at line ${lineNo} is grandfathered (pre-existing) — ` +
              'resolve it (escape or retranslate) and remove its entry from ' +
              'CJK_GRANDFATHERED_LINES in scripts/validate-posts.mjs'
          );
        } else {
          errors.push(
            `CJK Unified Ideograph "${chars}" found in en-* body at line ${lineNo} ` +
              `(intentional? add "{/* cjk-ok */}" on that line, or on the opening ` +
              '``` fence line to escape a whole code block, to allow it)'
          );
        }
      }
    });
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
 *                         that share a sourceUrl (ECC GP-143…GP-153 from one
 *                         GitHub repo, batch-340 GP-60/61/62 from one digest)
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

  const isFileListMode = args.length > 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filepath of filesToValidate) {
    const result = validatePost(filepath, allPosts, {
      enforceLongMoguNoteSummary: isFileListMode,
    });

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

  // ─── Translation pair nudge ─────────────────────────────────────
  // Gentle reminder only. In file-list mode (pre-commit) we list the
  // specific missing pairs for the staged files; in full-repo mode we
  // print a summary count to keep noise down. The hard gate lives in
  // CI (scripts/check-translation-pairs.mjs --strict --pr-base=…).
  const scope = isFileListMode
    ? new Set(
        filesToValidate.map((fp) => {
          const name = path.basename(fp);
          return name.startsWith('en-') ? name.slice(3) : name;
        })
      )
    : null;
  const missingPairs = findMissingPairs(loadPostMap(), scope);
  if (missingPairs.length > 0) {
    console.log('');
    console.log('📝 Translation pair reminder:');
    if (isFileListMode) {
      for (const m of missingPairs) {
        console.log(`   • ${m.ticketId} (${m.file}) — missing ${m.missingLang} version`);
      }
    } else {
      console.log(`   ${missingPairs.length} active post(s) missing their lang sidecar.`);
      console.log(`   Run: node scripts/check-translation-pairs.mjs  (full list)`);
    }
    console.log('');
    for (const line of reminderText().split('\n')) {
      console.log(`   ${line}`);
    }
    totalWarnings += missingPairs.length;
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

// Only run as CLI entry point (not when imported as a module for tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { parseFrontmatter, getBaseFilename, getContentBody, validatePost, CJK_GRANDFATHERED_LINES };
