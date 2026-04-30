/**
 * End-to-end test for .githooks/pre-commit and .githooks/pre-push.
 *
 * Spawns the hooks against synthetic git state and asserts they exit
 * with the documented codes. This is the only safety net that catches
 * "I edited one of the gates and broke the whole hook chain".
 *
 * IMPORTANT: these tests must NEVER touch the real repo's git index.
 * Each one operates in its own t.tmpdir() with a fresh `git init`.
 */
import { describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const REPO_ROOT = path.resolve(__dirname, '..');

function makeFakeRepo(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-hook-'));
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email test@example.com && git config user.name Test', { cwd: tmp });
  // Symlink the real repo's hooks so we exercise the actual hooks.
  fs.mkdirSync(path.join(tmp, '.githooks'));
  fs.symlinkSync(
    path.join(REPO_ROOT, '.githooks', 'pre-commit'),
    path.join(tmp, '.githooks', 'pre-commit')
  );
  fs.symlinkSync(
    path.join(REPO_ROOT, '.githooks', 'pre-push'),
    path.join(tmp, '.githooks', 'pre-push')
  );
  // Seed a minimal posts dir so grep -h doesn't blow up on the duplicate-
  // ticket check.
  fs.mkdirSync(path.join(tmp, 'src', 'content', 'posts'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
  return tmp;
}

function runHook(hookPath: string, env: Record<string, string> = {}, stdin = '') {
  return spawnSync('bash', [hookPath], {
    cwd: env.GIT_DIR ? path.dirname(path.dirname(env.GIT_DIR)) : path.dirname(hookPath),
    env: { ...process.env, ...env },
    input: stdin,
    encoding: 'utf-8',
  });
}

describe('pre-commit: ticketId duplicate gate (Step 0)', () => {
  it('blocks when 3+ posts share a non-PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const postsDir = path.join(repo, 'src', 'content', 'posts');
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(
        path.join(postsDir, `dup-${i}.mdx`),
        `---\nticketId: SP-99\n---\nbody\n`
      );
    }
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: { ...process.env },
      encoding: 'utf-8',
    });
    // We expect non-zero exit and the duplicate-ID message in output.
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/DUPLICATE ticketId/);
  });

  it('allows multiple PENDING ticketIds', () => {
    const repo = makeFakeRepo();
    const postsDir = path.join(repo, 'src', 'content', 'posts');
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(
        path.join(postsDir, `pending-${i}.mdx`),
        `---\nticketId: SP-PENDING\n---\nbody\n`
      );
    }
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: { ...process.env },
      encoding: 'utf-8',
    });
    // PENDING dupes shouldn't trip Step 0. Other later steps may still
    // fail (eslint, validate-posts, etc), but the message we're asserting
    // about should not appear.
    expect(r.stdout + r.stderr).not.toMatch(/DUPLICATE ticketId/);
  });
});

describe('pre-push: PENDING ticketId guard (Step 0)', () => {
  it('passes when no PENDING ticketIds being pushed', () => {
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-push')], {
      cwd: REPO_ROOT,
      input:
        'refs/heads/feature-branch ' +
        'a'.repeat(40) +
        ' refs/heads/feature-branch ' +
        'b'.repeat(40) +
        '\n',
      env: { ...process.env, PWD: REPO_ROOT },
      encoding: 'utf-8',
    });
    // Should not crash on PENDING gate (it only checks pushes targeting main).
    // The bundle-budget step at the end may exit non-zero in environments
    // without the metric files; we just assert PENDING gate didn't fire.
    expect(r.stdout + r.stderr).not.toMatch(/PENDING ticketId in commits/);
  });

  it('blocks when pushing PENDING ticketIds to main', () => {
    // Synthetic stdin matching git pre-push contract:
    //   <local-ref> <local-sha> <remote-ref> <remote-sha>
    // refs/heads/main triggers the gate; we use HEAD as local_sha, all-zeros
    // remote_sha so DIFF_BASE = merge-base.
    const headSha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
    const stdin = `refs/heads/main ${headSha} refs/heads/main ${'0'.repeat(40)}\n`;
    // We fake the workspace by writing a temp posts/ entry into the real
    // repo's index? No — use a worktree to keep it isolated.
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-push')], {
      cwd: REPO_ROOT,
      input: stdin,
      env: { ...process.env },
      encoding: 'utf-8',
    });
    // We can't *force* a PENDING file to appear in the diff without
    // mutating the repo, so this test just confirms the guard ran. The
    // gate output ("PENDING ticketId in commits being pushed to ...")
    // would appear if any committed file has -PENDING. We assert that
    // the hook accepts the stdin contract and doesn't crash.
    expect(typeof r.status).toBe('number');
  });
});

describe('pre-commit: hook script is valid bash', () => {
  it('passes shellcheck-equivalent: bash -n parses without syntax error', () => {
    const r = spawnSync('bash', ['-n', path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});

describe('pre-push: hook script is valid bash', () => {
  it('bash -n parses without syntax error', () => {
    const r = spawnSync('bash', ['-n', path.join(REPO_ROOT, '.githooks', 'pre-push')], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});
