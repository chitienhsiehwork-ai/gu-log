/**
 * Tests for MetricsReader service
 *
 * Tests file reading, error handling, trend computation,
 * history filtering, and query param validation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  setQualityDir,
  getQualityDir,
  readMetricFile,
  readRequiredMetricFile,
  computeTrend,
  filterHistory,
  validateHistoryParams,
  MetricNotFoundError,
} from '../src/services/metrics-reader.js';

const testDir = join(import.meta.dirname, 'fixtures', 'quality');
let originalDir: string;

beforeAll(() => {
  originalDir = getQualityDir();
  mkdirSync(testDir, { recursive: true });

  // Create test fixtures
  writeFileSync(
    join(testDir, 'test-data.json'),
    JSON.stringify({ value: 42, name: 'test' })
  );
  writeFileSync(join(testDir, 'invalid.json'), 'not valid json {{{');

  setQualityDir(testDir);
});

afterAll(() => {
  setQualityDir(originalDir);
  rmSync(testDir, { recursive: true, force: true });
});

describe('readMetricFile', () => {
  it('reads and parses a valid JSON file', async () => {
    const data = await readMetricFile<{ value: number; name: string }>(
      'test-data.json'
    );
    expect(data).toEqual({ value: 42, name: 'test' });
  });

  it('returns null for non-existent file', async () => {
    const data = await readMetricFile('does-not-exist.json');
    expect(data).toBeNull();
  });

  it('throws on invalid JSON', async () => {
    await expect(readMetricFile('invalid.json')).rejects.toThrow();
  });
});

describe('readRequiredMetricFile', () => {
  it('reads existing file successfully', async () => {
    const data = await readRequiredMetricFile<{ value: number }>(
      'test-data.json'
    );
    expect(data.value).toBe(42);
  });

  it('throws MetricNotFoundError for missing file', async () => {
    await expect(
      readRequiredMetricFile('missing.json')
    ).rejects.toThrow(MetricNotFoundError);
  });
});

describe('computeTrend', () => {
  it('returns stable with less than 2 entries', () => {
    expect(computeTrend([{ v: 10 }], (e) => e.v)).toBe('stable');
    expect(computeTrend([], (e: { v: number }) => e.v)).toBe('stable');
  });

  it('returns improving when value decreases (lower is better)', () => {
    const history = [{ v: 10 }, { v: 5 }];
    expect(computeTrend(history, (e) => e.v)).toBe('improving');
  });

  it('returns degrading when value increases (lower is better)', () => {
    const history = [{ v: 5 }, { v: 10 }];
    expect(computeTrend(history, (e) => e.v)).toBe('degrading');
  });

  it('returns improving when value increases with higherIsBetter', () => {
    const history = [{ v: 5 }, { v: 10 }];
    expect(computeTrend(history, (e) => e.v, true)).toBe('improving');
  });

  it('returns degrading when value decreases with higherIsBetter', () => {
    const history = [{ v: 10 }, { v: 5 }];
    expect(computeTrend(history, (e) => e.v, true)).toBe('degrading');
  });

  it('returns stable when values are equal', () => {
    const history = [{ v: 10 }, { v: 10 }];
    expect(computeTrend(history, (e) => e.v)).toBe('stable');
  });
});

describe('filterHistory', () => {
  const history = [
    { date: '2026-02-01', value: 1 },
    { date: '2026-02-05', value: 2 },
    { date: '2026-02-10', value: 3 },
    { date: '2026-02-12', value: 4 },
  ];

  it('returns all entries without filters', () => {
    expect(filterHistory(history)).toHaveLength(4);
  });

  it('filters by from date', () => {
    const filtered = filterHistory(history, '2026-02-05');
    expect(filtered).toHaveLength(3);
    expect(filtered[0]!.date).toBe('2026-02-05');
  });

  it('limits results (from end)', () => {
    const filtered = filterHistory(history, undefined, 2);
    expect(filtered).toHaveLength(2);
    expect(filtered[0]!.date).toBe('2026-02-10');
  });

  it('combines from and limit', () => {
    const filtered = filterHistory(history, '2026-02-05', 1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.date).toBe('2026-02-12');
  });
});

describe('validateHistoryParams', () => {
  it('returns null for valid params', () => {
    expect(validateHistoryParams('2026-02-01', '10')).toBeNull();
    expect(validateHistoryParams(undefined, undefined)).toBeNull();
    expect(validateHistoryParams('2026-02-01')).toBeNull();
    expect(validateHistoryParams(undefined, '5')).toBeNull();
  });

  it('rejects invalid date', () => {
    const err = validateHistoryParams('not-a-date');
    expect(err).toContain('Invalid');
  });

  it('rejects invalid limit', () => {
    expect(validateHistoryParams(undefined, 'abc')).toContain('Invalid');
    expect(validateHistoryParams(undefined, '-1')).toContain('Invalid');
    expect(validateHistoryParams(undefined, '0')).toContain('Invalid');
    expect(validateHistoryParams(undefined, '1.5')).toContain('Invalid');
  });

  it('rejects limit over 1000', () => {
    const err = validateHistoryParams(undefined, '1001');
    expect(err).toContain('too large');
  });
});
