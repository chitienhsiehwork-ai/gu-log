#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { isCanonicalSeriesTaxonomyOnlyChange } from './check-brand-taxonomy.mjs';

const POSTS_DIR = 'src/content/posts';

function git(args, { trim = true, ...options } = {}) {
  try {
    const output = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    return trim ? output.trim() : output;
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

function diffBodyLines(baseRef, baseFile, currentFile) {
  const files = baseFile === currentFile ? [currentFile] : [baseFile, currentFile];
  const diff = git([
    '-c',
    'diff.renameLimit=0',
    'diff',
    '-M',
    '--no-color',
    '-U0',
    '--end-of-options',
    `${baseRef}...HEAD`,
    '--',
    ...files,
  ]);
  if (!diff) return [];
  return diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line))
    .filter((line) => !line.startsWith('+++ ') && !line.startsWith('--- '));
}

function isMetadataOnlyDiff(baseRef, baseFile, currentFile) {
  if (!existsAt(baseRef, baseFile)) return false;
  const lines = diffBodyLines(baseRef, baseFile, currentFile);
  if (lines.length === 0) return true;
  return lines.every((line) =>
    /^[+-]\s*(status|deprecatedReason|deprecatedBy|series|name|order):/.test(line)
  );
}

function normalizeGlossaryAndPostLinks(text) {
  return text
    .replace(/\[([^\]\n]+)\]\(\/(?:en\/)?glossary#[^)\n]+\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\(\/posts\/[^)\n]+\)/g, '$1');
}

function normalizeMaintenanceLinks(line) {
  return normalizeGlossaryAndPostLinks(line.slice(1)).trim();
}

function isLinkOnlyDiff(baseRef, baseFile, currentFile) {
  if (!existsAt(baseRef, baseFile)) return false;
  const lines = diffBodyLines(baseRef, baseFile, currentFile);
  if (lines.length === 0) return true;

  const removed = lines
    .filter((line) => line.startsWith('-'))
    .map(normalizeMaintenanceLinks)
    .sort();
  const added = lines
    .filter((line) => line.startsWith('+'))
    .map(normalizeMaintenanceLinks)
    .sort();

  return JSON.stringify(removed) === JSON.stringify(added);
}

function isExistingTicketAddition(baseRef, baseFile, currentFile) {
  if (existsAt(baseRef, baseFile)) return false;
  return ticketExistsAt(baseRef, readTicketId(currentFile), currentFile);
}

function isCanonicalTaxonomyOnlyChange(baseRef, baseFile, currentFile) {
  if (!existsAt(baseRef, baseFile) || !fs.existsSync(currentFile)) return false;
  const oldContent = git(['show', `${baseRef}:${baseFile}`], { trim: false });
  const newContent = fs.readFileSync(currentFile, 'utf8');
  if (isCanonicalSeriesTaxonomyOnlyChange(oldContent, newContent)) return true;
  // Glossary/post-link (un)wrapping is already gate-exempt on its own via
  // isLinkOnlyDiff, so a canonical taxonomy rename that also carries link
  // wrapping stays mechanical: normalize links on both sides and re-check.
  // Any reader-prose edit still breaks the exact-equality comparison.
  const oldNormalized = normalizeGlossaryAndPostLinks(oldContent);
  const newNormalized = normalizeGlossaryAndPostLinks(newContent);
  if (oldNormalized === oldContent && newNormalized === newContent) return false;
  return isCanonicalSeriesTaxonomyOnlyChange(oldNormalized, newNormalized);
}

function parseNameStatus(output) {
  const fields = output.split('\0');
  const entries = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;

    const baseFile = fields[index++];
    if (!baseFile) break;

    if (status.startsWith('R')) {
      const currentFile = fields[index++];
      if (!currentFile) break;
      entries.push({ baseFile, currentFile });
    } else {
      entries.push({ baseFile, currentFile: baseFile });
    }
  }

  return entries;
}

const baseRef = argValue('--base', 'origin/main');
const changed = git([
  '-c',
  'diff.renameLimit=0',
  'diff',
  '-M',
  '--name-status',
  '-z',
  '--diff-filter=ACMRT',
  '--end-of-options',
  `${baseRef}...HEAD`,
  '--',
  `${POSTS_DIR}/*.mdx`,
]);

const files = parseNameStatus(changed)
  .filter(({ currentFile }) => !path.basename(currentFile).startsWith('en-'))
  .filter(({ currentFile }) => fs.existsSync(currentFile))
  .filter(
    ({ baseFile, currentFile }) => !isCanonicalTaxonomyOnlyChange(baseRef, baseFile, currentFile)
  )
  .filter(({ baseFile, currentFile }) => !isMetadataOnlyDiff(baseRef, baseFile, currentFile))
  .filter(({ baseFile, currentFile }) => !isLinkOnlyDiff(baseRef, baseFile, currentFile))
  .filter(({ baseFile, currentFile }) => !isExistingTicketAddition(baseRef, baseFile, currentFile))
  .map(({ currentFile }) => currentFile);

console.log(files.join('\n'));
