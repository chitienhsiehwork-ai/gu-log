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
  commit(message: string): Promise<string>;
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

async function hasStagedOrUnstagedChanges(cwd = process.cwd()): Promise<boolean> {
  try {
    // Exit 1 if diff, exit 0 if clean
    await execFileAsync('git', ['diff', '--quiet'], { cwd });
    await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd });
    // Also check untracked files (porcelain picks them up)
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
    return stdout.trim().length > 0;
  } catch {
    // `git diff --quiet` exits 1 when there are changes
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

    async commit(message) {
      // Skip if nothing to commit — some stages (judge PASS without rewrite)
      // might end up clean after we already committed changes earlier.
      if (!(await hasStagedOrUnstagedChanges(cwd))) {
        // Record an empty commit so the tribunal audit trail is complete.
        await git(['commit', '--allow-empty', '-m', message], cwd);
        return git(['rev-parse', 'HEAD'], cwd);
      }
      await git(['add', '-A'], cwd);
      await git(['commit', '-m', message], cwd);
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
