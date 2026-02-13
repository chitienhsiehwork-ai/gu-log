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
import { readMetricFile } from '../services/metrics-reader.js';
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
  // Read all files in parallel — null if missing
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
    readMetricFile<SecurityBaseline>('security-audit-baseline.json'),
    readMetricFile<SecurityHistoryEntry[]>('security-audit-history.json'),
    readMetricFile<EslintBaseline>('eslint-baseline.json'),
    readMetricFile<LighthouseBaseline>('lighthouse-baseline.json'),
    readMetricFile<CoverageBaseline>('coverage-baseline.json'),
    readMetricFile<BundleSizeBaseline>('bundle-size-baseline.json'),
    readMetricFile<BundleBudget>('bundle-budget.json'),
    readMetricFile<LinksBaseline>('broken-links-baseline.json'),
    readMetricFile<DependencyBaseline>('dependency-freshness-baseline.json'),
    readMetricFile<ContentVelocityReport>('content-velocity-report.json'),
  ]);

  // ─── Security ──────────────────────────────────────
  const latestSecurity = securityHistory?.[securityHistory.length - 1];
  const vulns = latestSecurity?.severities ??
    securityBaseline?.metadata.vulnerabilities ?? {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
    };
  const hasHighOrCritical = vulns.high > 0 || vulns.critical > 0;
  const securityStatus = hasHighOrCritical
    ? ('fail' as const)
    : vulns.moderate > 0
      ? ('warn' as const)
      : ('pass' as const);

  // ─── Code Quality ─────────────────────────────────
  const eslintData = eslintBaseline?.afterAutoFix.eslint;
  const codeQualityStatus =
    (eslintData?.errors ?? 0) > 0
      ? ('fail' as const)
      : (eslintData?.warnings ?? 0) > 0
        ? ('warn' as const)
        : ('pass' as const);

  // ─── Lighthouse ───────────────────────────────────
  const lhPages = lighthouseBaseline
    ? Object.values(lighthouseBaseline.pages)
    : [];
  const lhCount = lhPages.length || 1;
  const lhAvg = {
    performance: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores.performance, 0) / lhCount) *
        100
    ),
    accessibility: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores.accessibility, 0) / lhCount) *
        100
    ),
    bestPractices: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores['best-practices'], 0) /
        lhCount) *
        100
    ),
    seo: Math.round(
      (lhPages.reduce((sum, p) => sum + p.scores.seo, 0) / lhCount) * 100
    ),
  };

  // ─── Coverage ─────────────────────────────────────
  const cov = coverageBaseline ?? {
    statements: 0,
    branches: 0,
    functions: 0,
    lines: 0,
  };

  // ─── Bundle ───────────────────────────────────────
  const totalKB = bundleBaseline?.totalKB ?? 0;
  const maxKB = bundleBudget?.totalMaxKB ?? Infinity;
  const withinBudget = totalKB <= maxKB;

  // ─── Links ────────────────────────────────────────
  const internalOk = linksBaseline?.internal.ok ?? 0;
  const internalBroken = linksBaseline?.internal.broken.length ?? 0;
  const externalOk = linksBaseline?.external.ok ?? 0;
  const externalBroken = linksBaseline?.external.broken.length ?? 0;

  // ─── Dependencies ─────────────────────────────────
  const deps = depsBaseline ?? {
    fresh: 0,
    stale: 0,
    outdated: 0,
    deprecated: 0,
  };

  // ─── Content ──────────────────────────────────────
  const contentData = contentReport ?? {
    productionSpeed: { totalPosts: 0, avgPerWeek: 0 },
    translationDelay: { avgDays: 0 },
  };

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
        errors: eslintData?.errors ?? 0,
        warnings: eslintData?.warnings ?? 0,
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
