import { describe, expect, it } from 'vitest';

import { upsertCoverageHistory } from '../scripts/record-coverage-history.mjs';

const entry = (date: string, statements: number) => ({
  date,
  statements,
  branches: 30,
  functions: 35,
  lines: statements,
});

describe('coverage history recording', () => {
  it('replaces an existing entry from the same day', () => {
    const history = [entry('2026-07-22', 54), entry('2026-07-23', 55)];

    expect(upsertCoverageHistory(history, entry('2026-07-23', 56))).toEqual([
      entry('2026-07-22', 54),
      entry('2026-07-23', 56),
    ]);
  });

  it('repairs duplicate same-day entries left by earlier runs', () => {
    const history = [entry('2026-07-22', 54), entry('2026-07-23', 55), entry('2026-07-23', 56)];

    const result = upsertCoverageHistory(history, entry('2026-07-23', 57));

    expect(result).toEqual([entry('2026-07-22', 54), entry('2026-07-23', 57)]);
    expect(result.filter(({ date }) => date === '2026-07-23')).toHaveLength(1);
  });

  it('appends a measurement from a new day', () => {
    const history = [entry('2026-07-22', 54)];

    expect(upsertCoverageHistory(history, entry('2026-07-23', 55))).toEqual([
      entry('2026-07-22', 54),
      entry('2026-07-23', 55),
    ]);
  });

  it('fails closed when the history is not an array', () => {
    expect(() => upsertCoverageHistory({}, entry('2026-07-23', 55))).toThrow(
      'coverage history must be an array'
    );
  });
});
