/**
 * Compute post version numbers from git commit history.
 * Runs `git log` once for all posts and caches the result.
 * Version = number of commits touching that file.
 */
import { execSync } from 'node:child_process';

let cache: Record<string, number | null> | null = null;
let gitAvailable = true;

export function getPostVersion(postId: string): string {
  if (!cache) {
    cache = buildVersionCache();
  }
  if (!gitAvailable) return 'X';
  const key = `src/content/posts/${postId}.mdx`;
  const count = cache[key];
  return count ? String(count) : '1';
}

function buildVersionCache(): Record<string, number> {
  const versions: Record<string, number> = {};
  try {
    const out = execSync(
      'git log --name-only --pretty=format: -- src/content/posts/',
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith('src/content/posts/')) {
        versions[trimmed] = (versions[trimmed] ?? 0) + 1;
      }
    }
  } catch {
    // git unavailable (e.g. Vercel shallow clone) — flag it so UI shows "vX"
    gitAvailable = false;
  }
  return versions;
}
