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
 * Merge-aware in two ways:
 * - while a merge is in progress, walk `HEAD MERGE_HEAD` so incoming history is
 *   available to the custom merge driver;
 * - after a merge, inspect each parent diff (`git log -m`) for rename edges so
 *   a path canonicalised by the merge keeps its second-parent history.
 *
 * Merge commits provide lineage only. They are not counted as article touches,
 * matching the historical manifest semantics and avoiding version bumps from
 * ordinary PR merge commits.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outPath = join(repoRoot, 'src', 'data', 'post-versions.json');
const postsDir = join(repoRoot, 'src', 'content', 'posts');
const checkOnly = process.argv.includes('--check');
const includeStaged = process.argv.includes('--include-staged');

function isShallowRepository() {
  const result = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    encoding: 'utf-8',
    cwd: repoRoot,
  }).trim();

  if (result === 'true') return true;
  if (result === 'false') return false;
  throw new Error(`Invalid shallow repository probe result: ${JSON.stringify(result)}`);
}

function buildManifest() {
  // Detect merge-in-progress and include MERGE_HEAD in the walk so the
  // regenerated manifest sees commits from both sides of the merge.
  // `git rev-parse --git-path` is required here: in a linked worktree `.git`
  // is a file and MERGE_HEAD lives under the worktree-specific gitdir.
  const mergeHeadPath = getGitPath('MERGE_HEAD');
  const revs = mergeHeadPath && existsSync(mergeHeadPath) ? ['HEAD', 'MERGE_HEAD'] : ['HEAD'];
  const versions = buildCurrentPostVersions(revs);

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
  replaceManifest(next);
  console.log(`✅ post-versions.json: ${count} posts tracked${hintText}`);
}

function replaceManifest(next) {
  const tempPath = join(dirname(outPath), `.post-versions.json.${process.pid}.${randomUUID()}.tmp`);

  try {
    writeFileSync(tempPath, next);
    renameSync(tempPath, outPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        console.error('⚠️  Failed to remove temporary post version manifest:', cleanupError);
      }
    }
    throw error;
  }
}

function getGitPath(name) {
  const path = execFileSync('git', ['rev-parse', '--git-path', name], {
    cwd: repoRoot,
    encoding: 'utf-8',
  }).trim();
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function buildCurrentPostVersions(revs) {
  const history = getPostHistory(revs);
  const mergeHistory = getPostHistory(revs, { mergeDiffs: true });
  const commits = parseHistory(history);
  const mergeCommits = parseHistory(mergeHistory);
  const mergeInProgress = revs.includes('MERGE_HEAD');
  const staged = includeStaged ? getStagedPostChanges(revs) : null;
  const lineage = new PathLineage();

  for (const commit of commits) {
    for (const [before, after] of commit.renames) lineage.union(before, after);
  }
  for (const commit of mergeCommits) {
    for (const [before, after] of commit.renames) lineage.union(before, after);
  }
  if (staged) {
    for (const [before, after] of staged.renames) lineage.union(before, after);
  }

  const countsByLineage = new Map();
  for (const commit of commits) incrementTouchedLineages(countsByLineage, lineage, commit.paths);
  // A regular staged commit is a future article touch. During a merge, however,
  // the index describes the merge resolution: the eventual merge commit only
  // contributes rename lineage, so counting the same index here would make the
  // pre-commit manifest one version newer than the post-commit manifest.
  if (staged && !mergeInProgress) {
    incrementTouchedLineages(countsByLineage, lineage, staged.paths);
  }

  const versions = {};
  for (const postPath of getCurrentPostPaths()) {
    const count = countsByLineage.get(lineage.find(postPath)) ?? 0;
    if (count > 0) versions[postIdFromPath(postPath)] = count;
  }
  return versions;
}

function getPostHistory(revs, { mergeDiffs = false } = {}) {
  const args = ['-c', 'diff.renameLimit=0', 'log', ...revs, '--format=%x1e%H', '--name-status'];
  if (mergeDiffs) args.push('--merges', '-m');
  args.push('-M', '--', 'src/content/posts/');

  return execFileSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    cwd: repoRoot,
  });
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

function getStagedPostChanges(revs) {
  // In an ordinary commit HEAD is the only useful comparison. During a merge,
  // compare the index with both parents: a resolution that renames an incoming
  // path can look like a plain add relative to HEAD but like a rename relative
  // to MERGE_HEAD. Both views are needed to preserve lineage before the merge
  // commit exists.
  const bases = revs.includes('MERGE_HEAD') ? ['HEAD', 'MERGE_HEAD'] : ['HEAD'];
  const combined = { paths: new Set(), renames: [] };

  for (const base of bases) {
    const staged = execFileSync(
      'git',
      [
        '-c',
        'diff.renameLimit=0',
        'diff',
        '--cached',
        base,
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
    const changes = parseNameStatusLines(staged.split('\n').filter(Boolean));
    for (const path of changes.paths) combined.paths.add(path);
    combined.renames.push(...changes.renames);
  }

  return combined;
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

try {
  if (isShallowRepository()) {
    console.log('⏭️  Shallow clone detected — using committed post-versions.json');
  } else {
    buildManifest();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Failed to build post-versions.json: ${message}`);
  process.exitCode = 1;
}
