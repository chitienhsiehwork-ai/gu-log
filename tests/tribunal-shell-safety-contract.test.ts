import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = path.join(ROOT, 'scripts/tests/test-tribunal-safety-contract.sh');
const RUNNER_ERROR_GUARD = path.join(ROOT, 'scripts/tests/test-tribunal-runner-error-guard.sh');
const DEPLOY_READINESS = path.join(ROOT, 'scripts/tests/test-tribunal-deploy-readiness.sh');
const RUN_CONTROL_CLAIMS = path.join(ROOT, 'scripts/tests/test-tribunal-run-control-claims.sh');
const linuxIt = process.platform === 'linux' ? it : it.skip;

function runShellTest(script: string, timeout: number) {
  return spawnSync('bash', [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout,
    killSignal: 'SIGKILL',
  });
}

describe('Tribunal shell safety contract', () => {
  it('passes the blocking shell contract', () => {
    const result = runShellTest(CONTRACT, 30_000);

    expect(result.error, result.stdout + result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 35_000);

  linuxIt(
    'fails closed on runner and provenance infrastructure errors',
    () => {
      const result = runShellTest(RUNNER_ERROR_GUARD, 90_000);

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
    95_000
  );

  linuxIt(
    'serializes stale-claim recovery across concurrent supervisors',
    () => {
      const result = runShellTest(RUN_CONTROL_CLAIMS, 20_000);

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
    25_000
  );

  it('passes deployment readiness after the tracked-fixture runner releases its lock', () => {
    const result = runShellTest(DEPLOY_READINESS, 30_000);

    expect(result.error, result.stdout + result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 35_000);
});
