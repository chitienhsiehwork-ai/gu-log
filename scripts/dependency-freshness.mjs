#!/usr/bin/env node
/**
 * Dependency Freshness Scanner (SQAA Level 7)
 *
 * Classifies every direct dependency as:
 *   🟢 Fresh   – current === latest, or only a patch bump behind
 *   🟡 Stale   – behind by minor version(s)
 *   🔴 Outdated – behind by major version(s)
 *   ⛔ Deprecated – explicitly deprecated in registry metadata
 *
 * Also flags packages whose last publish was > N years ago
 * as "possibly unmaintained".
 */

import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const QUALITY = join(ROOT, 'quality');
const RULES_PATH = join(QUALITY, 'dependency-rules.json');
const BASELINE_PATH = join(QUALITY, 'dependency-freshness-baseline.json');
const HISTORY_PATH = join(QUALITY, 'dependency-freshness-history.json');
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

const verbose = process.argv.includes('--verbose');

/* ── helpers ─────────────────────────────────────────────────────── */

function commandTimeoutMs() {
  const raw = process.env.DEPENDENCY_FRESHNESS_COMMAND_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('DEPENDENCY_FRESHNESS_COMMAND_TIMEOUT_MS must be a positive integer');
  }
  return value;
}

const COMMAND_TIMEOUT_MS = commandTimeoutMs();

function childOutput(error, field) {
  if (!error || typeof error !== 'object' || !(field in error)) return '';
  const output = error[field];
  if (typeof output === 'string') return output;
  if (Buffer.isBuffer(output)) return output.toString('utf-8');
  return '';
}

function runJson(args, { allowExitOne = false } = {}) {
  let raw;
  try {
    raw = execFileSync('pnpm', args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    const stderr = childOutput(error, 'stderr');
    if (
      allowExitOne &&
      error &&
      typeof error === 'object' &&
      error.status === 1 &&
      stderr.trim() === ''
    ) {
      raw = childOutput(error, 'stdout');
    } else {
      const timedOut =
        error &&
        typeof error === 'object' &&
        (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM');
      const command = `pnpm ${args.join(' ')}`;
      const systemError =
        error &&
        typeof error === 'object' &&
        typeof error.code === 'string' &&
        error.code !== 'ETIMEDOUT'
          ? error.code
          : null;
      throw new Error(
        timedOut
          ? `${command} timed out after ${COMMAND_TIMEOUT_MS}ms`
          : systemError
            ? `${command} failed with ${systemError}`
            : `${command} failed${error?.status == null ? '' : ` with exit ${error.status}`}`
      );
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`pnpm ${args.join(' ')} returned invalid JSON`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function semverParts(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function classifyVersion(current, latest) {
  const c = semverParts(current);
  const l = semverParts(latest);
  if (!c || !l) return 'fresh'; // can't compare → assume fresh
  if (l.major > c.major) return 'outdated';
  if (l.minor > c.minor) return 'stale';
  return 'fresh'; // same or only patch diff
}

function registryMetadata(pkg) {
  const metadata = runJson(['view', pkg, 'deprecated', 'time', '--json']);
  if (!isRecord(metadata)) {
    throw new Error(`pnpm view ${pkg} returned incomplete registry metadata`);
  }

  // pnpm collapses a multi-field query to the one populated field. A package
  // without a deprecation message therefore returns the time map directly;
  // deprecated packages return the keyed { deprecated, time } shape.
  const time = isRecord(metadata.time) ? metadata.time : metadata;
  const deprecated = isRecord(metadata.time) ? metadata.deprecated : undefined;
  if (
    deprecated !== undefined &&
    deprecated !== null &&
    deprecated !== false &&
    typeof deprecated !== 'string'
  ) {
    throw new Error(`pnpm view ${pkg} returned invalid deprecated metadata`);
  }
  const deprecatedMessage = typeof deprecated === 'string' ? deprecated.trim() : '';

  // find the most recent version timestamp (skip "created" and "modified")
  let latest = null;
  for (const [key, val] of Object.entries(time)) {
    if (key === 'created' || key === 'modified') continue;
    const d = new Date(val);
    if (!Number.isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
  }
  if (!latest) {
    throw new Error(`pnpm view ${pkg} returned no valid publish timestamps`);
  }

  return { deprecatedMessage, lastPublishDate: latest };
}

/* ── main ────────────────────────────────────────────────────────── */

async function main() {
  // 1. Get outdated info
  const outdatedMap = runJson(['outdated', '--json'], { allowExitOne: true });
  if (!isRecord(outdatedMap)) {
    throw new Error('pnpm outdated returned a non-object result');
  }

  // 2. Get all direct dependencies
  const lsData = runJson(['ls', '--json', '--depth', '0']);
  const root = Array.isArray(lsData) ? lsData[0] : lsData;
  if (!isRecord(root)) {
    throw new Error('pnpm ls returned an invalid root package');
  }

  const allDeps = {
    ...(isRecord(root.dependencies) ? root.dependencies : {}),
    ...(isRecord(root.devDependencies) ? root.devDependencies : {}),
  };

  // Build package list
  const pkgNames = Object.keys(allDeps);
  console.log(`Scanning ${pkgNames.length} direct dependencies…\n`);

  const details = [];
  const counters = { fresh: 0, stale: 0, outdated: 0, deprecated: 0, possiblyUnmaintained: 0 };

  for (const name of pkgNames) {
    const info = allDeps[name];
    if (!isRecord(info) || typeof info.version !== 'string' || info.version.length === 0) {
      throw new Error(`pnpm ls returned an invalid installed version for ${name}`);
    }
    const current = info.version;
    const outdatedInfo = outdatedMap[name];
    if (outdatedInfo !== undefined && !isRecord(outdatedInfo)) {
      throw new Error(`pnpm outdated returned invalid data for ${name}`);
    }
    if (
      outdatedInfo?.latest !== undefined &&
      (typeof outdatedInfo.latest !== 'string' || outdatedInfo.latest.length === 0)
    ) {
      throw new Error(`pnpm outdated returned an invalid latest version for ${name}`);
    }
    const latest = outdatedInfo?.latest || current;

    let status = classifyVersion(current, latest);

    // Fetch deprecated and publish-time metadata in one registry request.
    const { deprecatedMessage, lastPublishDate } = registryMetadata(name);
    const yearsAgo = (Date.now() - lastPublishDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    const possiblyUnmaintained = yearsAgo > 2;

    if (deprecatedMessage) status = 'deprecated';

    counters[status]++;
    if (possiblyUnmaintained) counters.possiblyUnmaintained++;

    const entry = {
      name,
      current,
      latest,
      status,
      ...(deprecatedMessage ? { deprecatedMessage } : {}),
      lastPublish: lastPublishDate.toISOString().slice(0, 10),
      ...(possiblyUnmaintained ? { possiblyUnmaintained: true } : {}),
      dependencyType:
        outdatedInfo?.dependencyType ||
        (root.dependencies?.[name] ? 'dependencies' : 'devDependencies'),
    };

    const icon = { fresh: '🟢', stale: '🟡', outdated: '🔴', deprecated: '⛔' }[status];
    if (verbose || status !== 'fresh') {
      console.log(
        `  ${icon} ${name}  ${current} → ${latest}${possiblyUnmaintained ? ' ⚠️  possibly unmaintained' : ''}`
      );
    }

    details.push(entry);
  }

  const report = {
    date: new Date().toISOString().slice(0, 10),
    total: pkgNames.length,
    fresh: counters.fresh,
    stale: counters.stale,
    outdated: counters.outdated,
    deprecated: counters.deprecated,
    possiblyUnmaintained: counters.possiblyUnmaintained,
    details,
  };

  // ── print summary ──
  console.log('\n─── Dependency Freshness Report ───');
  console.log(`  Total:   ${report.total}`);
  console.log(`  🟢 Fresh:      ${report.fresh}`);
  console.log(`  🟡 Stale:      ${report.stale}`);
  console.log(`  🔴 Outdated:   ${report.outdated}`);
  console.log(`  ⛔ Deprecated: ${report.deprecated}`);
  console.log(`  ⚠️  Possibly unmaintained: ${report.possiblyUnmaintained}`);
  console.log('───────────────────────────────────\n');

  // ── save baseline ──
  mkdirSync(QUALITY, { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Baseline saved → ${BASELINE_PATH}`);

  // ── append history ──
  let history = [];
  if (existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
    } catch {
      /* start fresh */
    }
  }
  history.push({
    date: report.date,
    total: report.total,
    fresh: report.fresh,
    stale: report.stale,
    outdated: report.outdated,
    deprecated: report.deprecated,
    possiblyUnmaintained: report.possiblyUnmaintained,
  });
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n');
  console.log(`History updated → ${HISTORY_PATH}`);

  // ── enforce rules ──
  let rules = {
    blockOnDeprecated: true,
    warnOnOutdated: true,
    warnOnUnmaintainedYears: 2,
    maxOutdatedPercent: 30,
  };
  if (existsSync(RULES_PATH)) {
    try {
      rules = JSON.parse(readFileSync(RULES_PATH, 'utf-8'));
    } catch {
      /* use defaults */
    }
  }

  let exitCode = 0;

  if (rules.blockOnDeprecated && report.deprecated > 0) {
    const depPkgs = details.filter((d) => d.status === 'deprecated').map((d) => d.name);
    console.error(
      `\n❌ BLOCKED: ${report.deprecated} deprecated package(s): ${depPkgs.join(', ')}`
    );
    exitCode = 2;
  }

  const outdatedPercent =
    report.total > 0 ? ((report.outdated / report.total) * 100).toFixed(1) : 0;
  if (rules.warnOnOutdated && outdatedPercent > rules.maxOutdatedPercent) {
    console.warn(
      `\n⚠️  WARNING: ${outdatedPercent}% packages are outdated (budget: ${rules.maxOutdatedPercent}%)`
    );
    if (exitCode === 0) exitCode = 1;
  }

  if (report.possiblyUnmaintained > 0) {
    const unmPkgs = details
      .filter((d) => d.possiblyUnmaintained)
      .map((d) => `${d.name} (last: ${d.lastPublish})`);
    console.warn(`\n⚠️  Possibly unmaintained: ${unmPkgs.join(', ')}`);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
