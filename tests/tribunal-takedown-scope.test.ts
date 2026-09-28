/**
 * Tribunal scope is decided by status (openspec: tribunal-verification-scope,
 * post-takedown): a taken-down post is refused before any judge runs, by every
 * entry point, with the plain failure code 1 — never 78 (the loops drain on
 * "needs operator action") or 75 (they consult the QUOTA_SUSPENDED ledger).
 * Candidate selection and the batch stop rule are covered by
 * scripts/tests/test-tribunal-batch-provider-quota.sh; gp-pipeline ralph by
 * tools/gp-pipeline/internal/pipeline/ralph_test.go.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { useTestTempDirectories } from './helpers/temp-directories';

const ROOT = path.resolve(__dirname, '..');
const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
const TAKEN_DOWN_POST =
  '---\nticketId: "GP-63"\nstatus: "taken-down"\ntakenDownAt: "2026-09-27"\n---\n';

describe('Tribunal refuses taken-down posts before any judge', () => {
  it('scripts/tribunal.sh exits 1 without running a stage', () => {
    const root = makeTempDirectory('gu-log-tribunal-scope-');
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
    for (const file of [
      'tribunal.sh',
      'score-helpers.sh',
      'tribunal-helpers.sh',
      'tribunal-model-router.sh',
      'tribunal-run-control.sh',
      'tribunal-version.mjs',
    ]) {
      fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(root, 'scripts', file));
    }
    fs.writeFileSync(path.join(root, 'src/content/posts/gp-63-taken-down.mdx'), TAKEN_DOWN_POST);

    const result = spawnSync('bash', ['scripts/tribunal.sh', 'gp-63-taken-down.mdx'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toContain('is taken-down; it is outside Tribunal scope');
    // Refused before the run log (and therefore any stage) was opened.
    expect(fs.existsSync(path.join(root, '.score-loop', 'logs'))).toBe(false);
  });

  it('scripts/tribunal-v2-run.ts exits 1 before building the pipeline', () => {
    const dir = makeTempDirectory('gu-log-tribunal-v2-scope-');
    const article = path.join(dir, 'gp-63-taken-down.mdx');
    fs.writeFileSync(article, TAKEN_DOWN_POST);

    const result = spawnSync(
      path.join(ROOT, 'node_modules/.bin/tsx'),
      [path.join(ROOT, 'scripts/tribunal-v2-run.ts'), article],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000 }
    );

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toContain('is taken-down; it is outside Tribunal scope');
    expect(result.stdout).not.toContain('starting pipeline');
  });
});
