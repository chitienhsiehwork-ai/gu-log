import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(import.meta.dirname, '../scripts/bundle-size.mjs');

function runAnalyzer(setupDist: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu log bundle size-'));
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(scriptsDir);
  fs.copyFileSync(SCRIPT_PATH, path.join(scriptsDir, 'bundle-size.mjs'));
  setupDist(root);

  try {
    return spawnSync(process.execPath, ['scripts/bundle-size.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('bundle size analyzer output contract', () => {
  it.each([
    ['missing dist directory', () => {}],
    [
      'dist path that is not a directory',
      (root: string) => fs.writeFileSync(path.join(root, 'dist'), 'not a directory'),
    ],
  ])('fails closed for %s', (_label, setupDist) => {
    const result = runAnalyzer(setupDist);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Bundle size analysis failed: unable to scan dist/');
  });

  it('fails closed for an empty dist directory', () => {
    const result = runAnalyzer((root) => fs.mkdirSync(path.join(root, 'dist')));

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Bundle size analysis failed: dist/ contains no files');
  });

  it('emits bundle metrics for a non-empty dist directory', () => {
    const result = runAnalyzer((root) => {
      const dist = path.join(root, 'dist');
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(dist, 'index.html'), 'x'.repeat(2048));
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const metrics = JSON.parse(result.stdout);
    expect(metrics).toMatchObject({
      totalKB: 2,
      htmlKB: 2,
      fileCount: 1,
      routeCount: 1,
      routes: { '/': 2 },
    });
  });
});
