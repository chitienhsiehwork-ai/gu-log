#!/usr/bin/env node
/**
 * check-kaomoji-unbreakable
 *
 * Guards that kaomoji never split across a line break (see the prod bug where
 * `w(ﾟДﾟ)w` wrapped mid-face). The actual protection lives in
 * src/plugins/remark-kaomoji-nowrap.mjs (it interleaves Word Joiners at build);
 * this gate locks that protection so a regression — or a new kaomoji whose
 * glyphs the plugin doesn't recognise — is caught in CI + pre-commit instead of
 * shipping breakable.
 *
 * HARD failures (exit 1):
 *   1. A curated corpus kaomoji is not detected/protected (regression lock).
 *   2. A kaomoji the plugin DOES detect in a post still has a break opportunity
 *      after protection (plugin output sanity).
 *   3. A negative (ordinary parenthetical) gets wrongly modified.
 *
 * WARN (non-blocking): a bracketed group in a post that contains a kana /
 * halfwidth signal and stays breakable after protection — a *possible* missed
 * kaomoji. Not a hard fail because real Japanese parentheticals would false-
 * positive; when a warning is a genuine kaomoji, add its glyph to the plugin's
 * KAOMOJI_CHARS and its face to CORPUS below, which promotes it to a hard lock.
 *
 * Usage: node scripts/check-kaomoji-unbreakable.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { protectKaomoji, hasBreakOpportunity } from '../src/plugins/remark-kaomoji-nowrap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const postsDir = resolve(here, '../src/content/posts');

// Curated set: the writer-prompt recommended list + faces actually used across
// posts + every reported breakage. Add here when a new kaomoji shape appears.
const CORPUS = [
  '(◕‿◕)',
  '(￣▽￣)／',
  '╰(°▽°)╯',
  '(๑•̀ㅂ•́)و✧',
  '(｡◕‿◕｡)',
  'ヽ(°〇°)ﾉ',
  '(⌐■_■)',
  '(╯°□°)╯',
  '┐(￣ヘ￣)┌',
  '(¬‿¬)',
  '٩(◕‿◕｡)۶',
  '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
  'ʕ•ᴥ•ʔ',
  '(ง •̀_•́)ง',
  '(๑•́ ₃ •̀๑)',
  'w(ﾟДﾟ)w',
  '(´・ω・`)',
  '(；ω；)',
  '(⊙_⊙)',
  '(つ﹏⊂)',
  '(≧▽≦)',
  '(ノಠ益ಠ)ノ',
  '(◍˃̶ᗜ˂̶◍)ノ',
  '(•̀ᴗ•́)و',
  '(๑˃ᴗ˂)ﻭ',
  '( •̀ ω •́ )✧',
];

// Ordinary parentheticals that must NEVER be treated as kaomoji. Includes
// inline-code parens (the backtick false-positive that bit us once).
const NEGATIVES = [
  'This is (a normal sentence) here',
  'console.log(value)',
  'Step (1) is important',
  '（99.5% → 89.5%）',
  '（收益）',
  '(see GP-194)',
  '（`Cmd+D`）往右切',
  '（例如 `GP.next: 152`）',
  '（`agent/agent.py`）當病人',
];

// Soft-warning scan only. Halfwidth katakana (U+FF65–FF9F) almost never appears
// in real prose, so a bracket group containing it that the plugin does NOT
// already protect is very likely a kaomoji we forgot to cover.
const HALFWIDTH_KATAKANA = /[･-ﾟ]/u;
const BRACKET_GROUP = /[wWmMqQ]?[（(][^\n\r()（）]{1,28}[）)]/gu;

export function check() {
  const hard = [];
  const warn = [];

  // 1. Corpus regression lock — every known kaomoji must be detected AND atomic.
  for (const k of CORPUS) {
    const p = protectKaomoji(k);
    if (p === k)
      hard.push(
        `corpus kaomoji NOT detected by plugin: ${JSON.stringify(k)} (add its glyph to KAOMOJI_CHARS)`
      );
    else if (hasBreakOpportunity(p))
      hard.push(
        `corpus kaomoji still breakable after protect: ${JSON.stringify(k)} -> ${JSON.stringify(p)}`
      );
  }

  // 2. Ordinary parentheticals must stay untouched (no false positives).
  for (const n of NEGATIVES) {
    if (protectKaomoji(n) !== n) hard.push(`ordinary text wrongly modified: ${JSON.stringify(n)}`);
  }

  // 3. Soft scan: halfwidth-katakana bracket groups the plugin misses.
  const files = readdirSync(postsDir).filter((f) => f.endsWith('.mdx'));
  const warned = new Set();
  for (const f of files) {
    const text = readFileSync(resolve(postsDir, f), 'utf8');
    for (const m of text.matchAll(BRACKET_GROUP)) {
      const cand = m[0];
      if (!HALFWIDTH_KATAKANA.test(cand)) continue;
      if (protectKaomoji(cand) === cand && !warned.has(cand)) {
        warned.add(cand);
        warn.push(`possible un-protected kaomoji in ${f}: ${JSON.stringify(cand)}`);
      }
    }
  }

  return { ok: hard.length === 0, hard, warn };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, hard, warn } = check();
  if (warn.length) {
    console.warn(
      `⚠️  ${warn.length} possible un-protected kaomoji (review; add to plugin + CORPUS if real):`
    );
    warn.forEach((w) => console.warn('   ' + w));
  }
  if (!ok) {
    console.error(`\n❌ kaomoji unbreakable check FAILED (${hard.length}):`);
    hard.forEach((h) => console.error('   ' + h));
    process.exit(1);
  }
  console.log(
    `✓ kaomoji unbreakable: ${CORPUS.length} corpus + all plugin-detected post kaomoji are atomic`
  );
}
