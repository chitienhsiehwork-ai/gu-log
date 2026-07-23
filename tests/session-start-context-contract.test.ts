import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = path.join(ROOT, 'scripts/tests/test-session-start-context.sh');

describe('Codex/Claude SessionStart context contract', () => {
  it('injects explicit-runtime compact context and preserves CCC provisioning', () => {
    const result = spawnSync('bash', [CONTRACT], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Codex/Claude SessionStart context contract tests passed');
  });
});
