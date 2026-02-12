/**
 * Dependency Freshness Metrics Endpoint
 *
 * GET /api/metrics/dependencies
 *   Returns current dependency status, baseline, history, and trend.
 *
 * GET /api/metrics/dependencies/history
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
  DependencyBaseline,
  DependencyHistoryEntry,
  DependencyCurrent,
  MetricResponse,
} from '../types/metrics.js';

const dependencies = new Hono();

dependencies.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<DependencyBaseline>(
    'dependency-freshness-baseline.json'
  );
  const history =
    (await readMetricFile<DependencyHistoryEntry[]>(
      'dependency-freshness-history.json'
    )) ?? [];

  const current: DependencyCurrent = {
    date: baseline.date,
    total: baseline.total,
    fresh: baseline.fresh,
    stale: baseline.stale,
    outdated: baseline.outdated,
    deprecated: baseline.deprecated,
    possiblyUnmaintained: baseline.possiblyUnmaintained,
    details: baseline.details,
  };

  // Higher fresh ratio = better
  const trend = computeTrend(history, (e) => e.fresh, true);

  const response: MetricResponse<DependencyCurrent, DependencyHistoryEntry> = {
    current,
    baseline: current,
    history,
    trend,
  };

  return c.json(response);
});

dependencies.get('/history', async (c) => {
  const from = c.req.query('from');
  const limitStr = c.req.query('limit');

  const validationError = validateHistoryParams(from, limitStr);
  if (validationError) {
    return c.json({ error: validationError, code: 400 }, 400);
  }

  const history =
    (await readMetricFile<DependencyHistoryEntry[]>(
      'dependency-freshness-history.json'
    )) ?? [];

  const limit = limitStr ? Number(limitStr) : undefined;
  const filtered = filterHistory(history, from, limit);

  return c.json({ history: filtered, total: filtered.length });
});

export default dependencies;
