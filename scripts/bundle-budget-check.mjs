#!/usr/bin/env node
/**
 * Bundle Budget Check for gu-log
 *
 * Modes:
 * - check-only (default): check budget only, do NOT write history.
 * - --record: check budget and append a history entry.
 *
 * Exit code:
 * - 1 when blocking budgets are violated.
 * - 0 when only trend warnings/alerts are present.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const BUDGET_PATH = join(ROOT, 'quality', 'bundle-budget.json');
const HISTORY_PATH = join(ROOT, 'quality', 'bundle-size-history.json');

const args = process.argv.slice(2);
const isRecordMode = args.includes('--record');
const hasUnknownArgs = args.some((arg) => arg !== '--record');

if (hasUnknownArgs) {
  console.error('Unknown arguments. Usage: node scripts/bundle-budget-check.mjs [--record]');
  process.exit(2);
}

const toFiniteNumberOrNull = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const BLOCKING_THRESHOLD_KEYS = ['totalMaxKB', 'jsMaxKB', 'cssMaxKB', 'singleFileMaxKB'];
const LEGACY_BUDGET_KEYS = new Set([...BLOCKING_THRESHOLD_KEYS, 'version', 'comment']);
const MODERN_BUDGET_KEYS = new Set(['version', 'blocking', 'trend', 'comment']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyBudget(rawBudget) {
  return (
    isObject(rawBudget) &&
    !Object.hasOwn(rawBudget, 'blocking') &&
    !Object.hasOwn(rawBudget, 'trend')
  );
}

function validateBlockingBudgetPolicy(rawBudget) {
  if (!isObject(rawBudget)) return ['budget root must be an object'];

  const errors = [];
  const legacy = isLegacyBudget(rawBudget);
  const scope = legacy ? 'legacy budget' : 'blocking.global';
  let blockingGlobal;

  if (legacy) {
    blockingGlobal = rawBudget;
    for (const key of Object.keys(rawBudget)) {
      if (!LEGACY_BUDGET_KEYS.has(key)) {
        errors.push(`legacy budget has unknown key "${key}"`);
      }
    }
  } else {
    for (const key of Object.keys(rawBudget)) {
      if (!MODERN_BUDGET_KEYS.has(key)) {
        errors.push(`budget root has unknown key "${key}"`);
      }
    }

    if (!isObject(rawBudget.blocking)) {
      errors.push('blocking must be an object');
    } else {
      for (const key of Object.keys(rawBudget.blocking)) {
        if (key !== 'global') errors.push(`blocking has unknown key "${key}"`);
      }

      if (!isObject(rawBudget.blocking.global)) {
        errors.push('blocking.global must be an object');
      } else {
        blockingGlobal = rawBudget.blocking.global;
        for (const key of Object.keys(blockingGlobal)) {
          if (!BLOCKING_THRESHOLD_KEYS.includes(key)) {
            errors.push(`blocking.global has unknown key "${key}"`);
          }
        }
      }
    }
  }

  if (blockingGlobal) {
    const configuredKeys = BLOCKING_THRESHOLD_KEYS.filter((key) =>
      Object.hasOwn(blockingGlobal, key)
    );
    if (configuredKeys.length === 0) {
      errors.push(`${scope} must define at least one blocking threshold`);
    }
    for (const key of configuredKeys) {
      if (toFiniteNumberOrNull(blockingGlobal[key]) === null) {
        errors.push(`${scope}.${key} must be a finite number`);
      }
    }
  }

  return errors;
}

function formatKB(value) {
  return `${Number(value).toFixed(2)} KB`;
}

function readHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeBudget(rawBudget) {
  // Backward compatibility for legacy flat format.
  if (isLegacyBudget(rawBudget)) {
    return {
      blocking: {
        global: {
          totalMaxKB: rawBudget?.totalMaxKB ?? null,
          jsMaxKB: rawBudget?.jsMaxKB ?? null,
          cssMaxKB: rawBudget?.cssMaxKB ?? null,
          singleFileMaxKB: rawBudget?.singleFileMaxKB ?? null,
        },
      },
      trend: {
        global: {},
        routes: {},
      },
    };
  }

  return {
    blocking: {
      global: rawBudget?.blocking?.global ?? {},
    },
    trend: {
      global: rawBudget?.trend?.global ?? {},
      routes: rawBudget?.trend?.routes ?? {},
    },
  };
}

function findPreviousGlobalMetric(history, metricKey) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const value = toFiniteNumberOrNull(history[i]?.[metricKey]);
    if (value !== null) return value;
  }
  return null;
}

function findPreviousRouteMetric(history, routePath) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const routes = history[i]?.routes ?? history[i]?.routeSizesKB;
    const value = toFiniteNumberOrNull(routes?.[routePath]);
    if (value !== null) return value;
  }
  return null;
}

function evaluateTrendRule({ label, currentKB, previousKB, rule }) {
  const alerts = [];

  const warnAtKB = toFiniteNumberOrNull(rule?.warnAtKB);
  const criticalAtKB = toFiniteNumberOrNull(rule?.criticalAtKB);

  if (criticalAtKB !== null && currentKB > criticalAtKB) {
    alerts.push({
      severity: 'critical',
      message: `${label} ${formatKB(currentKB)} exceeds critical threshold ${formatKB(criticalAtKB)}`,
    });
  } else if (warnAtKB !== null && currentKB > warnAtKB) {
    alerts.push({
      severity: 'warning',
      message: `${label} ${formatKB(currentKB)} exceeds warning threshold ${formatKB(warnAtKB)}`,
    });
  }

  const growth = rule?.growth ?? {};
  const warnPct = toFiniteNumberOrNull(growth?.warnPct);
  const criticalPct = toFiniteNumberOrNull(growth?.criticalPct);
  const minDeltaKB = toFiniteNumberOrNull(growth?.minDeltaKB) ?? 0;

  if (previousKB !== null && previousKB > 0 && (warnPct !== null || criticalPct !== null)) {
    const deltaKB = +(currentKB - previousKB).toFixed(2);
    const growthPct = +((deltaKB / previousKB) * 100).toFixed(2);

    if (deltaKB >= minDeltaKB) {
      if (criticalPct !== null && growthPct > criticalPct) {
        alerts.push({
          severity: 'critical',
          message: `${label} grew by ${deltaKB.toFixed(2)} KB (+${growthPct}%) vs previous ${formatKB(previousKB)} (critical growth > ${criticalPct}%)`,
        });
      } else if (warnPct !== null && growthPct > warnPct) {
        alerts.push({
          severity: 'warning',
          message: `${label} grew by ${deltaKB.toFixed(2)} KB (+${growthPct}%) vs previous ${formatKB(previousKB)} (warning growth > ${warnPct}%)`,
        });
      }
    }
  }

  return alerts;
}

// 1. Run bundle-size.mjs and capture output
const sizeJson = execFileSync(process.execPath, ['scripts/bundle-size.mjs'], {
  cwd: ROOT,
  encoding: 'utf-8',
});
const sizes = JSON.parse(sizeJson);

// 2. Read budget config
const rawBudget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'));
const budgetErrors = validateBlockingBudgetPolicy(rawBudget);
if (budgetErrors.length > 0) {
  console.error('❌ Invalid bundle budget policy:');
  for (const error of budgetErrors) console.error(`  - ${error}`);
  process.exit(2);
}
const budget = normalizeBudget(rawBudget);

// 3. Read history for trend comparison
const history = readHistory();

// 4. Evaluate blocking budgets
const blockingViolations = [];
const blockingGlobal = budget.blocking?.global ?? {};

const totalMaxKB = toFiniteNumberOrNull(blockingGlobal.totalMaxKB);
if (totalMaxKB !== null && sizes.totalKB > totalMaxKB) {
  blockingViolations.push(
    `Total size ${formatKB(sizes.totalKB)} exceeds blocking budget ${formatKB(totalMaxKB)}`
  );
}

const jsMaxKB = toFiniteNumberOrNull(blockingGlobal.jsMaxKB);
if (jsMaxKB !== null && sizes.jsKB > jsMaxKB) {
  blockingViolations.push(
    `JS size ${formatKB(sizes.jsKB)} exceeds blocking budget ${formatKB(jsMaxKB)}`
  );
}

const cssMaxKB = toFiniteNumberOrNull(blockingGlobal.cssMaxKB);
if (cssMaxKB !== null && sizes.cssKB > cssMaxKB) {
  blockingViolations.push(
    `CSS size ${formatKB(sizes.cssKB)} exceeds blocking budget ${formatKB(cssMaxKB)}`
  );
}

const singleFileMaxKB = toFiniteNumberOrNull(blockingGlobal.singleFileMaxKB);
if (singleFileMaxKB !== null) {
  const jsCssFiles = Array.isArray(sizes.jsCssFiles) ? sizes.jsCssFiles : [];
  for (const file of jsCssFiles) {
    if (file.sizeKB > singleFileMaxKB) {
      blockingViolations.push(
        `File "${file.path}" (${formatKB(file.sizeKB)}) exceeds single-file blocking budget ${formatKB(singleFileMaxKB)}`
      );
    }
  }
}

// 5. Evaluate trend monitors (non-blocking)
const trendAlerts = [];

const globalTrendRules = budget.trend?.global ?? {};
for (const [metricKey, rule] of Object.entries(globalTrendRules)) {
  const current = toFiniteNumberOrNull(sizes?.[metricKey]);
  if (current === null) continue;

  const previous = findPreviousGlobalMetric(history, metricKey);
  const alerts = evaluateTrendRule({
    label: metricKey,
    currentKB: current,
    previousKB: previous,
    rule,
  });

  for (const alert of alerts) {
    trendAlerts.push({ scope: 'global', metric: metricKey, ...alert });
  }
}

const routeTrendRules = budget.trend?.routes ?? {};
for (const [routePath, rule] of Object.entries(routeTrendRules)) {
  const current = toFiniteNumberOrNull(sizes?.routes?.[routePath]);
  if (current === null) {
    trendAlerts.push({
      scope: 'route',
      metric: routePath,
      severity: 'warning',
      message: `Route "${routePath}" not found in current dist output (check route mapping or build output)`,
    });
    continue;
  }

  const previous = findPreviousRouteMetric(history, routePath);
  const alerts = evaluateTrendRule({
    label: `route ${routePath}`,
    currentKB: current,
    previousKB: previous,
    rule,
  });

  for (const alert of alerts) {
    trendAlerts.push({ scope: 'route', metric: routePath, ...alert });
  }
}

const trendCriticalCount = trendAlerts.filter((a) => a.severity === 'critical').length;
const trendWarningCount = trendAlerts.filter((a) => a.severity === 'warning').length;

// 6. Optional: append to history only in --record mode
if (isRecordMode) {
  // Only persist the routes that are actually trend-monitored. Recording all
  // ~3000 dist routes balloons the committed history file by ~150 KB per
  // nightly entry; the route trend rules only ever read the keys below.
  const monitoredRoutes = Object.keys(budget.trend?.routes ?? {});
  const allRoutes = sizes.routes ?? {};
  const recordedRoutes = Object.fromEntries(
    monitoredRoutes
      .filter((routePath) => routePath in allRoutes)
      .map((routePath) => [routePath, allRoutes[routePath]])
  );

  const historyEntry = {
    date: new Date().toISOString(),
    totalKB: sizes.totalKB,
    jsKB: sizes.jsKB,
    cssKB: sizes.cssKB,
    htmlKB: sizes.htmlKB,
    imgKB: sizes.imgKB,
    otherKB: sizes.otherKB,
    fileCount: sizes.fileCount,
    routeCount: sizes.routeCount,
    routes: recordedRoutes,
    blockingPassed: blockingViolations.length === 0,
    trendWarningCount,
    trendCriticalCount,
    // Keep legacy key for compatibility with existing reports.
    passed: blockingViolations.length === 0,
  };

  history.push(historyEntry);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
}

// 7. Report
console.log('=== Bundle Size Report ===');
console.log(`Mode:   ${isRecordMode ? 'record (--record)' : 'check-only (default)'}`);
console.log(`Total:  ${formatKB(sizes.totalKB)}`);
console.log(`JS:     ${formatKB(sizes.jsKB)}`);
console.log(`CSS:    ${formatKB(sizes.cssKB)}`);
console.log(`HTML:   ${formatKB(sizes.htmlKB)}`);
console.log(`Images: ${formatKB(sizes.imgKB)}`);
console.log(`Other:  ${formatKB(sizes.otherKB)}`);
console.log(`Files:  ${sizes.fileCount}`);
console.log(`Routes: ${sizes.routeCount}`);
console.log('');

if (!isRecordMode) {
  console.log('ℹ️  Check-only mode: history file was not modified.');
  console.log('');
}

if (blockingViolations.length > 0) {
  console.log('❌ BLOCKING BUDGET VIOLATIONS:');
  for (const violation of blockingViolations) {
    console.log(`  - ${violation}`);
  }
} else {
  console.log('✅ Blocking budgets passed (JS/CSS + single-file checks).');
}

console.log('');
if (trendAlerts.length > 0) {
  console.log(
    `⚠️  Trend monitor alerts (non-blocking): ${trendCriticalCount} critical, ${trendWarningCount} warning`
  );
  for (const alert of trendAlerts) {
    const icon = alert.severity === 'critical' ? '🟠' : '🟡';
    console.log(`  ${icon} ${alert.message}`);
  }
} else {
  console.log('✅ Trend monitors: no warnings.');
}

if (blockingViolations.length > 0) {
  process.exit(1);
}
