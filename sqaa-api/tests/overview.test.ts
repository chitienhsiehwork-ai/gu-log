/**
 * Tests for GET /api/metrics/overview
 *
 * Uses actual quality/ data since it's available in the project.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/app.js';

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
});
