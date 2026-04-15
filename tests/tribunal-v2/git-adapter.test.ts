/**
 * Tribunal v2 — Git adapter contract tests.
 *
 * Proves the two hardening guarantees:
 *
 * 1. `commit(msg, [articlePath])` stages ONLY the declared pathspec —
 *    unrelated dirty worktree state (scratch files, editor temps,
 *    `.score-loop/progress/*.json`) stays OUT of the tribunal branch.
 * 2. `commit(msg)` (no paths) creates an empty marker commit even when
 *    the worktree is dirty — audit trail without sweeping debris.
 *
 * Runs against an ephemeral git repo in tmp so the real adapter is
 * exercised end-to-end (no mocks).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildGitAdapter } from '../../src/lib/tribunal-v2/adapters/git';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout.trim();
}

/**
 * `git status --porcelain` collapses untracked *directories* into a single
 * `?? dir/` entry by default. Pass `-uall` to list every untracked file
 * individually AND preserve raw formatting (no trim() — we want to assert
 * on the leading ` M` / `?? ` status characters).
 */
async function porcelainStatus(cwd: string): Promise<string> {
  const { stdout } = await exec('git', ['status', '--porcelain', '-uall'], { cwd });
  return stdout;
}

async function initTmpRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tribunal-v2-git-'));
  await git(cwd, ['init', '-q', '--initial-branch=main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Tribunal Test']);
  await git(cwd, ['commit', '--allow-empty', '-m', 'seed']);
  return cwd;
}

/** Files changed in HEAD commit. */
async function filesInHead(cwd: string): Promise<string[]> {
  const raw = await git(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  return raw.split('\n').filter(Boolean);
}

describe('git adapter — explicit pathspec commits (Codex P1 fix)', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await initTmpRepo();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('stages only the declared pathspec, not other dirty files', async () => {
    const adapter = buildGitAdapter(cwd, 'log-only');

    // Write article (the file the pipeline owns) AND two decoys:
    // (a) `.score-loop/progress/cp-xyz.json` — the progress-file attack surface
    //     Codex called out; (b) a developer scratch note.
    const articlePath = join(cwd, 'article.mdx');
    await writeFile(articlePath, '---\ntitle: seed\n---\nhello\n', 'utf-8');

    const progressDir = join(cwd, '.score-loop', 'progress');
    await exec('mkdir', ['-p', progressDir]);
    await writeFile(join(progressDir, 'cp-xyz.json'), '{"stage":"running"}', 'utf-8');
    await writeFile(join(cwd, 'scratch.txt'), 'developer notes', 'utf-8');

    await adapter.commit('tribunal(stage1): Vibe writer rewrite', [articlePath]);

    const tracked = await filesInHead(cwd);
    expect(tracked).toEqual(['article.mdx']);
    expect(tracked).not.toContain('.score-loop/progress/cp-xyz.json');
    expect(tracked).not.toContain('scratch.txt');

    // Decoys must still exist on disk but remain untracked.
    const status = await porcelainStatus(cwd);
    expect(status).toContain('?? .score-loop/progress/cp-xyz.json');
    expect(status).toContain('?? scratch.txt');
  });

  it('creates an empty marker commit when no paths are given, ignoring dirty worktree', async () => {
    const adapter = buildGitAdapter(cwd, 'log-only');

    const articlePath = join(cwd, 'article.mdx');
    await writeFile(articlePath, 'first version\n', 'utf-8');
    await adapter.commit('tribunal(stage0): seed', [articlePath]);

    // Now write dirt into the worktree but commit WITHOUT a pathspec — this
    // is the 'writer rejected' / 'FAIL max loops' code path in pipeline.ts.
    await writeFile(articlePath, 'dirty uncommitted edits\n', 'utf-8');
    await writeFile(join(cwd, 'stray.tmp'), 'editor temp', 'utf-8');

    await adapter.commit('tribunal(stage1): writer rejected (constraint violations)');

    // Marker commit must land, but with NO tracked file changes.
    const tracked = await filesInHead(cwd);
    expect(tracked).toEqual([]);

    // The dirty edits and stray file are still sitting in the worktree,
    // untouched — ready for the next loop to pick up or for a subsequent
    // revert to reset.
    const status = await porcelainStatus(cwd);
    expect(status).toContain(' M article.mdx');
    expect(status).toContain('?? stray.tmp');
  });

  it('is idempotent when the declared path has no changes (empty marker commit)', async () => {
    const adapter = buildGitAdapter(cwd, 'log-only');

    const articlePath = join(cwd, 'article.mdx');
    await writeFile(articlePath, 'content\n', 'utf-8');
    await adapter.commit('seed', [articlePath]);

    // Second call with same path but no content change — should still
    // produce a marker commit rather than throw or silently skip.
    const before = await git(cwd, ['rev-parse', 'HEAD']);
    await adapter.commit('tribunal(stage1): Vibe — PASS @ loop 1/3', [articlePath]);
    const after = await git(cwd, ['rev-parse', 'HEAD']);

    expect(after).not.toBe(before); // new commit was created
    const tracked = await filesInHead(cwd);
    expect(tracked).toEqual([]); // but it's empty
  });
});
