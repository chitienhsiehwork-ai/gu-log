import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../scripts/record-coverage-history.sh');
const temporaryDirectories: string[] = [];

const entry = (date: string, statements: number) => ({
  date,
  statements,
  branches: 30,
  functions: 35,
  lines: statements,
});

function makeHistoryFile(historyText: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'coverage-history-'));
  temporaryDirectories.push(directory);
  const filePath = resolve(directory, 'history.json');
  writeFileSync(filePath, historyText);
  return filePath;
}

function record(filePath: string, value: ReturnType<typeof entry>): void {
  execFileSync('bash', [SCRIPT, filePath, JSON.stringify(value)]);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('coverage history recording', () => {
  it('preserves the first same-day measurement byte-for-byte even when a rerun jitters', () => {
    const original = `[
  {
    "date": "2026-02-12",
    "statements": 74.63,
    "branches": 42.99,
    "functions": 37.50,
    "lines": 86.62
  },
  {
    "date": "2026-07-23",
    "statements": 55,
    "branches": 30,
    "functions": 35,
    "lines": 55
  }
]
`;
    const filePath = makeHistoryFile(original);

    record(filePath, entry('2026-07-23', 57));

    expect(readFileSync(filePath, 'utf8')).toBe(original);
  });

  it('collapses duplicate dates to their first measurement and becomes byte-stable', () => {
    const filePath = makeHistoryFile(
      `${JSON.stringify(
        [entry('2026-07-22', 54), entry('2026-07-23', 55), entry('2026-07-23', 56)],
        null,
        2
      )}\n`
    );

    record(filePath, entry('2026-07-23', 57));

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([
      entry('2026-07-22', 54),
      entry('2026-07-23', 55),
    ]);

    const cleaned = readFileSync(filePath, 'utf8');
    record(filePath, entry('2026-07-23', 58));
    expect(readFileSync(filePath, 'utf8')).toBe(cleaned);
  });

  it('cleans duplicates from an earlier date before appending a new daily snapshot', () => {
    const filePath = makeHistoryFile(
      `${JSON.stringify(
        [entry('2026-07-18', 40), entry('2026-07-18', 41), entry('2026-07-22', 54)],
        null,
        2
      )}\n`
    );

    record(filePath, entry('2026-07-23', 55));

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([
      entry('2026-07-18', 40),
      entry('2026-07-22', 54),
      entry('2026-07-23', 55),
    ]);
  });

  it('appends a measurement from a new day', () => {
    const filePath = makeHistoryFile(`${JSON.stringify([entry('2026-07-22', 54)], null, 2)}\n`);

    record(filePath, entry('2026-07-23', 55));

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([
      entry('2026-07-22', 54),
      entry('2026-07-23', 55),
    ]);
  });

  it('fails closed when the history is not an array', () => {
    const original = '{}\n';
    const filePath = makeHistoryFile(original);

    expect(() => record(filePath, entry('2026-07-23', 55))).toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(original);
  });
});
