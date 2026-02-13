/**
 * Content Velocity Metrics Endpoint
 *
 * GET /api/metrics/content
 *   Returns current content production stats, baseline, and trend.
 *
 * Note: Content velocity doesn't have a history file yet — returns single-entry.
 */

import { Hono } from 'hono';
import { readRequiredMetricFile } from '../services/metrics-reader.js';
import type {
  ContentVelocityReport,
  ContentCurrent,
} from '../types/metrics.js';

const content = new Hono();

content.get('/', async (c) => {
  const report = await readRequiredMetricFile<ContentVelocityReport>(
    'content-velocity-report.json'
  );

  const current: ContentCurrent = {
    generatedAt: report.generatedAt,
    totalPosts: report.productionSpeed.totalPosts,
    weeklyAvg: report.productionSpeed.avgPerWeek,
    avgDelayDays: report.translationDelay.avgDays,
    medianDelayDays: report.translationDelay.medianDays,
    last7Days: report.productionSpeed.last7Days,
    last30Days: report.productionSpeed.last30Days,
    translationTrend: report.translationDelay.trend,
  };

  return c.json({
    current,
    baseline: current,
    fullReport: report,
    history: [
      {
        date: report.referenceDate,
        totalPosts: report.productionSpeed.totalPosts,
        weeklyAvg: report.productionSpeed.avgPerWeek,
        avgDelayDays: report.translationDelay.avgDays,
      },
    ],
    trend: 'stable' as const,
  });
});

export default content;
