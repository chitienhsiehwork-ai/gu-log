/**
 * Broken Links Metrics Endpoint
 *
 * GET /api/metrics/links
 *   Returns current link status, baseline, and trend.
 *
 * Note: Links don't have a history file yet — returns single-entry history.
 */

import { Hono } from 'hono';
import { readRequiredMetricFile } from '../services/metrics-reader.js';
import type { LinksBaseline, LinksCurrent } from '../types/metrics.js';

const links = new Hono();

links.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<LinksBaseline>(
    'broken-links-baseline.json'
  );

  const current: LinksCurrent = {
    date: baseline.date,
    total: baseline.total,
    internal: {
      ok: baseline.internal.ok,
      broken: baseline.internal.broken.length,
      brokenLinks: baseline.internal.broken,
    },
    external: {
      ok: baseline.external.ok,
      broken: baseline.external.broken.length,
      brokenLinks: baseline.external.broken,
    },
  };

  return c.json({
    current,
    baseline: current,
    history: [
      {
        date: baseline.date,
        internalOk: baseline.internal.ok,
        internalBroken: baseline.internal.broken.length,
        externalOk: baseline.external.ok,
        externalBroken: baseline.external.broken.length,
      },
    ],
    trend: 'stable' as const,
  });
});

export default links;
