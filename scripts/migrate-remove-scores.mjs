#!/usr/bin/env node
/**
 * migrate-remove-scores.mjs — Remove all legacy scores: blocks from MDX frontmatter
 * Clean slate: tribunal will re-score all articles from zero.
 * Run once: node scripts/migrate-remove-scores.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { fmText: match[1], body: match[2] };
}

function removeScoresBlock(fmText) {
  const lines = fmText.split('\n');
  const result = [];
  let inScores = false;
  for (const line of lines) {
    if (line === 'scores:') {
      inScores = true;
      continue;
    }
    if (inScores) {
      if (line !== '' && !/^\s/.test(line)) {
        inScores = false;
        result.push(line);
      }
      continue;
    }
    result.push(line);
  }
  // Trim trailing blank lines
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result.join('\n');
}

const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
let cleaned = 0;
let skipped = 0;

for (const f of files) {
  const fpath = path.join(POSTS_DIR, f);
  const content = fs.readFileSync(fpath, 'utf8');
  const parts = splitFrontmatter(content);
  if (!parts) {
    skipped++;
    continue;
  }

  // Quick check: skip if no scores block
  if (!parts.fmText.includes('scores:')) {
    skipped++;
    continue;
  }

  const newFm = removeScoresBlock(parts.fmText);
  if (newFm === parts.fmText) {
    skipped++;
    continue;
  }

  fs.writeFileSync(fpath, `---\n${newFm}\n---\n${parts.body}`);
  cleaned++;
}

console.log(`Migration complete: ${cleaned} files cleaned, ${skipped} skipped (no scores block).`);
