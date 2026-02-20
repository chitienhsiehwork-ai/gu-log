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

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const QUALITY = join(ROOT, 'quality');
const RULES_PATH = join(QUALITY, 'dependency-rules.json');
const BASELINE_PATH = join(QUALITY, 'dependency-freshness-baseline.json');
const HISTORY_PATH = join(QUALITY, 'dependency-freshness-history.json');

const verbose = process.argv.includes('--verbose');

/* ── helpers ─────────────────────────────────────────────────────── */

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // pnpm outdated exits 1 when there ARE outdated packages – that's fine
    return e.stdout || '';
  }
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

async function registryView(pkg, field) {
  try {
    const raw = execSync(`pnpm view ${pkg} ${field} --json 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function isDeprecated(pkg) {
  try {
    const raw = execSync(`pnpm view ${pkg} deprecated 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return raw.trim().length > 0 ? raw.trim() : false;
  } catch {
    return false;
  }
}

async function lastPublishDate(pkg) {
  const time = await registryView(pkg, 'time');
  if (!time || typeof time !== 'object') return null;
  // find the most recent version timestamp (skip "created" and "modified")
  let latest = null;
  for (const [key, val] of Object.entries(time)) {
    if (key === 'created' || key === 'modified') continue;
    const d = new Date(val);
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

/* ── main ────────────────────────────────────────────────────────── */

async function main() {
  // 1. Get outdated info
  const outdatedRaw = run('pnpm outdated --json');
  let outdatedMap = {};
  try {
    outdatedMap = JSON.parse(outdatedRaw);
  } catch {
    // no outdated packages or parse error
  }

  // 2. Get all direct dependencies
  const lsRaw = run('pnpm ls --json --depth 0');
  let lsData;
  try {
    lsData = JSON.parse(lsRaw);
  } catch {
    console.error('Failed to parse pnpm ls output');
    process.exit(1);
  }

  const root = Array.isArray(lsData) ? lsData[0] : lsData;
  const allDeps = {
    ...(root.dependencies || {}),
    ...(root.devDependencies || {}),
  };

  // Build package list
  const pkgNames = Object.keys(allDeps);
  console.log(`Scanning ${pkgNames.length} direct dependencies…\n`);

  const details = [];
  const counters = { fresh: 0, stale: 0, outdated: 0, deprecated: 0, possiblyUnmaintained: 0 };

  for (const name of pkgNames) {
    const info = allDeps[name];
    const current = info.version;
    const outdatedInfo = outdatedMap[name];
    const latest = outdatedInfo?.latest || current;

    let status = classifyVersion(current, latest);

    // Check deprecated
    await sleep(200); // rate-limit
    const deprecatedMsg = await isDeprecated(name);

    // Check last publish date
    await sleep(200);
    const lastPub = await lastPublishDate(name);
    const yearsAgo = lastPub
      ? (Date.now() - lastPub.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
      : null;
    const possiblyUnmaintained = yearsAgo !== null && yearsAgo > 2;

    if (deprecatedMsg) status = 'deprecated';

    counters[status]++;
    if (possiblyUnmaintained) counters.possiblyUnmaintained++;

    const entry = {
      name,
      current,
      latest,
      status,
      ...(deprecatedMsg ? { deprecatedMessage: deprecatedMsg } : {}),
      ...(lastPub ? { lastPublish: lastPub.toISOString().slice(0, 10) } : {}),
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
