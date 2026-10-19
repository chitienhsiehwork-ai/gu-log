import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONTRACTS = [
  {
    label: 'snapshot policy',
    command: 'python3',
    script: 'scripts/tests/test-tribunal-fact-summary-policy.py',
  },
  {
    label: 'stage routing',
    command: 'bash',
    script: 'scripts/tests/test-tribunal-fact-summary-routing.sh',
  },
] as const;

describe('Tribunal FactChecker summary policy', () => {
  it.each(CONTRACTS)(
    'passes the blocking $label contract',
    ({ command, script }) => {
      const result = spawnSync(command, [path.join(ROOT, script)], {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env,
        timeout: 45_000,
        killSignal: 'SIGKILL',
      });

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
    50_000
  );
});
