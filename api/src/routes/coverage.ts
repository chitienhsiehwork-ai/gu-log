/**
 * Test Coverage Metrics Endpoint
 *
 * GET /api/metrics/coverage
 *   Returns current coverage, baseline, history, and trend.
 *
 * GET /api/metrics/coverage/history
 *   Returns filtered history with ?from and ?limit params.
 */

import { Hono } from 'hono';
import {
  readRequiredMetricFile,
  readMetricFile,
  computeTrend,
  filterHistory,
  validateHistoryParams,
} from '../services/metrics-reader.js';
import type {
  CoverageBaseline,
  CoverageHistoryEntry,
  CoverageCurrent,
  MetricResponse,
} from '../types/metrics.js';

const coverage = new Hono();

coverage.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<CoverageBaseline>(
    'coverage-baseline.json'
  );
  const history =
    (await readMetricFile<CoverageHistoryEntry[]>('coverage-history.json')) ??
    [];

  const current: CoverageCurrent = {
    date: baseline.date,
    statements: baseline.statements,
    branches: baseline.branches,
    functions: baseline.functions,
    lines: baseline.lines,
    totalTests: baseline.totalTests,
    passed: baseline.passed,
    failed: baseline.failed,
  };

  const trend = computeTrend(history, (e) => e.lines, true);

  const response: MetricResponse<CoverageCurrent, CoverageHistoryEntry> = {
    current,
    baseline: current,
    history,
    trend,
  };

  return c.json(response);
});

coverage.get('/history', async (c) => {
  const from = c.req.query('from');
  const limitStr = c.req.query('limit');

  const validationError = validateHistoryParams(from, limitStr);
  if (validationError) {
    return c.json({ error: validationError, code: 400 }, 400);
  }

  const history =
    (await readMetricFile<CoverageHistoryEntry[]>('coverage-history.json')) ??
    [];

  const limit = limitStr ? Number(limitStr) : undefined;
  const filtered = filterHistory(history, from, limit);

  return c.json({ history: filtered, total: filtered.length });
});

export default coverage;
