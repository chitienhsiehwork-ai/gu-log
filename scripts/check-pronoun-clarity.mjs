#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const console = globalThis.console;

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

const files = process.argv.slice(2).filter(Boolean);

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEnglishPost(filePath) {
  return path.basename(filePath).startsWith('en-');
}

function markFrontmatter(lines, masked) {
  if (lines[0] !== '---') return 0;

  masked[0] = true;
  for (let i = 1; i < lines.length; i += 1) {
    masked[i] = true;
    if (lines[i] === '---') {
      return i + 1;
    }
  }

  return lines.length;
}

function buildMask(lines) {
  const masked = new Array(lines.length).fill(false);
  let startIndex = markFrontmatter(lines, masked);
  let inFence = false;
  let fenceMarker = '';
  let inClawdNote = false;
  let inShroomDogNote = false;

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];

    if (inFence) {
      masked[i] = true;
      if (new RegExp(`^\\s*${escapeRegex(fenceMarker)}`).test(line)) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (inClawdNote) {
      masked[i] = true;
      if (line.includes('</ClawdNote>')) {
        inClawdNote = false;
      }
      continue;
    }

    if (inShroomDogNote) {
      masked[i] = true;
      if (line.includes('</ShroomDogNote>')) {
        inShroomDogNote = false;
      }
      continue;
    }

    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      masked[i] = true;
      fenceMarker = fenceMatch[1];
      if (
        !new RegExp(`^\\s*${escapeRegex(fenceMarker)}.*${escapeRegex(fenceMarker)}\\s*$`).test(line)
      ) {
        inFence = true;
      }
      continue;
    }

    if (line.includes('<ClawdNote')) {
      masked[i] = true;
      if (!line.includes('</ClawdNote>')) {
        inClawdNote = true;
      }
      continue;
    }

    if (line.includes('<ShroomDogNote')) {
      masked[i] = true;
      if (!line.includes('</ShroomDogNote>')) {
        inShroomDogNote = true;
      }
      continue;
    }

    if (/^\s*>/.test(line)) {
      masked[i] = true;
      continue;
    }

    if (/^\s*import\b/.test(line)) {
      masked[i] = true;
      continue;
    }

    if (/^(?: {4,}|\t)/.test(line)) {
      masked[i] = true;
    }
  }

  return masked;
}

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
}

function truncate(line, max = 140) {
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

function formatContext(lines, index) {
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length - 1, index + 1);
  const width = String(end + 1).length;
  const output = [];

  for (let i = start; i <= end; i += 1) {
    const marker = i === index ? '>' : ' ';
    output.push(`   ${marker} ${String(i + 1).padStart(width)} | ${truncate(lines[i])}`);
  }

  return output.join('\n');
}

function findViolations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const masked = buildMask(lines);
  const violations = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (masked[i]) continue;

    const searchable = stripInlineCode(lines[i]);
    const matches = [...searchable.matchAll(/[你我]/g)];
    if (matches.length === 0) continue;

    violations.push({
      line: i + 1,
      chars: [...new Set(matches.map((match) => match[0]))].join(''),
      context: formatContext(lines, i),
    });
  }

  return violations;
}

export { buildMask, findViolations, stripInlineCode, isEnglishPost };

if (!__isCli) {
  // imported as module; skip CLI body
} else {
  if (files.length === 0) {
    console.log('ℹ️  No files provided for pronoun clarity check');
    process.exit(0);
  }

  let filesWithViolations = 0;
  let totalViolations = 0;

  for (const file of files) {
    const abs = path.resolve(file);

    if (!fs.existsSync(abs) || path.extname(abs) !== '.mdx' || isEnglishPost(abs)) {
      continue;
    }

    const violations = findViolations(abs);
    if (violations.length === 0) continue;

    filesWithViolations += 1;
    totalViolations += violations.length;

    console.log(`❌ ${path.relative(process.cwd(), abs)}`);
    for (const violation of violations) {
      console.log(`   line ${violation.line} — found 「${violation.chars.split('').join(' / ')}」`);
      console.log(violation.context);
      console.log('');
    }
  }

  if (totalViolations > 0) {
    console.log(
      `❌ Pronoun clarity check failed: ${totalViolations} violation(s) across ${filesWithViolations} file(s)`
    );
    process.exit(1);
  }

  process.exit(0);
} // end CLI guard
