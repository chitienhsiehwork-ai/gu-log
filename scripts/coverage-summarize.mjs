#!/usr/bin/env node
/**
 * Aggregates the Istanbul-shaped per-file V8 coverage map that
 * monocart-reporter writes (quality/coverage/coverage/coverage.json) into a
 * single { statements, branches, functions, lines } percentage summary that
 * scripts/coverage-ratchet.sh can compare against the baseline.
 *
 * monocart's own report.json only carries test-run pass/fail counts, not a
 * coverage percentage summary — this script computes the summary monocart
 * doesn't provide.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const COVERAGE_MAP_PATH = join(ROOT, 'quality', 'coverage', 'coverage', 'coverage.json');
const OUT_PATH = join(ROOT, 'quality', 'coverage', 'summary.json');

function pct(covered, total) {
  // total === 0 means entryFilter matched nothing — that's collection having
  // silently regressed to zero, not "100% covered". Reporting 100 here would
  // let coverage-ratchet.sh read it as an improvement and ratchet the
  // baseline up to a number nothing actually measured.
  if (total === 0) {
    throw new Error('No entries matched entryFilter — coverage collection produced zero data.');
  }
  return (covered / total) * 100;
}

async function main() {
  if (!existsSync(COVERAGE_MAP_PATH)) {
    console.error(`❌ No coverage map found at ${COVERAGE_MAP_PATH}`);
    process.exit(1);
  }

  const map = JSON.parse(await readFile(COVERAGE_MAP_PATH, 'utf-8'));

  let stTotal = 0,
    stCovered = 0;
  let fnTotal = 0,
    fnCovered = 0;
  let brTotal = 0,
    brCovered = 0;

  for (const file of Object.values(map)) {
    for (const count of Object.values(file.s || {})) {
      stTotal++;
      if (count > 0) stCovered++;
    }
    for (const count of Object.values(file.f || {})) {
      fnTotal++;
      if (count > 0) fnCovered++;
    }
    for (const branch of Object.values(file.b || {})) {
      for (const count of branch) {
        brTotal++;
        if (count > 0) brCovered++;
      }
    }
  }

  // monocart's v8-derived Istanbul map doesn't distinguish lines from
  // statements (no separate lineMap) — statements are the closest available
  // proxy, consistent with how nyc/Istanbul report "lines" when no separate
  // line map is present.
  const summary = {
    statements: pct(stCovered, stTotal),
    branches: pct(brCovered, brTotal),
    functions: pct(fnCovered, fnTotal),
    lines: pct(stCovered, stTotal),
    raw: { stTotal, stCovered, fnTotal, fnCovered, brTotal, brCovered },
  };

  await writeFile(OUT_PATH, JSON.stringify(summary, null, 2) + '\n');
  console.log(`💾 Coverage summary written to quality/coverage/summary.json`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
