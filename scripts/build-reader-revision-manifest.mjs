#!/usr/bin/env node
/**
 * Build reader-facing post revisions.
 *
 * Unlike post-versions.json (git touch count), this manifest hashes only
 * reader-visible article identity/body so backend-only metadata changes do not
 * make old reads look stale.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const postsDir = join(repoRoot, 'src', 'content', 'posts');
const outPath = join(repoRoot, 'src', 'data', 'post-reader-revisions.json');
const checkOnly = process.argv.includes('--check');

const READER_VISIBLE_FRONTMATTER_KEYS = [
  'ticketId',
  'title',
  'originalDate',
  'translatedDate',
  'source',
  'sourceUrl',
  'author',
  'summary',
  'lang',
  'tags',
  'status',
  'deprecatedBy',
  'deprecatedReason',
  'retiredReason',
  'retiredAt',
  'series',
];

export function extractPostParts(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };
  return {
    frontmatter: yaml.parse(match[1]) ?? {},
    body: content.slice(match[0].length),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function computeReaderRevisionFromContent(content) {
  const { frontmatter, body } = extractPostParts(content);
  const readerVisibleFrontmatter = {};
  for (const key of READER_VISIBLE_FRONTMATTER_KEYS) {
    if (frontmatter[key] !== undefined)
      readerVisibleFrontmatter[key] = stableValue(frontmatter[key]);
  }
  const canonical = JSON.stringify({ frontmatter: readerVisibleFrontmatter, body }, null, 2);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function buildReaderRevisionManifest() {
  const manifest = {};
  for (const file of readdirSync(postsDir).sort()) {
    if (!file.endsWith('.mdx')) continue;
    if (file.includes('-pending-')) continue;
    const postId = file.replace(/\.mdx$/, '');
    const content = readFileSync(join(postsDir, file), 'utf8');
    if (hasPendingTicketId(content)) continue;
    manifest[postId] = computeReaderRevisionFromContent(content);
  }
  return manifest;
}

function hasPendingTicketId(content) {
  return /^[ \t]*ticketId:[ \t]*["']?[A-Za-z]+-PENDING["']?[ \t]*$/m.test(content);
}

function writeOrCheckManifest() {
  const next = `${JSON.stringify(buildReaderRevisionManifest(), null, 2)}\n`;
  const count = Object.keys(JSON.parse(next)).length;

  if (checkOnly) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== next) {
      console.error(
        '❌ post-reader-revisions.json is stale. Run: node scripts/build-reader-revision-manifest.mjs'
      );
      process.exit(1);
    }
    console.log(`✅ post-reader-revisions.json fresh: ${count} posts tracked`);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, next);
    console.log(`✅ post-reader-revisions.json: ${count} posts tracked`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOrCheckManifest();
}
