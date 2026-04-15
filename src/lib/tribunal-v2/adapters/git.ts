/**
 * Tribunal v2 — Git Adapter
 *
 * Implements PipelineConfig['git'] — creates tribunal branches, commits per
 * stage, and (for smoke test) logs squash-merge commands without executing.
 *
 * Per D2 in the runtime-wiring plan: squashMerge is log-only for now so a
 * failed smoke test can't pollute main. Flip `SQUASH_MERGE_MODE` to 'apply'
 * after the first successful end-to-end run.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SquashMergeMode = 'log-only' | 'apply';

/**
 * Default to log-only so the first smoke test never pollutes main.
 * Override with env var or the second arg to buildGitAdapter().
 */
const ENV_MODE = process.env.TRIBUNAL_V2_SQUASH_MERGE === 'apply' ? 'apply' : 'log-only';

export interface GitAdapter {
  createBranch(name: string): Promise<void>;
  /**
   * Commit `paths` (if any) with `message`. When `paths` is empty/omitted
   * or nothing is staged after `git add`, a `--allow-empty` marker commit
   * is created instead — keeping the tribunal audit trail complete without
   * sweeping in unrelated dirty worktree state (e.g. `.score-loop/progress/`
   * snapshots the CLI writes alongside the article).
   *
   * Returns the new commit hash.
   */
  commit(message: string, paths?: string[]): Promise<string>;
  squashMerge(branch: string, commitMessage: string): Promise<void>;
}

async function git(args: string[], cwd = process.cwd()): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

async function branchExists(name: string, cwd = process.cwd()): Promise<boolean> {
  try {
    await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function currentBranch(cwd = process.cwd()): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

/** True iff there are staged changes (index differs from HEAD). */
async function hasStagedChanges(cwd = process.cwd()): Promise<boolean> {
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd });
    return false;
  } catch {
    // `git diff --cached --quiet` exits 1 when there are staged changes
    return true;
  }
}

/**
 * Build a GitAdapter bound to a working directory.
 * @param cwd     Repo root (defaults to process.cwd())
 * @param mode    'log-only' | 'apply' for squashMerge. Defaults to env or log-only.
 */
export function buildGitAdapter(cwd = process.cwd(), mode: SquashMergeMode = ENV_MODE): GitAdapter {
  return {
    async createBranch(name) {
      if (await branchExists(name, cwd)) {
        // Idempotent — just switch to it
        await git(['checkout', name], cwd);
        return;
      }
      await git(['checkout', '-b', name], cwd);
    },

    async commit(message, paths) {
      // Only stage the explicit paths the pipeline owns. NEVER `git add -A`
      // — that sweeps in untracked scratch (progress snapshots, editor
      // temp files, unrelated developer changes) which would then get
      // squash-merged into main once apply mode is enabled.
      if (paths && paths.length > 0) {
        await git(['add', '--', ...paths], cwd);
      }

      if (await hasStagedChanges(cwd)) {
        await git(['commit', '-m', message], cwd);
      } else {
        // Marker commit — keeps the audit trail complete even when the
        // pipeline ran a stage with no file changes (revert + rejected,
        // judge PASS on clean file, loop exhausted).
        await git(['commit', '--allow-empty', '-m', message], cwd);
      }
      return git(['rev-parse', 'HEAD'], cwd);
    },

    async squashMerge(branch, commitMessage) {
      if (mode === 'log-only') {

        console.log(
          `[tribunal-v2/git] squashMerge (log-only): would squash-merge '${branch}' into main with message:\n---\n${commitMessage}\n---\n` +
            `To apply, re-run with TRIBUNAL_V2_SQUASH_MERGE=apply or pass mode='apply'.`,
        );
        return;
      }

      const before = await currentBranch(cwd);
      try {
        await git(['checkout', 'main'], cwd);
        await git(['merge', '--squash', branch], cwd);
        await git(['commit', '-m', commitMessage], cwd);
      } finally {
        // Return to the tribunal branch so subsequent ops stay consistent
        if (before !== 'main') await git(['checkout', before], cwd).catch(() => undefined);
      }
    },
  };
}
