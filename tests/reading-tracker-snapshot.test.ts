import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/pages/reading-tracker.astro', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('reading tracker snapshot budget', () => {
  it('reuses one read-record snapshot for row and stats updates', () => {
    const statsSource = sourceBetween('function updateStats', 'function updateAllRows');
    const rowsSource = sourceBetween('function updateAllRows', 'function applyFilter');

    expect(statsSource).not.toMatch(/\breadRecordMap\(\)/);
    expect(rowsSource.match(/\breadRecordMap\(\)/g)).toHaveLength(1);
    expect(rowsSource).toContain('updateStats(records);');
  });
});
