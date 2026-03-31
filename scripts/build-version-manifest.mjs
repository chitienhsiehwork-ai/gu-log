#!/usr/bin/env node
/**
 * build-version-manifest.mjs
 *
 * Counts git commits per post file and writes src/data/post-versions.json.
 * Run before `astro build` so Vercel (shallow clone) gets correct version numbers.
 *
 * Output format: { "cp-231-20260331-pawelhuryn-vibe-engineering-vibe-coding": 3, ... }
 * Key = post id (filename without .mdx), Value = commit count.
 */
/* eslint-disable no-undef */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'src', 'data', 'post-versions.json');

function buildManifest() {
  const versions = {};

  try {
    const out = execSync('git log --name-only --pretty=format: -- src/content/posts/', {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
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
  console.log(`✅ post-versions.json: ${count} posts tracked`);
}

buildManifest();
