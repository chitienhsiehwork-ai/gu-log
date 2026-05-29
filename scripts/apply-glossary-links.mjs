#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  loadGlossary,
  normalizeGlossary,
  parseFrontmatter,
  buildUnsafeMask,
  findSafeOccurrences,
  expectedHref,
  listPostFiles,
  checkContent,
} from './check-glossary-links.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseArgs(argv) {
  const args = { files: [], terms: [], all: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--term') args.terms.push(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/apply-glossary-links.mjs [--all] [--term TERM...] [--dry-run] [post.mdx...]'
      );
      process.exit(0);
    } else args.files.push(arg);
  }
  return args;
}

function markRange(mask, start, end) {
  for (let i = Math.max(0, start); i < Math.min(mask.length, end); i += 1) mask[i] = true;
}

function hasCorrectCoverage(content, term, href) {
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
  if (Array.isArray(frontmatter.glossaryIgnore))
    for (const t of frontmatter.glossaryIgnore) ignored.add(t);
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

export function applyLinksToContent(content, options = {}) {
  const filePath = options.filePath ?? 'post.mdx';
  const glossary = normalizeGlossary(options.glossary ?? loadGlossary());
  const termFilter = new Set(options.terms ?? []);
  const { data: frontmatter } = parseFrontmatter(content);
  const ignored = ignoredTerms(content, frontmatter);
  let output = content;
  const edits = [];
  const occupied = new Array(content.length).fill(false);
  let mask = buildUnsafeMask(content);

  for (const term of glossary) {
    if (termFilter.size && !termFilter.has(term.term)) continue;
    if (ignored.has(term.term)) continue;
    const href = expectedHref(term, filePath, frontmatter);
    if (hasCorrectCoverage(output, term, href)) continue;

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
    edits.push({ ...first, href, term: term.term });
  }

  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    output = `${output.slice(0, edit.start)}[${output.slice(edit.start, edit.end)}](${edit.href})${output.slice(edit.end)}`;
  }

  return { content: output, changed: output !== content, edits: edits.reverse() };
}

export function applyLinksToFile(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = applyLinksToContent(content, { ...options, filePath });
  if (result.changed && !options.dryRun) fs.writeFileSync(filePath, result.content, 'utf8');
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let files = args.files.map((f) => path.resolve(f));
  if (args.all || !files.length) files = listPostFiles();
  files = [...new Set(files)].filter((f) => f.endsWith('.mdx') && fs.existsSync(f));

  let changed = 0;
  let editCount = 0;
  for (const file of files) {
    const result = applyLinksToFile(file, { terms: args.terms, dryRun: args.dryRun });
    if (result.changed) {
      changed += 1;
      editCount += result.edits.length;
      console.log(
        `${args.dryRun ? 'would update' : 'updated'} ${path.relative(REPO_ROOT, file)} (${result.edits.length} link(s))`
      );
    }
  }
  console.log(
    `${args.dryRun ? 'would update' : 'updated'} ${changed} file(s), ${editCount} link(s)`
  );

  // Safety net: after a real fix, selected files should be clean for the selected terms.
  if (!args.dryRun) {
    const remaining = [];
    for (const file of files)
      remaining.push(
        ...checkContent(fs.readFileSync(file, 'utf8'), { filePath: file, terms: args.terms })
          .violations
      );
    if (remaining.length) {
      console.error(`❌ ${remaining.length} glossary violation(s) remain after fix`);
      process.exit(1);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
