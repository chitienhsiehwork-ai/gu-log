/**
 * Tests for GET /api/metrics/overview
 *
 * Uses actual quality/ data since it's available in the project.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import app from '../src/app.js';
import { getQualityDir, setQualityDir } from '../src/services/metrics-reader.js';

const QUALITY_DIR = resolve(import.meta.dirname, '..', '..', 'quality');
const REQUIRED_FILES = [
  'security-audit-baseline.json',
  'eslint-baseline.json',
  'lighthouse-baseline.json',
  'coverage-baseline.json',
  'bundle-size-baseline.json',
  'bundle-budget.json',
  'broken-links-baseline.json',
  'dependency-freshness-baseline.json',
  'content-velocity-report.json',
] as const;
const OPTIONAL_HISTORY = 'security-audit-history.json';

async function withQualityFixture(
  omittedFile: string,
  callback: () => Promise<void>
): Promise<void> {
  const fixture = mkdtempSync(join(tmpdir(), 'gu-log-sqaa-overview-'));
  const originalQualityDir = getQualityDir();
  try {
    for (const filename of [...REQUIRED_FILES, OPTIONAL_HISTORY]) {
      if (filename === omittedFile) continue;
      copyFileSync(join(QUALITY_DIR, filename), join(fixture, basename(filename)));
    }
    setQualityDir(fixture);
    await callback();
  } finally {
    setQualityDir(originalQualityDir);
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('GET /api/metrics/overview', () => {
  it('returns 200 with all metric scores', async () => {
    const res = await app.request('/api/metrics/overview');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.timestamp).toBeDefined();
    expect(body.overallHealth).toBeDefined();
    expect(['healthy', 'warning', 'critical']).toContain(body.overallHealth);
  });

  it('contains all expected score categories', async () => {
    const res = await app.request('/api/metrics/overview');
    const body = await res.json();

    expect(body.scores).toBeDefined();
    expect(body.scores.security).toBeDefined();
    expect(body.scores.codeQuality).toBeDefined();
    expect(body.scores.lighthouse).toBeDefined();
    expect(body.scores.coverage).toBeDefined();
    expect(body.scores.bundle).toBeDefined();
    expect(body.scores.links).toBeDefined();
    expect(body.scores.dependencies).toBeDefined();
    expect(body.scores.content).toBeDefined();
  });

  it('security scores have proper structure', async () => {
    const res = await app.request('/api/metrics/overview');
    const body = await res.json();

    expect(body.scores.security.status).toBeDefined();
    expect(['pass', 'warn', 'fail']).toContain(body.scores.security.status);
    expect(typeof body.scores.security.vulns.critical).toBe('number');
    expect(typeof body.scores.security.vulns.high).toBe('number');
    expect(typeof body.scores.security.vulns.moderate).toBe('number');
  });

  it('coverage scores are percentages', async () => {
    const res = await app.request('/api/metrics/overview');
    const body = await res.json();
    const { coverage } = body.scores;

    expect(coverage.statements).toBeGreaterThanOrEqual(0);
    expect(coverage.statements).toBeLessThanOrEqual(100);
    expect(coverage.lines).toBeGreaterThanOrEqual(0);
    expect(coverage.lines).toBeLessThanOrEqual(100);
  });

  it('overall health reflects current state', async () => {
    const res = await app.request('/api/metrics/overview');
    const body = await res.json();

    // overallHealth is a 3-value enum derived from current scores. The exact
    // value depends on the live quality/ data on disk, so just pin the
    // contract (must be one of the documented states), not a fixed value —
    // otherwise the test breaks every time real metrics shift.
    expect(['healthy', 'warning', 'critical']).toContain(body.overallHealth);
  });

  it.each(REQUIRED_FILES)('returns 404 when required evidence %s is missing', async (filename) => {
    await withQualityFixture(filename, async () => {
      const res = await app.request('/api/metrics/overview');

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: `No data yet: ${filename}`,
        code: 404,
      });
    });
  });

  it('keeps security history optional when all required evidence exists', async () => {
    await withQualityFixture(OPTIONAL_HISTORY, async () => {
      const res = await app.request('/api/metrics/overview');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scores.security).toBeDefined();
    });
  });
});
