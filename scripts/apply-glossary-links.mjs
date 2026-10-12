#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  checkContent,
  listPostFiles,
  loadGlossary,
  missingGlossaryLinks,
  normalizeGlossary,
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

// Writes exactly the links checkContent reports missing, placed by the rule the link-only
// proof also checks, so a backfill passes both.
export function applyLinksToContent(content, options = {}) {
  const edits = missingGlossaryLinks(
    content,
    normalizeGlossary(options.glossary ?? loadGlossary()),
    { filePath: options.filePath ?? 'post.mdx', terms: options.terms }
  ).sort((a, b) => a.start - b.start);

  let output = content;
  for (const edit of [...edits].reverse()) {
    output = `${output.slice(0, edit.start)}[${edit.text}](${edit.href})${output.slice(edit.end)}`;
  }
  return { content: output, changed: output !== content, edits };
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
