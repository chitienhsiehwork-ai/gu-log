/**
 * Security Metrics Endpoint
 *
 * GET /api/metrics/security
 *   Returns current audit, baseline, history, and trend.
 *
 * GET /api/metrics/security/history
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
  SecurityBaseline,
  SecurityHistoryEntry,
  SecurityCurrent,
  MetricResponse,
} from '../types/metrics.js';

const security = new Hono();

security.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<SecurityBaseline>(
    'security-audit-baseline.json'
  );
  const history =
    (await readMetricFile<SecurityHistoryEntry[]>(
      'security-audit-history.json'
    )) ?? [];

  const latest = history[history.length - 1];

  const current: SecurityCurrent = latest
    ? {
        total: latest.total,
        severities: latest.severities,
        hasHighOrCritical: latest.hasHighOrCritical,
        vulnerabilities: baseline.vulnerabilities,
      }
    : {
        total: baseline.metadata.vulnerabilities.total,
        severities: {
          info: baseline.metadata.vulnerabilities.info,
          low: baseline.metadata.vulnerabilities.low,
          moderate: baseline.metadata.vulnerabilities.moderate,
          high: baseline.metadata.vulnerabilities.high,
          critical: baseline.metadata.vulnerabilities.critical,
        },
        hasHighOrCritical:
          baseline.metadata.vulnerabilities.high > 0 ||
          baseline.metadata.vulnerabilities.critical > 0,
        vulnerabilities: baseline.vulnerabilities,
      };

  const trend = computeTrend(history, (e) => e.total);

  const response: MetricResponse<SecurityCurrent, SecurityHistoryEntry> = {
    current,
    baseline: {
      total: baseline.metadata.vulnerabilities.total,
      severities: {
        info: baseline.metadata.vulnerabilities.info,
        low: baseline.metadata.vulnerabilities.low,
        moderate: baseline.metadata.vulnerabilities.moderate,
        high: baseline.metadata.vulnerabilities.high,
        critical: baseline.metadata.vulnerabilities.critical,
      },
      hasHighOrCritical:
        baseline.metadata.vulnerabilities.high > 0 ||
        baseline.metadata.vulnerabilities.critical > 0,
      vulnerabilities: baseline.vulnerabilities,
    },
    history,
    trend,
  };

  return c.json(response);
});

security.get('/history', async (c) => {
  const from = c.req.query('from');
  const limitStr = c.req.query('limit');

  const validationError = validateHistoryParams(from, limitStr);
  if (validationError) {
    return c.json({ error: validationError, code: 400 }, 400);
  }

  const history =
    (await readMetricFile<SecurityHistoryEntry[]>(
      'security-audit-history.json'
    )) ?? [];

  const limit = limitStr ? Number(limitStr) : undefined;
  const filtered = filterHistory(history, from, limit);

  return c.json({ history: filtered, total: filtered.length });
});

export default security;
