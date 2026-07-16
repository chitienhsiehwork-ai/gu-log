#!/usr/bin/env node
/**
 * allocate-ticket.mjs — swap a PENDING post's ticketId for a real number at the
 * last moment, then bump the counter. No git, no build, no push.
 *
 * This is the manual / CCC counterpart to `gp-pipeline deploy`'s allocation
 * step. The pipeline's deploy command also commits, builds, and pushes in one
 * shot, which couples "allocate a number" with "finalize and ship." When you
 * write a post by hand (or in a sandbox where the full pipeline can't run) and
 * want to keep the PENDING placeholder all the way through commit + PR + CI,
 * then allocate the real number as the very last step before merge, this is the
 * one command that does exactly — and only — the swap:
 *
 *   1. Find the PENDING zh-tw post (+ its en- companion) for the prefix
 *   2. Read scripts/article-counter.json -> next number N for that prefix
 *   3. Rewrite `<PREFIX>-PENDING` -> `<PREFIX>-N` in both files' frontmatter
 *   4. Rename `<prefix>-pending-<rest>.mdx` -> `<prefix>-<N>-<rest>.mdx`
 *      (the date + slug you chose are preserved verbatim)
 *   5. Bump the counter (next -> N + 1)
 *   6. Run validate-posts.mjs on the renamed files
 *
 * Committing, building, and pushing stay in your hands (or the PR flow), so the
 * allocation lands as its own atomic "swap PENDING -> GP-N" commit right before
 * merge — exactly when the counter is freshest.
 *
 * Usage:
 *   node scripts/allocate-ticket.mjs [slug-or-prefix] [--dry-run]
 *
 *   # auto-detect: exactly one PENDING pair in the repo
 *   node scripts/allocate-ticket.mjs
 *
 *   # disambiguate by prefix when several prefixes have pending drafts
 *   node scripts/allocate-ticket.mjs GP
 *
 *   # disambiguate by slug substring when one prefix has several pending drafts
 *   node scripts/allocate-ticket.mjs polished-ui-rules
 *
 *   # preview the swap without touching anything
 *   node scripts/allocate-ticket.mjs GP --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src', 'content', 'posts');
const COUNTER_FILE = path.join(REPO_ROOT, 'scripts', 'article-counter.json');

const VALID_PREFIXES = ['GP', 'MP', 'SD', 'Lv'];
const PENDING_RE = /^(en-)?(gp|mp|sd|lv)-pending-(.+)\.mdx$/i;
const LEGACY_PENDING_RE = /^(?:en-)?(sp|cp)-pending-.+\.mdx$/i;
const PREFIX_BY_SLUG = new Map([
  ['gp', 'GP'],
  ['mp', 'MP'],
  ['sd', 'SD'],
  ['lv', 'Lv'],
]);

function canonicalPrefix(value) {
  return VALID_PREFIXES.find((prefix) => prefix.toLowerCase() === value.toLowerCase()) ?? null;
}

/** Find every PENDING post pair under src/content/posts. */
function findPendingPairs() {
  const allFiles = fs.readdirSync(POSTS_DIR);
  const legacy = allFiles.filter((f) => LEGACY_PENDING_RE.test(f));
  if (legacy.length > 0) {
    const hints = legacy.map((file) => {
      const replacement = file.replace(/^(en-)?sp-/i, '$1gp-').replace(/^(en-)?cp-/i, '$1mp-');
      return `  - ${file} (rename to ${replacement})`;
    });
    throw new Error(`Retired SP/CP pending filename(s) found:\n${hints.join('\n')}`);
  }
  const files = allFiles.filter((f) => PENDING_RE.test(f));
  // Group by base name (strip the en- prefix) so a zh-tw post and its English
  // companion travel together.
  const byBase = new Map();
  for (const f of files) {
    const base = f.startsWith('en-') ? f.slice(3) : f;
    if (!byBase.has(base)) byBase.set(base, { base, zh: null, en: null });
    const entry = byBase.get(base);
    if (f.startsWith('en-')) entry.en = f;
    else entry.zh = f;
  }
  return [...byBase.values()].map((entry) => {
    const m = entry.base.match(PENDING_RE);
    return { ...entry, prefix: PREFIX_BY_SLUG.get(m[2].toLowerCase()), rest: m[3] };
  });
}

/** Pick the single target pair, using an optional prefix/slug filter. */
function selectPair(pairs, filter) {
  let candidates = pairs;
  if (filter) {
    const upper = filter.toUpperCase();
    if (upper === 'SP' || upper === 'CP') {
      const replacement = upper === 'SP' ? 'GP' : 'MP';
      throw new Error(`Retired prefix ${upper}; use ${replacement}`);
    }
    const prefix = canonicalPrefix(filter);
    if (prefix) {
      candidates = pairs.filter((p) => p.prefix === prefix);
    } else {
      candidates = pairs.filter((p) => p.base.includes(filter));
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      filter
        ? `No PENDING post matches "${filter}".`
        : 'No PENDING posts found under src/content/posts.'
    );
  }
  if (candidates.length > 1) {
    const list = candidates.map((p) => `  - ${p.base}`).join('\n');
    throw new Error(
      `Ambiguous: ${candidates.length} PENDING posts match. Disambiguate by prefix or slug:\n${list}`
    );
  }
  return candidates[0];
}

function readCounter() {
  const counter = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
  validateCounter(counter);
  return counter;
}

function validateCounter(counter) {
  const keys = Object.keys(counter);
  for (const legacy of ['SP', 'CP']) {
    if (keys.includes(legacy)) {
      throw new Error(
        `Counter contains retired prefix ${legacy}; use ${legacy === 'SP' ? 'GP' : 'MP'}`
      );
    }
  }
  const unknown = keys.filter((key) => !VALID_PREFIXES.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Counter contains unsupported prefix(es): ${unknown.join(', ')}`);
  }
  const missing = VALID_PREFIXES.filter((prefix) => !keys.includes(prefix));
  if (missing.length > 0) {
    throw new Error(`Counter is missing required prefix(es): ${missing.join(', ')}`);
  }
}

function writeCounter(counter) {
  fs.writeFileSync(COUNTER_FILE, `${JSON.stringify(counter, null, 2)}\n`);
}

/** Swap the ticketId in a file's frontmatter, in place. */
function swapTicketId(absPath, prefix, n) {
  const content = fs.readFileSync(absPath, 'utf8');
  const swapped = content.replace(
    new RegExp(`(["']?)${prefix}-PENDING\\1`, 'g'),
    `$1${prefix}-${n}$1`
  );
  if (swapped === content) {
    throw new Error(`No ${prefix}-PENDING ticketId found in ${path.basename(absPath)}`);
  }
  fs.writeFileSync(absPath, swapped);
}

function allocate({ filter, dryRun }) {
  const pairs = findPendingPairs();
  const pair = selectPair(pairs, filter);
  const { prefix } = pair;

  const counter = readCounter();
  if (!counter[prefix] || typeof counter[prefix].next !== 'number') {
    throw new Error(`Counter has no numeric "next" for prefix ${prefix}`);
  }
  const n = counter[prefix].next;

  const plan = [];
  for (const which of ['zh', 'en']) {
    const fname = pair[which];
    if (!fname) continue;
    const newName = fname.replace(/-pending-/i, `-${n}-`);
    plan.push({ which, oldName: fname, newName });
  }

  const oldTicket = `${prefix}-PENDING`;
  const newTicket = `${prefix}-${n}`;

  process.stdout.write(`Allocating ${oldTicket} -> ${newTicket}\n`);
  for (const step of plan) {
    process.stdout.write(`  ${step.oldName}\n    -> ${step.newName}\n`);
  }
  process.stdout.write(`  counter: ${prefix}.next ${n} -> ${n + 1}\n`);

  if (dryRun) {
    process.stdout.write('\n[dry-run] nothing written.\n');
    return { ticketId: newTicket, files: plan.map((s) => s.newName) };
  }

  // Swap ticketIds first (on the old paths), then rename the files.
  for (const step of plan) {
    swapTicketId(path.join(POSTS_DIR, step.oldName), prefix, n);
  }
  for (const step of plan) {
    fs.renameSync(path.join(POSTS_DIR, step.oldName), path.join(POSTS_DIR, step.newName));
  }

  counter[prefix].next = n + 1;
  writeCounter(counter);

  // Validate the renamed files so a bad swap fails loudly here, not in CI.
  const newPaths = plan.map((s) => path.join(POSTS_DIR, s.newName));
  execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'validate-posts.mjs'), ...newPaths], {
    stdio: 'inherit',
  });

  process.stdout.write(
    `\n✓ Allocated ${newTicket}. Stage the renamed files + scripts/article-counter.json, commit, and merge.\n`
  );
  return { ticketId: newTicket, files: plan.map((s) => s.newName) };
}

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

if (__isCli) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filter = args.find((a) => !a.startsWith('--'));
  try {
    allocate({ filter, dryRun });
  } catch (err) {
    process.stderr.write(`✗ ${err.message}\n`);
    process.exit(1);
  }
}

export { findPendingPairs, selectPair, allocate, canonicalPrefix, validateCounter };
