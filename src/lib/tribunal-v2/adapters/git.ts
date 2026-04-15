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
import { relative, isAbsolute } from 'node:path';

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

/** Repo-relative paths currently in the git index (NUL-separated). */
async function getStagedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only', '-z'], {
    cwd,
  });
  return stdout.split('\0').filter(Boolean);
}

/** Normalize an arbitrary commit path to repo-relative form (matches git output). */
function normalizePath(cwd: string, p: string): string {
  return isAbsolute(p) ? relative(cwd, p) : p;
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
      const expected = new Set((paths ?? []).map((p) => normalizePath(cwd, p)));

      if (paths && paths.length > 0) {
        await git(['add', '--', ...paths], cwd);
      }

      // Belt-and-suspenders: assert the index only contains files the
      // pipeline declared. This catches BOTH pre-staged dirt from before
      // the pipeline started AND any accidental collateral from our own
      // `git add`. Without this guard, a dev who happened to have staged
      // unrelated files before running tribunal would see those files
      // land on the tribunal branch and — in apply mode — in main.
      const staged = await getStagedFiles(cwd);
      const unexpected = staged.filter((f) => !expected.has(f));
      if (unexpected.length > 0) {
        const head = unexpected.slice(0, 5).join(', ');
        const tail = unexpected.length > 5 ? ` (+${unexpected.length - 5} more)` : '';
        const declared = expected.size === 0 ? '(none)' : [...expected].join(', ');
        throw new Error(
          `tribunal commit refused: git index contains unexpected files ` +
            `not declared by the pipeline: ${head}${tail}. ` +
            `Declared pathspec: [${declared}]. ` +
            `Reset the index with \`git reset HEAD --\` or pass the correct pathspec.`
        );
      }

      if (staged.length > 0) {
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
