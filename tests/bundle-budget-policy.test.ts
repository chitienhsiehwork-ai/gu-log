import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'bundle-budget-check.mjs');
const SIZE_FIXTURE = {
  totalKB: 4,
  jsKB: 4,
  cssKB: 1,
  htmlKB: 0,
  imgKB: 0,
  otherKB: 0,
  fileCount: 1,
  routeCount: 0,
  jsCssFiles: [{ path: 'assets/app.js', sizeKB: 4 }],
  routes: {},
};

function runPolicy(policy: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-bundle-budget-policy-'));
  const scriptsDir = path.join(root, 'scripts');
  const qualityDir = path.join(root, 'quality');
  fs.mkdirSync(scriptsDir);
  fs.mkdirSync(qualityDir);
  fs.copyFileSync(SCRIPT_PATH, path.join(scriptsDir, 'bundle-budget-check.mjs'));
  fs.writeFileSync(
    path.join(scriptsDir, 'bundle-size.mjs'),
    `process.stdout.write(${JSON.stringify(JSON.stringify(SIZE_FIXTURE))});\n`
  );
  fs.writeFileSync(
    path.join(qualityDir, 'bundle-budget.json'),
    `${JSON.stringify(policy, null, 2)}\n`
  );

  try {
    return spawnSync(process.execPath, ['scripts/bundle-budget-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('bundle budget blocking policy', () => {
  it('accepts a finite numeric blocking threshold', () => {
    const result = runPolicy({
      version: 2,
      blocking: { global: { jsMaxKB: 8 } },
      trend: { global: {}, routes: {} },
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Blocking budgets passed');
  });

  it('keeps the legacy flat blocking policy compatible', () => {
    const result = runPolicy({
      jsMaxKB: 8,
      cssMaxKB: 2,
      singleFileMaxKB: 8,
      comment: 'legacy fixture',
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Blocking budgets passed');
  });

  it.each([
    [
      'a string threshold',
      {
        version: 2,
        blocking: { global: { jsMaxKB: '1' } },
        trend: { global: {}, routes: {} },
      },
      'blocking.global.jsMaxKB must be a finite number',
    ],
    [
      'an unknown threshold key',
      {
        version: 2,
        blocking: { global: { jsMaxKb: 1 } },
        trend: { global: {}, routes: {} },
      },
      'blocking.global has unknown key "jsMaxKb"',
    ],
    [
      'an unknown root key alongside a valid threshold',
      {
        version: 2,
        blocking: { global: { jsMaxKB: 8 } },
        trend: { global: {}, routes: {} },
        totlMaxKB: 1,
      },
      'budget root has unknown key "totlMaxKB"',
    ],
    [
      'a missing global blocking policy',
      {
        version: 2,
        blocking: {},
        trend: { global: {}, routes: {} },
      },
      'blocking.global must be an object',
    ],
    [
      'an empty global blocking policy',
      {
        version: 2,
        blocking: { global: {} },
        trend: { global: {}, routes: {} },
      },
      'blocking.global must define at least one blocking threshold',
    ],
  ])('fails closed for %s', (_label, policy, expectedError) => {
    const result = runPolicy(policy);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid bundle budget policy');
    expect(result.stderr).toContain(expectedError);
  });
});
