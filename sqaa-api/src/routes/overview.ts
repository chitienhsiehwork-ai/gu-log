/**
 * Overview Metrics Endpoint
 *
 * GET /api/metrics/overview
 *
 * Aggregates all metrics into a single health dashboard view.
 * Computes overall health status based on:
 *   - critical: high/critical vulns OR deprecated dependencies
 *   - warning: Lighthouse avg performance < 90 OR broken internal links > 0 OR coverage issues
 *   - healthy: everything else
 */

import { Hono } from 'hono';
import { readMetricFile, readRequiredMetricFile } from '../services/metrics-reader.js';
import type {
  SecurityBaseline,
  SecurityHistoryEntry,
  EslintBaseline,
  LighthouseBaseline,
  CoverageBaseline,
  BundleSizeBaseline,
  BundleBudget,
  LinksBaseline,
  DependencyBaseline,
  ContentVelocityReport,
  OverviewResponse,
  OverallHealth,
} from '../types/metrics.js';

const overview = new Hono();

overview.get('/', async (c) => {
  // A complete overview requires every baseline/report/policy. Security
  // history is the only optional input because the baseline is authoritative.
  const [
    securityBaseline,
    securityHistory,
    eslintBaseline,
    lighthouseBaseline,
    coverageBaseline,
    bundleBaseline,
    bundleBudget,
    linksBaseline,
    depsBaseline,
    contentReport,
  ] = await Promise.all([
    readRequiredMetricFile<SecurityBaseline>('security-audit-baseline.json'),
    readMetricFile<SecurityHistoryEntry[]>('security-audit-history.json'),
    readRequiredMetricFile<EslintBaseline>('eslint-baseline.json'),
    readRequiredMetricFile<LighthouseBaseline>('lighthouse-baseline.json'),
    readRequiredMetricFile<CoverageBaseline>('coverage-baseline.json'),
    readRequiredMetricFile<BundleSizeBaseline>('bundle-size-baseline.json'),
    readRequiredMetricFile<BundleBudget>('bundle-budget.json'),
    readRequiredMetricFile<LinksBaseline>('broken-links-baseline.json'),
    readRequiredMetricFile<DependencyBaseline>('dependency-freshness-baseline.json'),
    readRequiredMetricFile<ContentVelocityReport>('content-velocity-report.json'),
  ]);

  // ─── Security ──────────────────────────────────────
  const latestSecurity = securityHistory?.[securityHistory.length - 1];
  const vulns = latestSecurity?.severities ?? securityBaseline.metadata.vulnerabilities;
  const hasHighOrCritical = vulns.high > 0 || vulns.critical > 0;
  const securityStatus = hasHighOrCritical
    ? ('fail' as const)
    : vulns.moderate > 0
      ? ('warn' as const)
      : ('pass' as const);

  // ─── Code Quality ─────────────────────────────────
  const eslintData = eslintBaseline.afterAutoFix.eslint;
  const codeQualityStatus =
    eslintData.errors > 0
      ? ('fail' as const)
      : eslintData.warnings > 0
        ? ('warn' as const)
        : ('pass' as const);

  // ─── Lighthouse ───────────────────────────────────
  const lhPages = Object.values(lighthouseBaseline.pages);
  const lhCount = lhPages.length || 1;
  const lhAvg = {
    performance: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores.performance, 0) / lhCount) * 100
    ),
    accessibility: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores.accessibility, 0) / lhCount) * 100
    ),
    bestPractices: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores['best-practices'], 0) / lhCount) * 100
    ),
    seo: Math.round((lhPages.reduce((sum, p) => sum + p.scores.seo, 0) / lhCount) * 100),
  };

  // ─── Coverage ─────────────────────────────────────
  const cov = coverageBaseline;

  // ─── Bundle ───────────────────────────────────────
  const totalKB = bundleBaseline.totalKB;
  const maxKB = bundleBudget.totalMaxKB;
  const withinBudget = totalKB <= maxKB;

  // ─── Links ────────────────────────────────────────
  const internalOk = linksBaseline.internal.ok;
  const internalBroken = linksBaseline.internal.broken.length;
  const externalOk = linksBaseline.external.ok;
  const externalBroken = linksBaseline.external.broken.length;

  // ─── Dependencies ─────────────────────────────────
  const deps = depsBaseline;

  // ─── Content ──────────────────────────────────────
  const contentData = contentReport;

  // ─── Overall Health ───────────────────────────────
  let overallHealth: OverallHealth = 'healthy';

  // Critical conditions
  if (hasHighOrCritical || deps.deprecated > 0) {
    overallHealth = 'critical';
  }
  // Warning conditions (only if not already critical)
  else if (lhAvg.performance < 90 || internalBroken > 0) {
    overallHealth = 'warning';
  }

  const response: OverviewResponse = {
    timestamp: new Date().toISOString(),
    scores: {
      security: {
        status: securityStatus,
        vulns: {
          critical: vulns.critical,
          high: vulns.high,
          moderate: vulns.moderate,
        },
      },
      codeQuality: {
        status: codeQualityStatus,
        errors: eslintData.errors,
        warnings: eslintData.warnings,
      },
      lighthouse: lhAvg,
      coverage: {
        statements: cov.statements,
        branches: cov.branches,
        functions: cov.functions,
        lines: cov.lines,
      },
      bundle: {
        totalKB,
        withinBudget,
      },
      links: {
        internal: { ok: internalOk, broken: internalBroken },
        external: { ok: externalOk, broken: externalBroken },
      },
      dependencies: {
        fresh: deps.fresh,
        stale: deps.stale,
        outdated: deps.outdated,
        deprecated: deps.deprecated,
      },
      content: {
        total: contentData.productionSpeed.totalPosts,
        weeklyAvg: contentData.productionSpeed.avgPerWeek,
        avgDelayDays: contentData.translationDelay.avgDays,
      },
    },
    overallHealth,
  };

  return c.json(response);
});

export default overview;
