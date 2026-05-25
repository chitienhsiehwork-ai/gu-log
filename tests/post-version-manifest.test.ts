import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf-8' });
}

function ensureFullGitHistory(cwd: string): void {
  const isShallow = run('git', ['rev-parse', '--is-shallow-repository'], cwd).trim();
  if (isShallow === 'true') {
    run('git', ['fetch', '--unshallow', '--filter=blob:none', 'origin'], cwd);
  }
}

function makeSyntheticRepo(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-manifest-'));
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'data'), { recursive: true });

  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'build-version-manifest.mjs'),
    path.join(tmp, 'scripts', 'build-version-manifest.mjs')
  );

  run('git', ['init', '-q'], tmp);
  run('git', ['config', 'user.email', 'test@example.com'], tmp);
  run('git', ['config', 'user.name', 'Test'], tmp);

  fs.writeFileSync(path.join(tmp, 'src', 'content', 'posts', 'sp-999-regression.mdx'), '---\ntitle: test\n---\nbody\n');
  fs.writeFileSync(path.join(tmp, 'src', 'data', 'post-versions.json'), '{}\n');
  run('git', ['add', '.'], tmp);
  run('git', ['commit', '-qm', 'seed post'], tmp);

  return tmp;
}

describe('post version manifest freshness', () => {
  it('fails when the committed manifest is stale relative to full git history', () => {
    const repo = makeSyntheticRepo();
    const result = spawnSync('node', ['scripts/build-version-manifest.mjs', '--check'], {
      cwd: repo,
      encoding: 'utf-8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('post-versions.json is stale');
  });

  it('keeps the production manifest fresh for Vercel shallow builds', () => {
    ensureFullGitHistory(REPO_ROOT);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs', '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('post-versions.json fresh');
  }, 60_000);
});
