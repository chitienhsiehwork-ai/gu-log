#!/usr/bin/env node
/**
 * inject-related-posts.mjs — Inject 延伸閱讀 / Related Reading sections
 *
 * Takes the suggestions JSON from suggest-crosslinks.mjs and injects
 * a related reading section into posts that currently have NO internal links.
 *
 * Usage:
 *   node scripts/inject-related-posts.mjs --input /tmp/crosslink-suggestions.json --dry-run
 *   node scripts/inject-related-posts.mjs --input /tmp/crosslink-suggestions.json
 *   node scripts/inject-related-posts.mjs --dry-run          # generates suggestions inline
 *
 * Options:
 *   --input <file>    Path to suggestions JSON (default: generate inline)
 *   --dry-run         Print diffs without writing files
 *   --limit <n>       Only process first N eligible posts (default: all)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

// ─── CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const inputIdx = args.indexOf('--input');
const INPUT_FILE = inputIdx !== -1 ? args[inputIdx + 1] : null;
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ─── Internal link detection ────────────────────────────────────────
// Detects links to other gu-log posts in the body (not frontmatter)
const INTERNAL_LINK_RE = /\]\(\/posts\/|gu-log\.vercel\.app\/posts\//;

function getBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
  return match ? match[1] : '';
}

function hasInternalLinks(body) {
  return INTERNAL_LINK_RE.test(body);
}

// ─── Section builder ─────────────────────────────────────────────────
function buildSection(lang, suggestedLinks) {
  const heading = lang === 'en' ? '## Related Reading' : '## 延伸閱讀';
  const items = suggestedLinks.map(({ ticketId, title, slug }) => {
    const label = ticketId ? `${ticketId}: ${title}` : title;
    return `- [${label}](/posts/${slug}/)`;
  });
  return `\n${heading}\n\n${items.join('\n')}\n`;
}

// ─── Injection logic ─────────────────────────────────────────────────
/**
 * Finds the position just before the LAST <ClawdNote> block,
 * or falls back to the very end of the file.
 */
function findInsertionPoint(content) {
  // Find all <ClawdNote> occurrences in the body
  const bodyStart = content.indexOf('\n---\n', 4) + 5; // skip frontmatter
  const body = content.slice(bodyStart);

  // Find the last <ClawdNote> in the body
  const lastIdx = body.lastIndexOf('<ClawdNote>');
  if (lastIdx === -1) {
    // No ClawdNote — append at end
    return content.length;
  }

  // Walk back to find the start of the paragraph/block before <ClawdNote>
  // We want to insert before any blank lines leading into the last ClawdNote
  let insertPos = bodyStart + lastIdx;

  // Back up past blank lines
  let i = insertPos - 1;
  while (i >= bodyStart && (content[i] === '\n' || content[i] === '\r')) {
    i--;
  }
  // insertPos = position after last non-blank char before the ClawdNote block
  insertPos = i + 1;

  return insertPos;
}

function injectSection(content, lang, suggestedLinks) {
  const section = buildSection(lang, suggestedLinks);
  const insertPos = findInsertionPoint(content);
  return content.slice(0, insertPos) + '\n' + section + content.slice(insertPos);
}

// ─── Load suggestions ────────────────────────────────────────────────
let suggestions;

if (INPUT_FILE) {
  suggestions = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  process.stderr.write(`Loaded suggestions from ${INPUT_FILE} (${suggestions.length} entries)\n`);
} else {
  process.stderr.write('No --input file given. Generating suggestions inline...\n');
  const suggestScript = path.join(__dirname, 'suggest-crosslinks.mjs');
  const output = execSync(`node ${suggestScript}`, { encoding: 'utf-8' });
  suggestions = JSON.parse(output);
  process.stderr.write(`Generated ${suggestions.length} suggestions inline.\n`);
}

// Build a map: slug → suggestedLinks
const suggestionsMap = new Map();
for (const entry of suggestions) {
  suggestionsMap.set(entry.slug, entry);
}

// ─── Process posts ───────────────────────────────────────────────────
const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
let processed = 0;
let injected = 0;
let skippedHasLinks = 0;
let skippedNoSuggestions = 0;

for (const filename of files) {
  if (processed >= LIMIT) break;

  const slug = filename.replace(/\.mdx$/, '');
  const entry = suggestionsMap.get(slug);

  if (!entry || entry.suggestedLinks.length === 0) {
    skippedNoSuggestions++;
    continue;
  }

  const filepath = path.join(POSTS_DIR, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  const body = getBody(content);

  if (hasInternalLinks(body)) {
    skippedHasLinks++;
    continue;
  }

  processed++;

  const newContent = injectSection(content, entry.lang, entry.suggestedLinks);

  if (DRY_RUN) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`DRY RUN: ${filename} (${entry.lang})`);
    console.log(`Suggestions: ${entry.suggestedLinks.map((l) => l.ticketId || l.slug).join(', ')}`);
    console.log(`\nSection that would be injected:`);
    console.log(buildSection(entry.lang, entry.suggestedLinks));

    // Show insertion context (5 lines around insertion point)
    const insertPos = findInsertionPoint(content);
    const before = content.slice(Math.max(0, insertPos - 200), insertPos);
    const lastLines = before.split('\n').slice(-4).join('\n');
    console.log(`\n--- Context (end of preceding content) ---`);
    console.log(lastLines);
    console.log(`--- [SECTION INSERTED HERE] ---`);
    const afterLines = content.slice(insertPos).split('\n').slice(0, 4).join('\n');
    console.log(afterLines);
  } else {
    fs.writeFileSync(filepath, newContent, 'utf-8');
    console.log(`Injected: ${filename}`);
  }

  injected++;
}

const mode = DRY_RUN ? '[DRY RUN]' : '[LIVE]';
process.stderr.write(
  `\n${mode} Summary:\n` +
    `  Injected:              ${injected}\n` +
    `  Skipped (has links):   ${skippedHasLinks}\n` +
    `  Skipped (no suggestions): ${skippedNoSuggestions}\n`,
);
