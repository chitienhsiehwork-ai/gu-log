#!/usr/bin/env node
/**
 * build-version-manifest.mjs
 *
 * Counts git commits per post file and writes src/data/post-versions.json.
 * Run before `astro build` so Vercel (shallow clone) gets correct version numbers.
 *
 * Output format: { "cp-231-20260331-pawelhuryn-vibe-engineering-vibe-coding": 3, ... }
 * Key = post id (filename without .mdx), Value = commit count.
 *
 * Merge-aware: if `.git/MERGE_HEAD` exists (i.e. we're in the middle of
 * finalising a merge, typically from the post-versions-regen custom merge
 * driver), the git log range is extended to `HEAD MERGE_HEAD` so the
 * regenerated manifest includes commits from BOTH sides of the merge. Plain
 * `git log` during a merge only walks HEAD's ancestry, which would silently
 * drop the counts for any post touched only on the incoming branch.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outPath = join(repoRoot, 'src', 'data', 'post-versions.json');

// On Vercel (shallow clone), skip — use the committed manifest instead.
if (process.env.VERCEL) {
  console.log('⏭️  Vercel detected — using committed post-versions.json');
  process.exit(0);
}

function buildManifest() {
  const versions = {};

  // Detect merge-in-progress and include MERGE_HEAD in the walk so the
  // regenerated manifest sees commits from both sides of the merge.
  const mergeHeadPath = join(repoRoot, '.git', 'MERGE_HEAD');
  const revs = existsSync(mergeHeadPath) ? 'HEAD MERGE_HEAD' : 'HEAD';

  try {
    const out = execSync(`git log ${revs} --name-only --pretty=format: -- src/content/posts/`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: repoRoot,
    });

    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith('src/content/posts/') && trimmed.endsWith('.mdx')) {
        // Extract post id: "src/content/posts/cp-231-xxx.mdx" → "cp-231-xxx"
        const postId = trimmed.replace('src/content/posts/', '').replace('.mdx', '');
        versions[postId] = (versions[postId] ?? 0) + 1;
      }
    }
  } catch (err) {
    console.error('⚠️  git log failed — writing empty manifest:', err.message);
  }

  const count = Object.keys(versions).length;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(versions, null, 2) + '\n');
  const mergeHint = revs === 'HEAD MERGE_HEAD' ? ' (merge-aware)' : '';
  console.log(`✅ post-versions.json: ${count} posts tracked${mergeHint}`);
}

buildManifest();
