#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src/data/glossary.json');

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseArgs(argv) {
  const args = {
    files: [],
    terms: [],
    all: false,
    format: 'text',
    changedTermsBase: null,
    changedPostsBase: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--format') args.format = argv[++i];
    else if (arg === '--term') args.terms.push(argv[++i]);
    else if (arg === '--files') args.files.push(...argv[++i].split(/\s+/).filter(Boolean));
    else if (arg === '--changed-terms') args.changedTermsBase = argv[++i] ?? 'origin/main';
    else if (arg.startsWith('--changed-terms='))
      args.changedTermsBase = arg.slice('--changed-terms='.length);
    else if (arg === '--changed-posts') args.changedPostsBase = argv[++i] ?? 'origin/main';
    else if (arg.startsWith('--changed-posts='))
      args.changedPostsBase = arg.slice('--changed-posts='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/check-glossary-links.mjs [--all] [--term TERM...] [--files "a.mdx b.mdx"] [--changed-terms origin/main] [--changed-posts origin/main] [--format text|json]`
      );
      process.exit(0);
    } else args.files.push(arg);
  }
  return args;
}

export function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return { data: {}, bodyStart: 0, body: content };
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { data: {}, bodyStart: 0, body: content };
  const raw = content.slice(4, end);
  const bodyStart = content.indexOf('\n', end + 4) + 1;
  const data = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value === '') {
      const list = [];
      let j = i + 1;
      while (j < lines.length) {
        const lm = lines[j].match(/^\s*-\s*(.+?)\s*$/);
        if (!lm) break;
        list.push(lm[1].replace(/^['"]|['"]$/g, ''));
        j += 1;
      }
      if (list.length) data[key] = list;
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, bodyStart, body: content.slice(bodyStart) };
}

export function isEnglishPost(filePath, frontmatter = {}) {
  const base = path.basename(filePath);
  return frontmatter.lang === 'en' || base.startsWith('en-');
}

export function loadGlossary(glossaryPath = GLOSSARY_PATH) {
  return JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
}

export function normalizeGlossary(glossary) {
  return glossary
    .filter((entry) => entry && entry.term && entry.linking?.enabled !== false)
    .map((entry) => {
      const linking = entry.linking ?? {};
      const matches =
        Array.isArray(linking.match) && linking.match.length ? linking.match : [entry.term];
      return {
        term: entry.term,
        anchor: linking.anchor || slugify(entry.term),
        matches: matches.filter(Boolean),
        caseSensitive: linking.caseSensitive !== false,
      };
    })
    .filter((entry) => entry.matches.length)
    .sort(
      (a, b) =>
        Math.max(...b.matches.map((m) => m.length)) - Math.max(...a.matches.map((m) => m.length))
    );
}

function markRange(mask, start, end) {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(mask.length, end);
  for (let i = safeStart; i < safeEnd; i += 1) mask[i] = true;
}

function maskRegex(content, mask, re) {
  let match;
  while ((match = re.exec(content))) markRange(mask, match.index, match.index + match[0].length);
}

export function buildUnsafeMask(content) {
  const mask = new Array(content.length).fill(false);

  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end >= 0) {
      const after = content.indexOf('\n', end + 4);
      markRange(mask, 0, after >= 0 ? after + 1 : content.length);
    }
  }

  maskRegex(content, mask, /```[\s\S]*?```/g);
  maskRegex(content, mask, /`[^`\n]+`/g);
  maskRegex(content, mask, /!?\[[^\]\n]*\]\([^)\n]+\)/g);
  maskRegex(content, mask, /https?:\/\/[^\s)]+/g);

  const lines = content.split(/\n/);
  let offset = 0;
  let inMdxComponent = false;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    const startsMdxComponent = /^\s*<[A-Z][\w.:-]*\b/.test(line);
    const endsMdxComponent = /\/?>\s*$/.test(line) && !/[{(]\s*$/.test(line);

    if (
      inMdxComponent ||
      startsMdxComponent ||
      /^\s*>/.test(line) ||
      /^\s*(import|export)\b/.test(line) ||
      /^\s*<\/?[A-Z][^>]*>\s*$/.test(line)
    ) {
      markRange(mask, offset, lineEnd);
      if (startsMdxComponent && !endsMdxComponent) inMdxComponent = true;
      if (inMdxComponent && endsMdxComponent) inMdxComponent = false;
    } else {
      let tagMatch;
      const tagRe = /<\/?[A-Za-z][^>]*>/g;
      while ((tagMatch = tagRe.exec(line)))
        markRange(mask, offset + tagMatch.index, offset + tagMatch.index + tagMatch[0].length);
    }
    offset = lineEnd + 1;
  }

  return mask;
}

function isBoundaryChar(ch) {
  return !ch || !/[\p{L}\p{N}_-]/u.test(ch);
}

function rangeIsSafe(mask, start, end) {
  for (let i = start; i < end; i += 1) if (mask[i]) return false;
  return true;
}

export function findSafeOccurrences(content, term, matchText, options = {}) {
  const mask = options.mask ?? buildUnsafeMask(content);
  const flags = term.caseSensitive ? 'g' : 'gi';
  const re = new RegExp(matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  const out = [];
  let match;
  while ((match = re.exec(content))) {
    const start = match.index;
    const end = start + match[0].length;
    if (!rangeIsSafe(mask, start, end)) continue;
    if (!isBoundaryChar(content[start - 1]) || !isBoundaryChar(content[end])) continue;
    const line = content.slice(0, start).split('\n').length;
    out.push({ start, end, text: match[0], line });
  }
  return out;
}

function hasCoverage(content, term, href) {
  for (const matchText of term.matches) {
    const escapedText = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\[${escapedText}\\]\\(${escapedHref}\\)`,
      term.caseSensitive ? '' : 'i'
    );
    if (re.test(content)) return true;
  }
  return false;
}

function ignoredTerms(content, frontmatter) {
  const ignored = new Set();
  const fmIgnore = frontmatter.glossaryIgnore;
  if (Array.isArray(fmIgnore)) for (const t of fmIgnore) ignored.add(t);
  const re = /<!--\s*glossary-ignore\s+([^>]+?)\s*-->/g;
  let match;
  while ((match = re.exec(content))) {
    for (const part of match[1].split(/[,;]/)) {
      const t = part.trim();
      if (t) ignored.add(t);
    }
  }
  return ignored;
}

export function expectedHref(term, filePath, frontmatter) {
  return `${isEnglishPost(filePath, frontmatter) ? '/en/glossary' : '/glossary'}#${term.anchor}`;
}

export function checkContent(content, options = {}) {
  const filePath = options.filePath ?? 'post.mdx';
  const glossary = normalizeGlossary(options.glossary ?? loadGlossary());
  const termFilter = new Set(options.terms ?? []);
  const { data: frontmatter } = parseFrontmatter(content);
  const ignored = ignoredTerms(content, frontmatter);
  const mask = buildUnsafeMask(content);
  const occupied = new Array(content.length).fill(false);
  const violations = [];

  for (const term of glossary) {
    if (termFilter.size && !termFilter.has(term.term)) continue;
    if (ignored.has(term.term)) continue;
    const href = expectedHref(term, filePath, frontmatter);
    if (hasCoverage(content, term, href)) continue;

    let first = null;
    for (const matchText of term.matches) {
      const occurrences = findSafeOccurrences(content, term, matchText, { mask });
      for (const occ of occurrences) {
        let overlaps = false;
        for (let i = occ.start; i < occ.end; i += 1) if (occupied[i]) overlaps = true;
        if (overlaps) continue;
        if (!first || occ.start < first.start) first = occ;
      }
    }
    if (!first) continue;
    markRange(occupied, first.start, first.end);
    violations.push({
      file: filePath,
      term: term.term,
      line: first.line,
      text: first.text,
      expectedHref: href,
      command: `node scripts/apply-glossary-links.mjs --term ${JSON.stringify(term.term)} ${JSON.stringify(filePath)}`,
    });
  }
  return { violations };
}

export function checkFile(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  return checkContent(content, { ...options, filePath });
}

export function listPostFiles() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => path.join(POSTS_DIR, name));
}

function gitChangedFiles(base, pattern = 'src/content/posts') {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`, '--', pattern], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((p) => path.join(REPO_ROOT, p));
  } catch {
    return [];
  }
}

function changedGlossaryTerms(base, glossary) {
  try {
    const show = (ref) => {
      try {
        return execFileSync('git', ['show', `${ref}:src/data/glossary.json`], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        });
      } catch {
        return '[]';
      }
    };
    const before = JSON.parse(show(base));
    const after = glossary;
    const beforeMap = new Map(before.map((e) => [e.term, JSON.stringify(e)]));
    return after.filter((e) => beforeMap.get(e.term) !== JSON.stringify(e)).map((e) => e.term);
  } catch {
    return [];
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const glossary = loadGlossary();
  let files = args.files.map((f) => path.resolve(f));
  let terms = args.terms;

  if (args.all || (!files.length && !args.changedPostsBase)) files = listPostFiles();
  if (args.changedPostsBase) files.push(...gitChangedFiles(args.changedPostsBase));
  if (args.changedTermsBase) {
    terms = [...new Set([...terms, ...changedGlossaryTerms(args.changedTermsBase, glossary)])];
    if (!files.length) files = listPostFiles();
  }
  files = [...new Set(files)].filter((f) => f.endsWith('.mdx') && fs.existsSync(f));

  const violations = [];
  for (const file of files) violations.push(...checkFile(file, { glossary, terms }).violations);

  if (args.format === 'json') {
    console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
  } else if (violations.length) {
    console.error(`❌ Glossary link coverage failed: ${violations.length} missing link(s)`);
    for (const v of violations.slice(0, 200)) {
      console.error(`${path.relative(REPO_ROOT, v.file)}:${v.line} ${v.term} → ${v.expectedHref}`);
      console.error(`  fix: ${v.command}`);
    }
    if (violations.length > 200) console.error(`... ${violations.length - 200} more`);
  } else {
    console.log(
      `✓ glossary link coverage clean (${files.length} file(s) checked${terms.length ? `, terms: ${terms.join(', ')}` : ''})`
    );
  }
  process.exit(violations.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
