#!/usr/bin/env node
/**
 * Bundle Budget Check for gu-log
 *
 * Modes:
 * - check-only (default): check budget only, do NOT write history.
 * - --record: check budget and append a history entry.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const BUDGET_PATH = join(ROOT, 'quality', 'bundle-budget.json');
const HISTORY_PATH = join(ROOT, 'quality', 'bundle-size-history.json');

const args = process.argv.slice(2);
const isRecordMode = args.includes('--record');
const hasUnknownArgs = args.some((arg) => arg !== '--record');

if (hasUnknownArgs) {
  console.error('Unknown arguments. Usage: node scripts/bundle-budget-check.mjs [--record]');
  process.exit(2);
}

// 1. Run bundle-size.mjs and capture output
const sizeJson = execSync('node scripts/bundle-size.mjs', {
  cwd: ROOT,
  encoding: 'utf-8',
});
const sizes = JSON.parse(sizeJson);

// 2. Read budget config
const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'));

// 3. Compare against budget
const violations = [];

if (budget.totalMaxKB !== null && sizes.totalKB > budget.totalMaxKB) {
  violations.push(`Total size ${sizes.totalKB} KB exceeds budget ${budget.totalMaxKB} KB`);
}
if (budget.jsMaxKB !== null && sizes.jsKB > budget.jsMaxKB) {
  violations.push(`JS size ${sizes.jsKB} KB exceeds budget ${budget.jsMaxKB} KB`);
}
if (budget.cssMaxKB !== null && sizes.cssKB > budget.cssMaxKB) {
  violations.push(`CSS size ${sizes.cssKB} KB exceeds budget ${budget.cssMaxKB} KB`);
}

// Check single file max
if (budget.singleFileMaxKB !== null) {
  for (const file of sizes.top10LargestFiles) {
    const ext = file.path.split('.').pop().toLowerCase();
    if (['js', 'mjs', 'css'].includes(ext) && file.sizeKB > budget.singleFileMaxKB) {
      violations.push(
        `File "${file.path}" (${file.sizeKB} KB) exceeds single-file budget ${budget.singleFileMaxKB} KB`
      );
    }
  }
}

// 4. Optional: append to history only in --record mode
if (isRecordMode) {
  const historyEntry = {
    date: new Date().toISOString(),
    totalKB: sizes.totalKB,
    jsKB: sizes.jsKB,
    cssKB: sizes.cssKB,
    htmlKB: sizes.htmlKB,
    imgKB: sizes.imgKB,
    otherKB: sizes.otherKB,
    fileCount: sizes.fileCount,
    passed: violations.length === 0,
  };

  let history = [];
  if (existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
    } catch {
      history = [];
    }
  }

  history.push(historyEntry);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
}

// 5. Report
console.log('=== Bundle Size Report ===');
console.log(`Mode:   ${isRecordMode ? 'record (--record)' : 'check-only (default)'}`);
console.log(`Total:  ${sizes.totalKB} KB`);
console.log(`JS:     ${sizes.jsKB} KB`);
console.log(`CSS:    ${sizes.cssKB} KB`);
console.log(`HTML:   ${sizes.htmlKB} KB`);
console.log(`Images: ${sizes.imgKB} KB`);
console.log(`Other:  ${sizes.otherKB} KB`);
console.log(`Files:  ${sizes.fileCount}`);
console.log('');

if (!isRecordMode) {
  console.log('ℹ️  Check-only mode: history file was not modified.');
  console.log('');
}

if (violations.length > 0) {
  console.log('❌ BUDGET EXCEEDED:');
  for (const v of violations) {
    console.log(`  - ${v}`);
  }
  process.exit(1);
} else {
  console.log('✅ All within budget.');
}
