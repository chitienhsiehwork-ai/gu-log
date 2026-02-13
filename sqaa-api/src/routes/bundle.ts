/**
 * Bundle Size Metrics Endpoint
 *
 * GET /api/metrics/bundle
 *   Returns current bundle size, budget status, baseline, history, and trend.
 *
 * GET /api/metrics/bundle/history
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
  BundleSizeBaseline,
  BundleBudget,
  BundleHistoryEntry,
  BundleCurrent,
  MetricResponse,
} from '../types/metrics.js';

const bundle = new Hono();

bundle.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<BundleSizeBaseline>(
    'bundle-size-baseline.json'
  );
  const budget =
    (await readMetricFile<BundleBudget>('bundle-budget.json')) ?? {
      totalMaxKB: Infinity,
      jsMaxKB: Infinity,
      cssMaxKB: Infinity,
      singleFileMaxKB: Infinity,
      comment: 'No budget file found',
    };
  const history =
    (await readMetricFile<BundleHistoryEntry[]>('bundle-size-history.json')) ??
    [];

  const withinBudget = baseline.totalKB <= budget.totalMaxKB;

  const current: BundleCurrent = {
    timestamp: baseline.timestamp,
    totalKB: baseline.totalKB,
    jsKB: baseline.jsKB,
    cssKB: baseline.cssKB,
    htmlKB: baseline.htmlKB,
    imgKB: baseline.imgKB,
    otherKB: baseline.otherKB,
    fileCount: baseline.fileCount,
    withinBudget,
    budget,
  };

  const trend = computeTrend(history, (e) => e.totalKB);

  const response: MetricResponse<BundleCurrent, BundleHistoryEntry> = {
    current,
    baseline: current,
    history,
    trend,
  };

  return c.json(response);
});

bundle.get('/history', async (c) => {
  const from = c.req.query('from');
  const limitStr = c.req.query('limit');

  const validationError = validateHistoryParams(from, limitStr);
  if (validationError) {
    return c.json({ error: validationError, code: 400 }, 400);
  }

  const history =
    (await readMetricFile<BundleHistoryEntry[]>('bundle-size-history.json')) ??
    [];

  const limit = limitStr ? Number(limitStr) : undefined;
  const filtered = filterHistory(history, from, limit);

  return c.json({ history: filtered, total: filtered.length });
});

export default bundle;
