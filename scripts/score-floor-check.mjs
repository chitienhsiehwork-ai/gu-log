#!/usr/bin/env node
/**
 * Score floor gate for the pre-commit hook.
 *
 * gu-log's automated gate is a FLOOR, not the editorial bar. A post may ship
 * with a sub-8 tribunal score (it gets a visible "refining" badge and is held
 * out of the homepage until a background tribunal lifts it to >=8), but it must
 * carry a real scores.vibe block whose composite clears the floor — nothing
 * structurally broken or garbage (composite < FLOOR) reaches main.
 *
 * Usage: node scripts/score-floor-check.mjs <file> [floor=3]
 *   exit 0 → has a complete scores.vibe block with composite >= floor
 *   exit 1 → missing / incomplete / below floor (reason on stderr)
 *   exit 2 → usage / read error
 */
import { readFileSync } from 'node:fs';
import yaml from 'yaml';

const [, , filePath, floorArg] = process.argv;
const FLOOR = Number.isFinite(Number(floorArg)) ? Number(floorArg) : 3;

if (!filePath) {
  console.error('usage: score-floor-check.mjs <file> [floor]');
  process.exit(2);
}

let content;
try {
  content = readFileSync(filePath, 'utf-8');
} catch {
  console.error(`cannot read ${filePath}`);
  process.exit(2);
}

const match = content.match(/^---\n([\s\S]*?)\n---/);
if (!match) {
  console.error('no frontmatter');
  process.exit(1);
}

let frontmatter;
try {
  frontmatter = yaml.parse(match[1]) ?? {};
} catch {
  console.error('frontmatter parse error');
  process.exit(1);
}

const vibe = frontmatter?.scores?.vibe;
if (!vibe) {
  console.error('missing scores.vibe');
  process.exit(1);
}

// Version-aware required vibe dimensions: tribunalVersion >= 9 moved `clarity`
// out of Vibe into Fresh Eyes, so v9 posts need only the 4 remaining dims.
// v8 and below (incl. missing version) keep the legacy 5-dim requirement.
const tribunalVersion = Number(frontmatter?.scores?.tribunalVersion ?? 0);
const dims =
  tribunalVersion >= 9
    ? ['persona', 'moguNote', 'vibe', 'narrative']
    : ['persona', 'moguNote', 'vibe', 'clarity', 'narrative'];
const missing = dims.filter((d) => typeof vibe[d] !== 'number');
if (missing.length) {
  console.error(`scores.vibe incomplete (missing: ${missing.join(', ')})`);
  process.exit(1);
}

const composite =
  typeof vibe.score === 'number'
    ? vibe.score
    : Math.floor(dims.reduce((sum, d) => sum + vibe[d], 0) / dims.length);

if (composite < FLOOR) {
  console.error(`scores.vibe composite ${composite} < floor ${FLOOR} — iterate before shipping`);
  process.exit(1);
}

console.log(`scores.vibe composite ${composite} >= floor ${FLOOR}`);
process.exit(0);
