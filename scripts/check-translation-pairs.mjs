#!/usr/bin/env node
/**
 * scripts/check-translation-pairs.mjs
 *
 * Ensures every SP/CP/SD/Lv ticketId has both a zh-tw and an en version
 * before merging to main.
 *
 * Modes:
 *   (default)           warn-only, scans entire repo, exit 0
 *   --strict            exit 1 on missing pair (CI ship-gate)
 *   --pr-base=<ref>     restrict scope to files newly added vs <ref>
 *                       (so the 52-post zh-only backlog doesn't block
 *                        PRs that don't touch those posts)
 *
 * Design note: this gate intentionally does NOT run in pre-commit.
 * CONTRIBUTING.md §zh-tw 優先 SOP says the en version is derived only
 * after the zh-tw version passes vibe iteration — so the repo is
 * expected to contain zh-only drafts during iteration. Blocking every
 * zh-only commit would break the SOP. The warn fires at validate time
 * (see validate-posts.mjs integration), the strict gate fires at PR
 * CI time.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

// Every series that gu-log ships in both languages. Matches the
// "每篇文章同時產出 zh-tw 和 en 版" claim in CLAUDE.md.
const PAIRED_PREFIXES = ['SP', 'CP', 'SD', 'Lv'];

function parseTicketId(content) {
  const m = content.match(/ticketId:\s*["']?([A-Za-z]+-[A-Za-z0-9]+)["']?/);
  return m ? m[1] : null;
}

function parseStatus(content) {
  const m = content.match(/status:\s*["']?([a-z]+)["']?/);
  return m ? m[1] : 'published';
}

/**
 * Group all mdx posts by base filename. zh-tw "foo.mdx" and en
 * "en-foo.mdx" become one entry keyed on "foo.mdx".
 */
export function loadPostMap() {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
  const byBase = new Map();
  for (const f of files) {
    const isEn = f.startsWith('en-');
    const base = isEn ? f.slice(3) : f;
    const content = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8');
    const ticketId = parseTicketId(content);
    const status = parseStatus(content);
    const entry = byBase.get(base) || {
      zh: null,
      en: null,
      ticketId: null,
      status: 'published',
    };
    if (isEn) {
      entry.en = f;
    } else {
      entry.zh = f;
      entry.ticketId = ticketId;
      entry.status = status;
    }
    byBase.set(base, entry);
  }
  return byBase;
}

/**
 * Find posts missing their language sidecar.
 * @param {Map} byBase       — output of loadPostMap()
 * @param {Set<string>} scope — optional: restrict to these base filenames
 * @returns {Array<{ticketId, file, missingLang}>}
 */
export function findMissingPairs(byBase, scope = null) {
  const missing = [];
  for (const [base, entry] of byBase) {
    if (!entry.ticketId) continue;
    const prefix = entry.ticketId.split('-')[0];
    if (!PAIRED_PREFIXES.includes(prefix)) continue;
    if (entry.status === 'deprecated' || entry.status === 'retired') continue;
    if (entry.ticketId.endsWith('-PENDING')) continue;
    if (scope && !scope.has(base)) continue;
    if (entry.zh && !entry.en) {
      missing.push({ ticketId: entry.ticketId, file: entry.zh, missingLang: 'en' });
    } else if (entry.en && !entry.zh) {
      missing.push({ ticketId: entry.ticketId, file: entry.en, missingLang: 'zh-tw' });
    }
  }
  return missing;
}

export function reminderText() {
  return [
    'Reminder: every SP/CP/SD/Lv post needs both zh-tw and en versions',
    'before merging. Per CONTRIBUTING.md §zh-tw 優先 SOP, translate to en',
    'only AFTER zh-tw passes vibe iteration — not in parallel.',
  ].join('\n');
}

function gitDiffAddedVsBase(baseRef) {
  const tryRef = (ref) => {
    try {
      const out = execSync(
        `git diff --name-only --diff-filter=A ${ref}...HEAD -- 'src/content/posts/*.mdx'`,
        { encoding: 'utf-8' }
      );
      return out.split('\n').filter(Boolean);
    } catch {
      return null;
    }
  };
  return tryRef(`origin/${baseRef}`) ?? tryRef(baseRef) ?? [];
}

function toBaseSet(addedFiles) {
  const set = new Set();
  for (const f of addedFiles) {
    const name = path.basename(f);
    set.add(name.startsWith('en-') ? name.slice(3) : name);
  }
  return set;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const prBase = args.find((a) => a.startsWith('--pr-base='))?.split('=')[1];

  const byBase = loadPostMap();

  let scope = null;
  if (prBase) {
    const added = gitDiffAddedVsBase(prBase);
    if (added.length === 0) {
      console.log(`✓ No new posts in this PR vs ${prBase} — translation pair gate skipped`);
      process.exit(0);
    }
    scope = toBaseSet(added);
  }

  const missing = findMissingPairs(byBase, scope);

  if (missing.length === 0) {
    const scopeLabel = scope
      ? `${scope.size} new post(s) in this PR have`
      : 'all active posts have';
    console.log(`✓ ${scopeLabel} both zh-tw + en versions`);
    process.exit(0);
  }

  const icon = strict ? '❌' : '⚠️ ';
  const label = strict ? 'MISSING TRANSLATION PAIR' : 'Translation pair reminder';
  console.log('');
  console.log(`${icon} ${label} (${missing.length}):`);
  for (const m of missing) {
    console.log(`  • ${m.ticketId} — ${m.file} (missing ${m.missingLang} version)`);
  }
  console.log('');
  console.log(reminderText());
  console.log('');
  process.exit(strict ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
