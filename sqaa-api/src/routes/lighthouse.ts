/**
 * Lighthouse Metrics Endpoint
 *
 * GET /api/metrics/lighthouse
 *   Returns current scores, per-page breakdown, baseline, and trend.
 *
 * Note: Lighthouse doesn't have a history file yet — returns single-entry history.
 */

import { Hono } from 'hono';
import { readRequiredMetricFile } from '../services/metrics-reader.js';
import type {
  LighthouseBaseline,
  LighthouseCurrent,
} from '../types/metrics.js';

const lighthouse = new Hono();

lighthouse.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<LighthouseBaseline>(
    'lighthouse-baseline.json'
  );

  // Compute average scores across all pages
  const pages = Object.values(baseline.pages);
  const avgScores = {
    performance: 0,
    accessibility: 0,
    bestPractices: 0,
    seo: 0,
  };

  for (const page of pages) {
    avgScores.performance += page.scores.performance;
    avgScores.accessibility += page.scores.accessibility;
    avgScores.bestPractices += page.scores['best-practices'];
    avgScores.seo += page.scores.seo;
  }

  const count = pages.length || 1;
  avgScores.performance = Math.round((avgScores.performance / count) * 100);
  avgScores.accessibility = Math.round(
    (avgScores.accessibility / count) * 100
  );
  avgScores.bestPractices = Math.round(
    (avgScores.bestPractices / count) * 100
  );
  avgScores.seo = Math.round((avgScores.seo / count) * 100);

  const current: LighthouseCurrent = {
    date: baseline.date,
    pages: baseline.pages,
    averageScores: avgScores,
  };

  return c.json({
    current,
    baseline: current,
    history: [
      {
        date: baseline.date,
        ...avgScores,
      },
    ],
    trend: 'stable' as const,
  });
});

export default lighthouse;
