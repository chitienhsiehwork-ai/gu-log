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
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');
const COUNTER_FILE = path.join(__dirname, 'article-counter.json');

// ─── Config ────────────────────────────────────────────────────────
const VALID_PREFIXES = ['SP', 'CP', 'SD'];
const VALID_LANGS = ['zh-tw', 'en'];
const TICKET_PATTERN = /^(SP|CP|SD)-\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /^https?:\/\/.+/;
const MIN_CONTENT_LENGTH = 200; // characters, excluding frontmatter
const REDUNDANT_BOTTOM_CITATION_PATTERNS = [
  /\n---\s*\n+\*\*原文來源[：:]\*\*/,
  /\n---\s*\n+\*\*Original source[：:]\*\*/i,
  /\n---\s*\n+\*\*Source[：:]\*\*/i,
  /\n##\s*原文出處/,
];
const CLAWD_NOTE_REDUNDANT_PREFIX = [
  /<ClawdNote>\s*\n?\s*\*\*Clawd[：:]\*\*/i,
  /<ClawdNote>\s*\n?\s*Clawd[：:]\s/i,
];

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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fm[kv[1]] = val;
    }
  }

  // Parse tags array
  const tagsMatch = raw.match(/tags:\s*\[(.*?)\]/s);
  if (tagsMatch) {
    fm.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean);
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

// ─── Validation Rules ──────────────────────────────────────────────
function validatePost(filepath, allPosts) {
  const filename = path.basename(filepath);
  const content = fs.readFileSync(filepath, 'utf-8');
  const fm = parseFrontmatter(content);
  const body = getContentBody(content);
  const errors = [];
  const warnings = [];

  // ── Rule 1: Frontmatter exists ──
  if (!fm) {
    errors.push('Missing or malformed frontmatter (--- block)');
    return { filename, errors, warnings };
  }

  // ── Rule 2: Required fields ──
  const required = ['title', 'originalDate', 'source', 'sourceUrl', 'summary', 'lang'];
  for (const field of required) {
    if (!fm[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // ── Rule 3: ticketId present and valid format ──
  if (!fm.ticketId) {
    errors.push('Missing ticketId');
  } else if (!TICKET_PATTERN.test(fm.ticketId)) {
    errors.push(`Invalid ticketId format: "${fm.ticketId}" (expected SP-N, CP-N, or SD-N)`);
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
  }

  // ── Rule 8: No duplicate bottom citations ──
  for (const pattern of REDUNDANT_BOTTOM_CITATION_PATTERNS) {
    if (pattern.test(content)) {
      errors.push('Redundant bottom citation found (source is already shown at top by layout)');
      break;
    }
  }

  // ── Rule 9: ClawdNote no redundant prefix ──
  for (const pattern of CLAWD_NOTE_REDUNDANT_PREFIX) {
    if (pattern.test(content)) {
      errors.push('ClawdNote contains redundant "Clawd:" prefix (component auto-adds it)');
      break;
    }
  }

  // ── Rule 10: Minimum content length ──
  // Strip imports and component tags for length check
  const cleanBody = body
    .replace(/^import\s+.*$/gm, '')
    .replace(/<\/?[\w]+[^>]*>/g, '')
    .trim();
  if (cleanBody.length < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short (${cleanBody.length} chars, minimum ${MIN_CONTENT_LENGTH})`);
  }

  // ── Rule 11: summary not too long (for index page) ──
  if (fm.summary && fm.summary.length > 300) {
    warnings.push(`summary is ${fm.summary.length} chars (recommend ≤300 for index page)`);
  }

  // ── Rule 12: ticketId uniqueness (cross-file check) ──
  if (fm.ticketId && allPosts) {
    const sameTicket = allPosts.filter(p =>
      p.ticketId === fm.ticketId && getBaseFilename(p.filename) !== getBaseFilename(filename)
    );
    if (sameTicket.length > 0) {
      errors.push(`Duplicate ticketId "${fm.ticketId}" also in: ${sameTicket.map(p => p.filename).join(', ')}`);
    }
  }

  // ── Rule 13: Translation pair ticketId consistency ──
  if (fm.ticketId && allPosts) {
    const baseName = getBaseFilename(filename);
    const pair = allPosts.find(p =>
      getBaseFilename(p.filename) === baseName && p.filename !== filename
    );
    if (pair && pair.ticketId && pair.ticketId !== fm.ticketId) {
      errors.push(`Translation pair ticketId mismatch: this="${fm.ticketId}", pair="${pair.ticketId}" (${pair.filename})`);
    }
  }

  // ── Rule 14: Filename includes date ──
  const dateInFilename = filename.match(/\d{8}/);
  if (!dateInFilename) {
    warnings.push('Filename does not contain a date (YYYYMMDD)');
  }

  return { filename, errors, warnings };
}

// ─── Main ──────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  // Load all posts for cross-file checks
  const allFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
  const allPosts = allFiles.map(f => {
    const content = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8');
    const fm = parseFrontmatter(content);
    return { filename: f, ticketId: fm?.ticketId || '' };
  });

  // Determine which files to validate
  let filesToValidate;
  if (args.length > 0) {
    filesToValidate = args.map(f => {
      // Accept both full path and just filename
      if (fs.existsSync(f)) return f;
      const fullPath = path.join(POSTS_DIR, path.basename(f));
      if (fs.existsSync(fullPath)) return fullPath;
      console.error(`❌ File not found: ${f}`);
      process.exit(1);
    });
  } else {
    filesToValidate = allFiles.map(f => path.join(POSTS_DIR, f));
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filepath of filesToValidate) {
    const result = validatePost(filepath, allPosts);

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

  console.log('');
  if (totalErrors > 0) {
    console.log(`❌ FAILED: ${totalErrors} error(s), ${totalWarnings} warning(s) in ${filesToValidate.length} file(s)`);
    process.exit(1);
  } else {
    console.log(`✓ PASSED: ${filesToValidate.length} file(s) validated, ${totalWarnings} warning(s)`);
    process.exit(0);
  }
}

main();
