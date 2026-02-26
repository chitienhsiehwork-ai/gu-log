#!/usr/bin/env node
/**
 * Batch kaomoji injector for gu-log posts.
 * Adds one kaomoji to the last substantive paragraph of each post that lacks one.
 *
 * Usage:
 *   node scripts/add-kaomoji.mjs              # dry-run (show what would change)
 *   node scripts/add-kaomoji.mjs --write      # actually write changes
 *   node scripts/add-kaomoji.mjs --write file1.mdx file2.mdx  # specific files only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

const WRITE_MODE = process.argv.includes('--write');
const specificFiles = process.argv.slice(2).filter(a => a !== '--write' && a.endsWith('.mdx'));

// Safe kaomoji pool (no markdown syntax chars: no backticks, asterisks, underscores)
const KAOMOJI_POOL = [
  '(◍•ᴗ•◍)',
  '(๑˃ᴗ˂)ﻭ',
  '( •̀ ω •́ )✧',
  '(◍˃̶ᗜ˂̶◍)ノ"',
  '(•̀ᴗ•́)و',
  '(；ω；)',
];

// Detection pattern (same as validate-posts.mjs Rule 16)
const KAOMOJI_PATTERN = /[（(][^)）\n]{0,40}[ωᴗᗜ◍˃˂╥][^)）\n]{0,40}[)）]/;

let poolIndex = 0;
function nextKaomoji() {
  const k = KAOMOJI_POOL[poolIndex % KAOMOJI_POOL.length];
  poolIndex++;
  return k;
}

function getContentBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
  return match ? match[1] : '';
}

function hasKaomoji(content) {
  const body = getContentBody(content)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');
  return KAOMOJI_PATTERN.test(body);
}

/**
 * Find the best insertion point and add a kaomoji.
 * Strategy:
 * 1. Try the last ClawdNote's closing content line
 * 2. Otherwise, find the last substantive paragraph line
 */
function addKaomoji(content) {
  const kaomoji = nextKaomoji();
  const lines = content.split('\n');

  // Find the last substantive content line (working backwards)
  // Skip: empty lines, code fences, import statements, component tags, headings, frontmatter
  let insertIdx = -1;
  let inCodeBlock = false;

  // Scan backwards
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Track code blocks (backwards)
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Skip non-content lines
    if (line === '') continue;
    if (line === '---') continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('import ')) continue;
    if (line.startsWith('<') && (line.startsWith('</') || line.endsWith('/>'))) continue;
    if (line === '<ClawdNote>' || line === '</ClawdNote>') continue;

    // Found a substantive line — must be our own prose, not quotes/URLs/citations
    if (line.length >= 10
        && !line.match(/^<\/?[\w]+>$/)
        && !line.startsWith('>')           // blockquotes
        && !line.startsWith('**@')         // attributed quotes
        && !line.match(/^\*[^*]+\*$/)      // full-italic lines (citations)
        && !line.match(/^https?:\/\//)     // bare URLs
        && !line.match(/^\[.*\]\(http/)    // markdown links as sole content
        && !line.startsWith('|')           // table rows
    ) {
      insertIdx = i;
      break;
    }
  }

  if (insertIdx === -1) {
    return null; // couldn't find a good spot
  }

  // Append kaomoji to the line
  const originalLine = lines[insertIdx];
  const trimmed = originalLine.trimEnd();

  // Don't add after a line that ends with a component tag
  if (trimmed.endsWith('>') && !trimmed.endsWith('->')) {
    // Try to find a better line above
    for (let i = insertIdx - 1; i >= 0; i--) {
      const l = lines[i].trim();
      if (l.length >= 10 && !l.match(/^<\/?[\w]+>$/) && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('import ')) {
        insertIdx = i;
        break;
      }
    }
  }

  // Add the kaomoji
  const finalLine = lines[insertIdx].trimEnd();
  // Add space before kaomoji if line doesn't end with space or CJK
  const needsSpace = finalLine.length > 0 && !finalLine.endsWith(' ');
  lines[insertIdx] = finalLine + (needsSpace ? ' ' : '') + kaomoji;

  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────
function main() {
  let files;
  if (specificFiles.length > 0) {
    files = specificFiles.map(f => {
      if (fs.existsSync(f)) return f;
      const full = path.join(POSTS_DIR, path.basename(f));
      if (fs.existsSync(full)) return full;
      console.error(`File not found: ${f}`);
      process.exit(1);
    });
  } else {
    files = fs.readdirSync(POSTS_DIR)
      .filter(f => f.endsWith('.mdx') && f !== 'demo.mdx' && f !== 'en-demo.mdx')
      .map(f => path.join(POSTS_DIR, f));
  }

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const filepath of files) {
    const filename = path.basename(filepath);
    const content = fs.readFileSync(filepath, 'utf-8');

    if (hasKaomoji(content)) {
      skipped++;
      continue;
    }

    const result = addKaomoji(content);
    if (!result) {
      console.log(`⚠️  ${filename} — couldn't find insertion point`);
      failed++;
      continue;
    }

    if (WRITE_MODE) {
      fs.writeFileSync(filepath, result, 'utf-8');
      console.log(`✅ ${filename}`);
    } else {
      // Show what would change
      const oldLines = content.split('\n');
      const newLines = result.split('\n');
      for (let i = 0; i < newLines.length; i++) {
        if (oldLines[i] !== newLines[i]) {
          console.log(`📄 ${filename} (line ${i + 1}):`);
          console.log(`   - ${oldLines[i].trim()}`);
          console.log(`   + ${newLines[i].trim()}`);
          break;
        }
      }
    }
    fixed++;
  }

  console.log('');
  console.log(`${WRITE_MODE ? 'Written' : 'Would fix'}: ${fixed} | Skipped (has kaomoji): ${skipped} | Failed: ${failed}`);
  if (!WRITE_MODE && fixed > 0) {
    console.log('Run with --write to apply changes.');
  }
}

main();
