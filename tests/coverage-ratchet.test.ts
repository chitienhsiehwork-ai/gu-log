import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const temporaryDirectories: string[] = [];

function counters(total: number, covered: number): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: total }, (_, index) => [String(index), index < covered ? 1 : 0])
  );
}

function makeFixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'coverage-ratchet-'));
  temporaryDirectories.push(root);
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  mkdirSync(resolve(root, 'quality', 'coverage', 'coverage'), { recursive: true });

  for (const script of [
    'coverage-ratchet.sh',
    'coverage-summarize.mjs',
    'record-coverage-history.sh',
  ]) {
    copyFileSync(resolve(REPO_ROOT, 'scripts', script), resolve(root, 'scripts', script));
  }

  writeFileSync(
    resolve(root, 'quality', 'coverage-baseline.json'),
    `${JSON.stringify(
      {
        date: '2026-01-01',
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      null,
      2
    )}\n`
  );
  writeFileSync(resolve(root, 'quality', 'coverage-history.json'), '[]\n');
  writeFileSync(
    resolve(root, 'quality', 'coverage', 'coverage', 'coverage.json'),
    `${JSON.stringify({
      '/fixture.js': {
        s: counters(100, 81),
        f: counters(100, 80),
        b: { 0: Object.values(counters(100, 76)) },
      },
    })}\n`
  );

  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('coverage ratchet baseline integrity', () => {
  it('ratchets each metric independently without lowering a regressed metric', () => {
    const root = makeFixture();

    const result = spawnSync('bash', ['scripts/coverage-ratchet.sh'], {
      cwd: root,
      encoding: 'utf-8',
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(resolve(root, 'quality', 'coverage-baseline.json'), 'utf-8'))
    ).toMatchObject({
      statements: 81,
      branches: 80,
      functions: 80,
      lines: 81,
    });
    expect(
      JSON.parse(readFileSync(resolve(root, 'quality', 'coverage-history.json'), 'utf-8'))
    ).toEqual([
      expect.objectContaining({
        statements: 81,
        branches: 76,
        functions: 80,
        lines: 81,
      }),
    ]);
  });
});
