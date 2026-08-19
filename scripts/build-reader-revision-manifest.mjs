#!/usr/bin/env node
/**
 * Build reader-facing post revisions.
 *
 * Unlike post-versions.json (git touch count), this manifest hashes only
 * reader-visible article identity/body so backend-only metadata changes do not
 * make old reads look stale.
 */
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractPostParts, readerRevisionCanonicalJSON } from './lib/reader-revision-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const postsDir = join(repoRoot, 'src', 'content', 'posts');
const outPath = join(repoRoot, 'src', 'data', 'post-reader-revisions.json');
const checkOnly = process.argv.includes('--check');
const includeStaged = process.argv.includes('--include-staged');

export function computeReaderRevisionFromContent(content) {
  const { frontmatter, body } = extractPostParts(content);
  const canonical = readerRevisionCanonicalJSON(frontmatter, body);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function buildReaderRevisionManifest() {
  const manifest = {};
  const stagedPosts = includeStaged ? getStagedPostContents() : new Map();
  const deletedPosts = new Set(
    [...stagedPosts].filter(([, content]) => content === null).map(([file]) => file)
  );
  const files = new Set(readdirSync(postsDir).filter((file) => file.endsWith('.mdx')));
  for (const file of stagedPosts.keys()) {
    if (!deletedPosts.has(file)) files.add(file);
  }
  for (const file of deletedPosts) {
    files.delete(file);
  }

  for (const file of [...files].sort()) {
    if (!file.endsWith('.mdx')) continue;
    if (file.includes('-pending-')) continue;
    const postId = file.replace(/\.mdx$/, '');
    const stagedContent = stagedPosts.get(file);
    const content =
      stagedContent === undefined ? readFileSync(join(postsDir, file), 'utf8') : stagedContent;
    if (hasPendingTicketId(content)) continue;
    manifest[postId] = computeReaderRevisionFromContent(content);
  }
  return manifest;
}

function getStagedPostContents() {
  const staged = new Map();
  const statusOutput = execSync('git diff --cached --name-status -M -- src/content/posts/', {
    cwd: repoRoot,
    encoding: 'utf-8',
  });

  for (const line of statusOutput.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    const postPath = status.startsWith('R') || status.startsWith('C') ? parts[2] : parts[1];
    if (!postPath?.startsWith('src/content/posts/') || !postPath.endsWith('.mdx')) continue;

    const file = postPath.replace('src/content/posts/', '');
    if (status.startsWith('D')) {
      staged.set(file, null);
      continue;
    }
    staged.set(
      file,
      execFileSync('git', ['show', `:${postPath}`], {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      })
    );
  }

  return staged;
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
    const hintText = includeStaged ? ' (including staged changes)' : '';
    console.log(`✅ post-reader-revisions.json fresh: ${count} posts tracked${hintText}`);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, next);
    const hintText = includeStaged ? ' (including staged changes)' : '';
    console.log(`✅ post-reader-revisions.json: ${count} posts tracked${hintText}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeOrCheckManifest();
}
