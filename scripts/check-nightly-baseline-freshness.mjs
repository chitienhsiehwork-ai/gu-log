#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_AGE_DAYS = 3;

function parseIsoDay(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD string, got ${JSON.stringify(value)}`);
  }

  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a real calendar date: ${value}`);
  }
  return timestamp;
}

export function latestCoverageHistoryDate(history) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('quality/coverage-history.json must be a non-empty array');
  }

  const dates = history.map((entry, index) => {
    const date = entry?.date;
    parseIsoDay(date, `quality/coverage-history.json entry ${index}.date`);
    return date;
  });
  return dates.sort().at(-1);
}

export function evaluateBaselineFreshness({
  coverageHistory,
  brokenLinksBaseline,
  today = new Date().toISOString().slice(0, 10),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
}) {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new Error(`maxAgeDays must be a non-negative integer, got ${maxAgeDays}`);
  }

  const todayTimestamp = parseIsoDay(today, 'today');
  const checks = [
    {
      path: 'quality/coverage-history.json',
      date: latestCoverageHistoryDate(coverageHistory),
      stagingBranch: 'nightly/coverage-baseline-staging',
    },
    {
      path: 'quality/broken-links-baseline.json',
      date: brokenLinksBaseline?.date,
      stagingBranch: 'nightly/links-baseline-staging',
    },
  ].map((check) => {
    const timestamp = parseIsoDay(check.date, `${check.path} freshness date`);
    const ageDays = Math.floor((todayTimestamp - timestamp) / DAY_MS);
    if (ageDays < 0) {
      throw new Error(`${check.path} freshness date is in the future: ${check.date}`);
    }
    return { ...check, ageDays, stale: ageDays > maxAgeDays };
  });

  return { checks, maxAgeDays, stale: checks.some((check) => check.stale) };
}

async function main() {
  const coverageHistory = JSON.parse(
    await readFile(resolve(ROOT, 'quality/coverage-history.json'), 'utf8')
  );
  const brokenLinksBaseline = JSON.parse(
    await readFile(resolve(ROOT, 'quality/broken-links-baseline.json'), 'utf8')
  );
  const result = evaluateBaselineFreshness({ coverageHistory, brokenLinksBaseline });

  for (const check of result.checks) {
    if (check.stale) {
      console.error(
        `::error file=${check.path}::Freshness signal is ${check.ageDays} days old ` +
          `(date: ${check.date}, max: ${result.maxAgeDays}). A staging branch is likely ` +
          `waiting to be merged — check ${check.stagingBranch}.`
      );
    } else {
      console.log(
        `OK ${check.path}: ${check.ageDays} day(s) old ` +
          `(within ${result.maxAgeDays}-day budget; date ${check.date}).`
      );
    }
  }

  if (result.stale) process.exitCode = 1;
}

const isDirectlyExecuted = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error(`::error::Baseline freshness check failed closed: ${error.message}`);
    process.exit(1);
  });
}
