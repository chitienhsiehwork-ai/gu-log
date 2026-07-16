#!/usr/bin/env node
/**
 * build-version-manifest.mjs
 *
 * Counts git commits per post file and writes src/data/post-versions.json.
 * Run before `astro build` so Vercel (shallow clone) gets correct version numbers.
 *
 * Output format: { "mp-231-20260331-pawelhuryn-vibe-engineering-vibe-coding": 3, ... }
 * Key = post id (filename without .mdx), Value = commit count.
 *
 * Merge-aware: if the active worktree's gitdir contains `MERGE_HEAD` (i.e.
 * we're in the middle of finalising a merge, typically from the
 * post-versions-regen custom merge driver), the git log range is extended to
 * `HEAD MERGE_HEAD` so the regenerated manifest includes commits from BOTH
 * sides of the merge. Plain `git log` during a merge only walks HEAD's ancestry,
 * which would silently drop counts for posts touched only on the incoming branch.
 */
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outPath = join(repoRoot, 'src', 'data', 'post-versions.json');
const postsDir = join(repoRoot, 'src', 'content', 'posts');
const checkOnly = process.argv.includes('--check');
const includeStaged = process.argv.includes('--include-staged');

// Skip regeneration if the clone is shallow — git log would miss history
// and we'd overwrite the committed manifest with incomplete counts.
// This covers Vercel (shallow by default) and Claude Code sandboxes (CCC
// worktree is also shallow). Full clones (local dev, CI with fetch-depth:0)
// proceed as normal.
try {
  const isShallow = execSync('git rev-parse --is-shallow-repository', {
    encoding: 'utf-8',
    cwd: dirname(fileURLToPath(import.meta.url)) + '/..',
  }).trim();
  if (isShallow === 'true') {
    console.log('⏭️  Shallow clone detected — using committed post-versions.json');
    process.exit(0);
  }
} catch {
  // If git rev-parse fails, fall through to existing logic
}

function buildManifest() {
  // Detect merge-in-progress and include MERGE_HEAD in the walk so the
  // regenerated manifest sees commits from both sides of the merge.
  // `git rev-parse --git-path` is required here: in a linked worktree `.git`
  // is a file and MERGE_HEAD lives under the worktree-specific gitdir.
  const mergeHeadPath = getGitPath('MERGE_HEAD');
  const revs = mergeHeadPath && existsSync(mergeHeadPath) ? ['HEAD', 'MERGE_HEAD'] : ['HEAD'];
  let versions = {};

  try {
    versions = buildCurrentPostVersions(revs);
  } catch (err) {
    console.error('⚠️  git log failed — writing empty manifest:', err.message);
  }

  const next = JSON.stringify(versions, null, 2) + '\n';
  const count = Object.keys(versions).length;
  const hints = [];
  if (revs.length > 1) hints.push('merge-aware');
  if (includeStaged) hints.push('including staged changes');
  const hintText = hints.length > 0 ? ` (${hints.join(', ')})` : '';

  if (checkOnly) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== next) {
      console.error('❌ post-versions.json is stale. Run: node scripts/build-version-manifest.mjs');
      process.exit(1);
    }
    console.log(`✅ post-versions.json fresh: ${count} posts tracked${hintText}`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, next);
  console.log(`✅ post-versions.json: ${count} posts tracked${hintText}`);
}

function getGitPath(name) {
  try {
    const path = execFileSync('git', ['rev-parse', '--git-path', name], {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();
    return isAbsolute(path) ? path : resolve(repoRoot, path);
  } catch {
    return null;
  }
}

function buildCurrentPostVersions(revs) {
  const history = execFileSync(
    'git',
    [
      '-c',
      'diff.renameLimit=0',
      'log',
      ...revs,
      '--format=%x1e%H',
      '--name-status',
      '-M',
      '--',
      'src/content/posts/',
    ],
    {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      cwd: repoRoot,
    }
  );
  const commits = parseHistory(history);
  const staged = includeStaged ? getStagedPostChanges() : null;
  const lineage = new PathLineage();

  for (const commit of commits) {
    for (const [before, after] of commit.renames) lineage.union(before, after);
  }
  if (staged) {
    for (const [before, after] of staged.renames) lineage.union(before, after);
  }

  const countsByLineage = new Map();
  for (const commit of commits) incrementTouchedLineages(countsByLineage, lineage, commit.paths);
  if (staged) incrementTouchedLineages(countsByLineage, lineage, staged.paths);

  const versions = {};
  for (const postPath of getCurrentPostPaths()) {
    const count = countsByLineage.get(lineage.find(postPath)) ?? 0;
    if (count > 0) versions[postIdFromPath(postPath)] = count;
  }
  return versions;
}

function parseHistory(output) {
  const commits = [];
  for (const record of output.split('\x1e')) {
    const lines = record.split('\n').filter(Boolean);
    if (lines.length === 0) continue;
    lines.shift(); // commit hash; record boundaries already preserve commit identity
    commits.push(parseNameStatusLines(lines));
  }
  return commits;
}

function getStagedPostChanges() {
  const staged = execFileSync(
    'git',
    [
      '-c',
      'diff.renameLimit=0',
      'diff',
      '--cached',
      '--name-status',
      '-M',
      '--',
      'src/content/posts/',
    ],
    {
      encoding: 'utf-8',
      cwd: repoRoot,
    }
  );
  return parseNameStatusLines(staged.split('\n').filter(Boolean));
}

function parseNameStatusLines(lines) {
  const paths = new Set();
  const renames = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    if (status.startsWith('R')) {
      const before = parts[1];
      const after = parts[2];
      if (!isPostPath(before) || !isPostPath(after)) continue;
      renames.push([before, after]);
      paths.add(after);
      continue;
    }

    // A copy starts a new article identity, so it must not inherit the source
    // path's history. Only the copy destination is touched by this commit.
    const postPath = status.startsWith('C') ? parts[2] : parts[1];
    if (isPostPath(postPath)) paths.add(postPath);
  }

  return { paths, renames };
}

function incrementTouchedLineages(counts, lineage, paths) {
  const touched = new Set([...paths].map((path) => lineage.find(path)));
  for (const root of touched) counts.set(root, (counts.get(root) ?? 0) + 1);
}

function getCurrentPostPaths() {
  return readdirSync(postsDir)
    .filter((file) => file.endsWith('.mdx'))
    .sort()
    .map((file) => `src/content/posts/${file}`)
    .filter((postPath) => !isPendingPost(postIdFromPath(postPath)));
}

function isPostPath(path) {
  return path?.startsWith('src/content/posts/') && path.endsWith('.mdx');
}

function postIdFromPath(path) {
  return path.replace('src/content/posts/', '').replace(/\.mdx$/, '');
}

class PathLineage {
  constructor() {
    this.parents = new Map();
  }

  find(path) {
    const parent = this.parents.get(path);
    if (!parent) {
      this.parents.set(path, path);
      return path;
    }
    if (parent === path) return path;
    const root = this.find(parent);
    this.parents.set(path, root);
    return root;
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents.set(leftRoot, rightRoot);
  }
}

function isPendingPost(postId) {
  if (postId.includes('-pending-')) return true;

  const postPath = join(postsDir, `${postId}.mdx`);
  if (!existsSync(postPath)) return false;

  const content = readFileSync(postPath, 'utf8');
  return /^[ \t]*ticketId:[ \t]*["']?[A-Za-z]+-PENDING["']?[ \t]*$/m.test(content);
}

buildManifest();
