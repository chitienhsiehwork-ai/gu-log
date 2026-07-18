import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateBaselineFreshness,
  latestCoverageHistoryDate,
} from '../scripts/check-nightly-baseline-freshness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('nightly baseline freshness', () => {
  it('uses the latest coverage history date instead of the ratchet baseline date', () => {
    const result = evaluateBaselineFreshness({
      coverageHistory: [
        { date: '2026-02-12', statements: 70 },
        { date: '2026-07-18', statements: 34 },
        { date: '2026-07-20', statements: 34 },
      ],
      // Coverage can remain flat for days, so its ratchet baseline date may be
      // old even though a valid measurement was recorded last night. The
      // broken-links baseline, unlike coverage, is refreshed after every scan.
      brokenLinksBaseline: { date: '2026-07-19' },
      today: '2026-07-21',
      maxAgeDays: 3,
    });

    expect(result.stale).toBe(false);
    expect(result.checks[0]).toMatchObject({
      path: 'quality/coverage-history.json',
      date: '2026-07-20',
      ageDays: 1,
      stale: false,
    });
  });

  it('fails when the latest valid coverage measurement is stale', () => {
    const result = evaluateBaselineFreshness({
      coverageHistory: [{ date: '2026-07-17', statements: 34 }],
      brokenLinksBaseline: { date: '2026-07-20' },
      today: '2026-07-21',
      maxAgeDays: 3,
    });

    expect(result.stale).toBe(true);
    expect(result.checks[0]).toMatchObject({ ageDays: 4, stale: true });
  });

  it('fails closed when coverage history has no valid freshness date', () => {
    expect(() => latestCoverageHistoryDate([])).toThrow('must be a non-empty array');
    expect(() => latestCoverageHistoryDate([{ date: '2026-02-30' }])).toThrow(
      'is not a real calendar date'
    );
  });

  it('wires the nightly job to the tested helper instead of the coverage ratchet baseline', () => {
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/nightly-deep.yml'), 'utf8');
    const freshnessJob = workflow.slice(
      workflow.indexOf('  baseline-freshness:'),
      workflow.indexOf('  # ─── Build first')
    );

    expect(freshnessJob).toContain('node scripts/check-nightly-baseline-freshness.mjs');
    expect(freshnessJob).not.toContain('quality/coverage-baseline.json');
  });
});
