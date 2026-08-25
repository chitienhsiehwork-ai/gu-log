#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const POSTS_DIR = 'src/content/posts';
const SOURCE_FILE = new RegExp(`^${POSTS_DIR}/[^/]+\\.mdx$`, 'u');
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
const GLOSSARY_LINK = /^\/(?:en\/)?glossary#[^)\n]+$/u;
const INTERNAL_POST_PREFIX = /^\/(?:en\/)?posts(?:\/|$)/u;
const CANONICAL_POST_LINK = /^\/(en\/)?posts\/([a-z0-9][a-z0-9-]*)\/$/u;
const CANONICAL_TICKET_ID = /^(GP|MP)-([1-9]\d*)$/u;

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options,
  });
}

function stagedPostRecords() {
  const output = git(['ls-files', '--stage', '-z', '--', POSTS_DIR]);
  return output
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf('\t');
      if (separator === -1) {
        throw new Error('malformed staged post record');
      }
      const [mode, objectId, stage] = record.slice(0, separator).split(' ');
      return { mode, objectId, stage, file: record.slice(separator + 1) };
    });
}

function changedLines(file) {
  const diff = git(['diff', '--cached', '--no-color', '-U0', '--', file]);
  const added = [];
  let inHunk = false;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
  }

  return { added };
}

function targetForSlug(records, slug) {
  const candidates = records.filter(
    ({ file }) => path.basename(file, '.mdx').toLowerCase() === slug
  );
  if (candidates.length !== 1) {
    throw new Error(`canonical target ${slug} must resolve to exactly one staged post`);
  }
  const [target] = candidates;
  if (target.stage !== '0') {
    throw new Error(`canonical target ${slug} is unmerged in the staged index`);
  }
  if (path.basename(target.file, '.mdx') !== slug) {
    throw new Error(`canonical target ${slug} must use an exact lowercase filename`);
  }
  return target.file;
}

function validateCanonicalLink(records, label, url) {
  const match = CANONICAL_POST_LINK.exec(url);
  if (!match) {
    throw new Error(`internal post URL is not canonical: ${url}`);
  }

  const expectedLang = match[1] ? 'en' : 'zh-tw';
  const slug = match[2];
  if ((expectedLang === 'en') !== slug.startsWith('en-')) {
    throw new Error(`internal post URL locale does not match its slug: ${url}`);
  }

  const targetFile = targetForSlug(records, slug);
  let frontmatter;
  try {
    frontmatter = matter(git(['show', `:${targetFile}`])).data;
  } catch (error) {
    throw new Error(`cannot parse staged target frontmatter for ${targetFile}`, { cause: error });
  }

  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error(`staged target frontmatter must be a mapping: ${targetFile}`);
  }
  const { ticketId, title, lang } = frontmatter;
  if (lang !== expectedLang) {
    throw new Error(`staged target lang does not match URL locale: ${targetFile}`);
  }
  if (typeof ticketId !== 'string' || ticketId.length === 0) {
    throw new Error(`staged target ticketId is missing or malformed: ${targetFile}`);
  }
  if (typeof title !== 'string' || title.length === 0) {
    throw new Error(`staged target title is missing or malformed: ${targetFile}`);
  }

  const ticketMatch = CANONICAL_TICKET_ID.exec(ticketId);
  if (!ticketMatch) {
    throw new Error(`staged target ticketId is not canonical: ${targetFile}`);
  }
  const localizedSlug = expectedLang === 'en' ? slug.slice('en-'.length) : slug;
  const expectedSlugPrefix = `${ticketMatch[1].toLowerCase()}-${ticketMatch[2]}-`;
  if (!localizedSlug.startsWith(expectedSlugPrefix)) {
    throw new Error(`staged target ticketId does not match its filename and slug: ${targetFile}`);
  }

  const expectedLabel = `${ticketId}: ${title}`;
  if (label !== expectedLabel) {
    throw new Error(
      `internal post label ${JSON.stringify(label)} must equal ${JSON.stringify(expectedLabel)}`
    );
  }
}

function normalizeLine(line, records, validateAddedLinks, validationState) {
  const normalized = line.replace(MARKDOWN_LINK, (fullMatch, label, url) => {
    if (GLOSSARY_LINK.test(url)) return label;
    if (!INTERNAL_POST_PREFIX.test(url)) return fullMatch;
    if (validateAddedLinks) {
      validateCanonicalLink(records, label, url);
      validationState.validatedPostLinks += 1;
    }
    return '[INTERNAL_POST_LINK]';
  });

  if (validateAddedLinks && INTERNAL_POST_PREFIX.test(normalized)) {
    throw new Error('added line contains a malformed or non-Markdown internal post URL');
  }
  return normalized;
}

function normalizeDocument(content) {
  return content
    .split('\n')
    .map((line) => normalizeLine(line, [], false, undefined))
    .join('\n');
}

export function isCanonicalInternalPostLinkOnlyDiff(file) {
  if (typeof file !== 'string' || !SOURCE_FILE.test(file)) {
    throw new Error('expected one staged post path under src/content/posts');
  }

  const { added } = changedLines(file);
  if (added.length === 0) return false;

  const records = stagedPostRecords();
  const validationState = { validatedPostLinks: 0 };
  for (const line of added) {
    normalizeLine(line, records, true, validationState);
  }
  if (validationState.validatedPostLinks === 0) return false;

  const headContent = git(['show', `HEAD:${file}`]);
  const stagedContent = git(['show', `:${file}`]);
  return normalizeDocument(headContent) === normalizeDocument(stagedContent);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = isCanonicalInternalPostLinkOnlyDiff(process.argv[2]) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
