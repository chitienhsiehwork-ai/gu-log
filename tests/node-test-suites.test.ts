import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SUITE_DIRECTORIES = [
  path.join(ROOT, 'tests'),
  path.join(ROOT, 'src', 'plugins', '__tests__'),
] as const;

function discoverNativeNodeSuites(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return discoverNativeNodeSuites(entryPath);
    }

    return entry.isFile() && entry.name.endsWith('.test.mjs') ? [entryPath] : [];
  });
}

describe('native Node test ownership', () => {
  it('recursively discovers nested suites without following non-directory entries', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'gu-log-node-test-discovery-'));
    const nestedDirectory = path.join(fixtureRoot, 'nested');
    const nestedSuite = path.join(nestedDirectory, 'fixture.test.mjs');
    mkdirSync(nestedDirectory);
    writeFileSync(nestedSuite, '');

    try {
      expect(discoverNativeNodeSuites(fixtureRoot)).toEqual([nestedSuite]);
    } finally {
      rmSync(fixtureRoot, { recursive: true });
    }
  });

  it('runs every *.test.mjs suite from the registered roots in blocking CI', () => {
    const suites = SUITE_DIRECTORIES.flatMap(discoverNativeNodeSuites).sort();

    expect(suites.length).toBeGreaterThan(0);

    const result = spawnSync(process.execPath, ['--test', ...suites], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: 10_000,
    });
    const diagnostics = [
      `error: ${result.error?.message ?? 'none'}`,
      `status: ${result.status ?? 'null'}`,
      `signal: ${result.signal ?? 'none'}`,
      'stdout:',
      result.stdout,
      'stderr:',
      result.stderr,
    ].join('\n');

    expect(result.error, diagnostics).toBeUndefined();
    expect(result.status, diagnostics).toBe(0);
  }, 15_000);
});
