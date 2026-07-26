import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = path.join(ROOT, 'scripts/tests/test-tribunal-safety-contract.sh');
const RUNNER_ERROR_GUARD = path.join(ROOT, 'scripts/tests/test-tribunal-runner-error-guard.sh');

function runShellTest(script: string) {
  return spawnSync('bash', [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

describe('Tribunal shell safety contract', () => {
  it('passes the blocking shell contract', () => {
    const result = runShellTest(CONTRACT);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 20_000);

  it('fails closed on runner and provenance infrastructure errors', () => {
    const result = runShellTest(RUNNER_ERROR_GUARD);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 30_000);
});
