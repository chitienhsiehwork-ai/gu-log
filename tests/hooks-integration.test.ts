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

function makeFastHookEnv(): NodeJS.ProcessEnv {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-hook-bin-'));
  for (const name of ['gitleaks', 'node', 'npx']) {
    const tool = path.join(bin, name);
    fs.writeFileSync(tool, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(tool, 0o755);
  }
  return { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
}

function commitAll(repo: string, message: string): string {
  execSync('git add -A', { cwd: repo });
  execSync(`git commit -q -m "${message}"`, { cwd: repo });
  return execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
}

function writePost(repo: string, filename: string, ticketId: string): void {
  fs.writeFileSync(
    path.join(repo, 'src', 'content', 'posts', filename),
    `---\nticketId: ${ticketId}\n---\nbody\n`
  );
}

function runPrePush(repo: string, stdin: string) {
  return spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-push')], {
    cwd: repo,
    input: stdin,
    env: makeFastHookEnv(),
    encoding: 'utf-8',
  });
}

describe('pre-commit: ticketId duplicate gate (Step 0)', () => {
  it('blocks when 3+ posts share a non-PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const postsDir = path.join(repo, 'src', 'content', 'posts');
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(postsDir, `dup-${i}.mdx`), `---\nticketId: SP-99\n---\nbody\n`);
    }
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: makeFastHookEnv(),
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
      env: makeFastHookEnv(),
      encoding: 'utf-8',
    });
    // PENDING dupes shouldn't trip Step 0. Other later steps may still
    // fail (eslint, validate-posts, etc), but the message we're asserting
    // about should not appear. CI can spend a few extra seconds in the
    // later hook chain, so keep this assertion's timeout above Vitest's
    // default instead of making the duplicate-gate test flaky.
    expect(r.stdout + r.stderr).not.toMatch(/DUPLICATE ticketId/);
  }, 15_000);
});

describe('pre-push: PENDING ticketId guard (Step 0) — real committed diff', () => {
  it('rejects a push to main whose committed diff carries a PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'sp-pending.mdx', 'SP-PENDING');
    const headSha = commitAll(repo, 'add pending post');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(
      /PENDING ticketId in commits being pushed to refs\/heads\/main/
    );
    expect(r.stdout + r.stderr).toMatch(/sp-pending\.mdx/);
  });

  it('allows the exact same committed PENDING work when pushed to a feature branch', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'sp-pending.mdx', 'SP-PENDING');
    const headSha = commitAll(repo, 'add pending post');

    const stdin = `refs/heads/feature-x ${headSha} refs/heads/feature-x ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.stdout + r.stderr).not.toMatch(/PENDING ticketId in commits/);
    expect(r.status).toBe(0);
  }, 15_000);

  it('still blocks on a brand-new remote main ref (remote_sha all-zeros)', () => {
    // Regression test: DIFF_BASE for a brand-new remote branch used to be
    // computed as `git merge-base "$local_sha" HEAD`, but HEAD is normally
    // the same commit as local_sha in this scenario, so the merge-base
    // collapsed to local_sha itself and produced an empty diff — silently
    // no-opping the guard for this push shape. Fixed to diff against the
    // actual origin/<branch> tip instead.
    const repo = makeFakeRepo();
    commitAll(repo, 'base');

    const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-hook-origin-'));
    execSync(`git init -q --bare "${originDir}"`);
    execSync(`git remote add origin "${originDir}"`, { cwd: repo });
    execSync('git push -q origin HEAD:refs/heads/main', { cwd: repo });

    writePost(repo, 'sp-pending.mdx', 'SP-PENDING');
    const headSha = commitAll(repo, 'add pending post');
    execSync('git fetch -q origin', { cwd: repo });

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${'0'.repeat(40)}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/PENDING ticketId in commits/);
  });

  it('passes a push to main with a real committed diff and no PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'sp-real.mdx', 'SP-42');
    const headSha = commitAll(repo, 'add real post');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.stdout + r.stderr).not.toMatch(/PENDING ticketId in commits/);
    expect(r.status).toBe(0);
  }, 15_000);
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
