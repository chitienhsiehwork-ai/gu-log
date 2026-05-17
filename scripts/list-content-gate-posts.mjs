#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const POSTS_DIR = 'src/content/posts';

function git(args, options = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch {
    return '';
  }
}

function gitOk(args) {
  try {
    execFileSync('git', args, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function existsAt(ref, file) {
  return gitOk(['cat-file', '-e', `${ref}:${file}`]);
}

function readTicketId(file) {
  if (!fs.existsSync(file)) return '';
  const content = fs.readFileSync(file, 'utf8');
  return content.match(/^ticketId:\s*["']([^"']+)["']/m)?.[1] || '';
}

function ticketExistsAt(ref, ticket, currentFile) {
  if (!ticket || ticket.endsWith('-PENDING')) return false;
  const escaped = ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = git([
    'grep',
    '-l',
    '-E',
    `^ticketId:[[:space:]]*["']${escaped}["']`,
    ref,
    '--',
    POSTS_DIR,
  ]);
  if (!matches) return false;
  return matches
    .split('\n')
    .map((line) => line.replace(`${ref}:`, ''))
    .some((file) => file !== currentFile);
}

function diffBodyLines(baseRef, file) {
  const diff = git(['diff', '--no-color', '-U0', `${baseRef}...HEAD`, '--', file]);
  if (!diff) return [];
  return diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line))
    .filter((line) => !line.startsWith('+++ ') && !line.startsWith('--- '));
}

function isMetadataOnlyDiff(baseRef, file) {
  if (!existsAt(baseRef, file)) return false;
  const lines = diffBodyLines(baseRef, file);
  if (lines.length === 0) return true;
  return lines.every((line) =>
    /^[+-]\s*(status|deprecatedReason|deprecatedBy|series|name|order):/.test(line)
  );
}

function isInternalPostLinkOnlyDiff(baseRef, file) {
  if (!existsAt(baseRef, file)) return false;
  const lines = diffBodyLines(baseRef, file);
  if (lines.length === 0) return true;
  return lines.every((line) => line.includes('/posts/'));
}

function isExistingTicketAddition(baseRef, file) {
  if (existsAt(baseRef, file)) return false;
  return ticketExistsAt(baseRef, readTicketId(file), file);
}

const baseRef = argValue('--base', 'origin/main');
const changed = git([
  'diff',
  '--name-only',
  '-M',
  '--diff-filter=ACMRT',
  `${baseRef}...HEAD`,
  '--',
  `${POSTS_DIR}/*.mdx`,
]);

const files = changed
  .split('\n')
  .filter(Boolean)
  .filter((file) => !path.basename(file).startsWith('en-'))
  .filter((file) => fs.existsSync(file))
  .filter((file) => !isMetadataOnlyDiff(baseRef, file))
  .filter((file) => !isInternalPostLinkOnlyDiff(baseRef, file))
  .filter((file) => !isExistingTicketAddition(baseRef, file));

console.log(files.join('\n'));
