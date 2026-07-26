import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SHELL_TEST_DIR = path.join(ROOT, 'scripts', 'tests');

// These contracts already have focused Vitest bridges with tailored assertions
// and timeouts. Keep them in this registry so a new shell test cannot silently
// remain outside every blocking CI owner.
const DEDICATED_CONTRACTS = [
  'test-session-start-context.sh',
  'test-tribunal-runner-error-guard.sh',
  'test-tribunal-safety-contract.sh',
] as const;

const PORTABLE_CONTRACTS = [
  'test-auto-merge-guard.sh',
  'test-check-links-error-handling.sh',
  'test-frontmatter-scores-v8.sh',
  'test-nightly-baseline-stage.sh',
  'test-quota-controller.sh',
  'test-setup-hooks-worktree.sh',
  'test-tribunal-batch-provider-quota.sh',
  'test-tribunal-deploy-readiness.sh',
  'test-tribunal-pass-artifact-guards.sh',
  'test-tribunal-progress-ledger-migration.sh',
  'test-tribunal-publish-worker-changes.sh',
  'test-tribunal-publisher-autopilot.sh',
  'test-tribunal-publisher-gh-auth-fallback.sh',
  'test-tribunal-runtime-git-hygiene.sh',
  'test-tribunal-shell-quota-parser.sh',
  'test-tribunal-worker-sync-ref.sh',
  'test-writer-broker.sh',
] as const;

// The production scripts exercise associative arrays/mapfile and run on the
// Linux Tribunal VM. GitHub Actions supplies Bash 5; macOS system Bash 3 must
// report these as skipped instead of producing false portability failures.
const BASH4_CONTRACTS = [
  'test-tribunal-openai-quota-controller.sh',
  'test-tribunal-publisher.sh',
] as const;

const bashVersion = spawnSync('bash', ['-c', 'printf %s "${BASH_VERSINFO[0]}"'], {
  encoding: 'utf8',
});
const bashMajor = Number.parseInt(bashVersion.stdout, 10);
const bash4It = bashMajor >= 4 ? it : it.skip;

function runShellContract(filename: string) {
  return spawnSync('bash', [path.join(SHELL_TEST_DIR, filename)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 45_000,
  });
}

describe('shell regression ownership', () => {
  it('assigns every scripts/tests shell contract to a blocking Vitest owner', () => {
    const discovered = readdirSync(SHELL_TEST_DIR)
      .filter((filename) => filename.startsWith('test-') && filename.endsWith('.sh'))
      .sort();
    const owned = [...DEDICATED_CONTRACTS, ...PORTABLE_CONTRACTS, ...BASH4_CONTRACTS].sort();

    expect(owned).toEqual(discovered);
  });

  it.each(PORTABLE_CONTRACTS)(
    '%s passes',
    (filename) => {
      const result = runShellContract(filename);

      expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    },
    50_000
  );

  bash4It.each(BASH4_CONTRACTS)(
    '%s passes on the Linux/Bash 4+ Tribunal runtime',
    (filename) => {
      const result = runShellContract(filename);

      expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    },
    50_000
  );
});
