/**
 * ESLint / Code Quality Metrics Endpoint
 *
 * GET /api/metrics/eslint
 *   Returns current code quality state, baseline, and trend.
 *
 * Note: ESLint doesn't have a history file yet — returns single-entry history.
 */

import { Hono } from 'hono';
import { readRequiredMetricFile } from '../services/metrics-reader.js';
import type { EslintBaseline, EslintCurrent } from '../types/metrics.js';

const eslint = new Hono();

eslint.get('/', async (c) => {
  const baseline = await readRequiredMetricFile<EslintBaseline>(
    'eslint-baseline.json'
  );

  const current: EslintCurrent = {
    timestamp: baseline.timestamp,
    errors: baseline.afterAutoFix.eslint.errors,
    warnings: baseline.afterAutoFix.eslint.warnings,
    totalProblems: baseline.afterAutoFix.eslint.totalProblems,
    prettierIssues: baseline.afterAutoFix.prettier.remainingFormattingIssues,
    remainingDetails: baseline.afterAutoFix.eslint.remainingDetails,
  };

  return c.json({
    current,
    baseline: {
      timestamp: baseline.timestamp,
      errors: baseline.baseline.eslint.errors,
      warnings: baseline.baseline.eslint.warnings,
      totalProblems: baseline.baseline.eslint.totalProblems,
      prettierIssues: baseline.baseline.prettier.filesWithFormattingIssues,
      remainingDetails: [] as string[],
    },
    history: [
      {
        date: baseline.timestamp,
        errors: baseline.afterAutoFix.eslint.errors,
        warnings: baseline.afterAutoFix.eslint.warnings,
        totalProblems: baseline.afterAutoFix.eslint.totalProblems,
      },
    ],
    trend: 'stable' as const,
  });
});

export default eslint;
