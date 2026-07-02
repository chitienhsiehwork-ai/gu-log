import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf-8' });
}

function repoWithFullGitHistory(cwd: string): string {
  const isShallow = run('git', ['rev-parse', '--is-shallow-repository'], cwd).trim();
  if (isShallow !== 'true') return cwd;

  // Do not unshallow the test runner's checkout in-place. Vitest runs files in
  // parallel, and mutating .git here can make hook integration tests hang.
  const origin = run('git', ['remote', 'get-url', 'origin'], cwd).trim();
  const headRef = process.env.GITHUB_HEAD_REF;
  const refName = process.env.GITHUB_REF_NAME;
  const currentBranch = run('git', ['branch', '--show-current'], cwd).trim();
  const headSha = run('git', ['rev-parse', 'HEAD'], cwd).trim();
  const candidates = [headRef, refName, currentBranch, `origin/${currentBranch}`, headSha].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  let lastError: unknown;
  for (const ref of candidates) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-full-'));
    try {
      run(
        'git',
        ['clone', '--filter=blob:none', '--single-branch', '--branch', ref, origin, tmp],
        cwd
      );
      return tmp;
    } catch (error) {
      fs.rmSync(tmp, { recursive: true, force: true });
      lastError = error;
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-full-'));
  try {
    run('git', ['clone', '--no-local', cwd, tmp], cwd);
    run('git', ['fetch', '--unshallow', 'origin'], tmp);
    return tmp;
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    lastError = error;
  }

  throw lastError;
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

  fs.writeFileSync(
    path.join(tmp, 'src', 'content', 'posts', 'sp-999-regression.mdx'),
    '---\ntitle: test\n---\nbody\n'
  );
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
    const repo = repoWithFullGitHistory(REPO_ROOT);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs', '--check'], {
      cwd: repo,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('post-versions.json fresh');
  }, 60_000);
});

describe('reader-facing revision manifest', () => {
  it('changes when reader-visible body changes', async () => {
    const { computeReaderRevisionFromContent } =
      await import('../scripts/build-reader-revision-manifest.mjs');
    const before = '---\ntitle: Test\nscores:\n  tribunalVersion: 3\n---\nBody A\n';
    const after = '---\ntitle: Test\nscores:\n  tribunalVersion: 3\n---\nBody B\n';

    expect(computeReaderRevisionFromContent(before)).not.toBe(
      computeReaderRevisionFromContent(after)
    );
  });

  it('does not change for backend-only score metadata', async () => {
    const { computeReaderRevisionFromContent } =
      await import('../scripts/build-reader-revision-manifest.mjs');
    const before =
      '---\ntitle: Test\nscores:\n  tribunalVersion: 3\n  vibe:\n    score: 7\n---\nSame body\n';
    const after =
      '---\ntitle: Test\nscores:\n  tribunalVersion: 4\n  vibe:\n    score: 9\n---\nSame body\n';

    expect(computeReaderRevisionFromContent(before)).toBe(computeReaderRevisionFromContent(after));
  });
});
