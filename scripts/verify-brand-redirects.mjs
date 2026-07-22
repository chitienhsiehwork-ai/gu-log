#!/usr/bin/env node

/**
 * Bounded-concurrency full-manifest audit of the public redirect contract
 * (vercel.mjs) against a real deployment (Vercel Preview or Production).
 * Read-only: issues GET requests with manual/follow redirect modes only,
 * never mutates anything. Intended to be run manually against a stacked-PR
 * Preview URL before merge, and against production after cutover — not
 * wired into CI (no fixed deployment URL exists at PR time).
 *
 * Usage:
 *   node scripts/verify-brand-redirects.mjs --base-url https://<deployment> [--concurrency 8] [--timeout 10000]
 */

import { config as redirectConfig } from '../vercel.mjs';

// vercel.mjs emits the numeric-pagination rule as source `:page(\d+)`
// (Vercel capture-with-regex syntax) and destination `:page` (bare capture
// reference -- Vercel destinations may only reference the capture name, not
// repeat its regex). These must be materialized with separate patterns.
const SOURCE_PAGE_PATTERN = ':page(\\d+)';
const DESTINATION_PAGE_PATTERN = ':page';
const AUDIT_PAGE_NUMBER = 2;

function materializeSource(routeString) {
  return routeString.includes(SOURCE_PAGE_PATTERN)
    ? routeString.replace(SOURCE_PAGE_PATTERN, String(AUDIT_PAGE_NUMBER))
    : routeString;
}

function materializeDestination(routeString) {
  return routeString.includes(DESTINATION_PAGE_PATTERN)
    ? routeString.replace(DESTINATION_PAGE_PATTERN, String(AUDIT_PAGE_NUMBER))
    : routeString;
}

function parseArgs(argv) {
  const args = { concurrency: 8, timeoutMs: 10000, baseUrl: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-url') args.baseUrl = argv[++i];
    else if (arg === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (arg === '--timeout') args.timeoutMs = Number(argv[++i]);
    else {
      console.error(`unknown argument: ${arg}`);
      process.exitCode = 2;
    }
  }
  return args;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkRedirect(baseUrl, redirect, timeoutMs) {
  const source = materializeSource(redirect.source);
  const destination = materializeDestination(redirect.destination);
  const oldUrl = new URL(source, baseUrl).toString();
  const expectedLocation = new URL(destination, baseUrl).toString();

  try {
    const raw = await fetchWithTimeout(oldUrl, { redirect: 'manual' }, timeoutMs);
    if (raw.status !== 308) {
      return { ok: false, source, reason: `raw status ${raw.status} != 308` };
    }
    const rawLocation = raw.headers.get('location');
    const resolvedLocation = rawLocation ? new URL(rawLocation, oldUrl).toString() : null;
    if (resolvedLocation !== expectedLocation) {
      return {
        ok: false,
        source,
        reason: `Location "${resolvedLocation}" != "${expectedLocation}"`,
      };
    }

    const followed = await fetchWithTimeout(oldUrl, { redirect: 'follow' }, timeoutMs);
    if (followed.status !== 200) {
      return { ok: false, source, reason: `followed status ${followed.status} != 200` };
    }
    if (followed.url !== expectedLocation) {
      return {
        ok: false,
        source,
        reason: `followed URL "${followed.url}" != "${expectedLocation}" (possible redirect chain/loop)`,
      };
    }

    return { ok: true, source };
  } catch (error) {
    return { ok: false, source, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, runNext)
  );
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.exitCode === 2) return;
  if (!args.baseUrl) {
    console.error(
      'usage: node scripts/verify-brand-redirects.mjs --base-url <url> [--concurrency N] [--timeout ms]'
    );
    process.exitCode = 2;
    return;
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    console.error(`invalid --concurrency: ${args.concurrency}`);
    process.exitCode = 2;
    return;
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    console.error(`invalid --timeout: ${args.timeoutMs}`);
    process.exitCode = 2;
    return;
  }

  const redirects = redirectConfig.redirects;
  console.log(
    `Auditing ${redirects.length} redirects against ${args.baseUrl} (concurrency=${args.concurrency})`
  );

  const results = await runPool(
    redirects,
    (redirect) => checkRedirect(args.baseUrl, redirect, args.timeoutMs),
    args.concurrency
  );

  const failures = results.filter((result) => !result.ok);
  console.log(`Result: ${results.length - failures.length}/${results.length} passed`);
  for (const failure of failures.slice(0, 50)) {
    console.error(`FAIL ${failure.source}: ${failure.reason}`);
  }
  if (failures.length > 50) {
    console.error(`... ${failures.length - 50} more failures`);
  }

  process.exitCode = failures.length > 0 ? 1 : 0;
}

await main();
