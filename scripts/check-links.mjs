#!/usr/bin/env node

/**
 * SQAA Level 6: Broken Link Detection
 *
 * Scans all MDX posts for links, validates them:
 * - Internal links: checks dist/ path existence
 * - External links: HTTP HEAD with rate limiting
 * - X/Twitter & GitHub: marked as needsManualCheck (bot-hostile)
 *
 * Exit codes:
 *   0 = all good
 *   1 = external broken only (warning)
 *   2 = internal broken (should block commit)
 *   3 = fatal: unknown uncaught exception / unhandled rejection during the
 *       scan, or an unhealthy external scan dominated by failed checks
 *       (fail closed — see isKnownUndiciSocketRace below)
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const DIST_DIR = join(ROOT, 'dist');

// undici can emit a socket-level 'error' event asynchronously, after fetch()'s
// own promise has already settled inside checkExternalLink's try/catch — that
// event bypasses per-request error handling entirely and crashes the whole
// process, discarding every result from the ~900-link scan that ran before it
// (observed live: SocketError "other side closed", code UND_ERR_SOCKET).
//
// Only THAT exact, known, harmless race is tolerated. Any other uncaught
// exception or unhandled rejection is a real bug and must fail the process
// loudly (exit 3) rather than let the scan silently continue and write a
// baseline/report that looks complete when it isn't — swallowing arbitrary
// programmer errors here would be worse than the crash this was added to fix.
export function isKnownUndiciSocketRace(err) {
  return (
    !!err && typeof err === 'object' && err.name === 'SocketError' && err.code === 'UND_ERR_SOCKET'
  );
}

function handleFatalAsyncError(kind, err) {
  if (isKnownUndiciSocketRace(err)) {
    console.error(
      `⚠️  ${kind} during link check (continuing — known undici stray socket race): ${err.message}`
    );
    return;
  }
  console.error(
    `❌ FATAL: unknown ${kind.toLowerCase()} during link check — failing closed, not continuing.`
  );
  console.error(err?.stack || err);
  process.exitCode = 3;
  process.exit(3);
}

process.on('uncaughtException', (err) => handleFatalAsyncError('Uncaught exception', err));
process.on('unhandledRejection', (err) => handleFatalAsyncError('Unhandled rejection', err));

// Rate limiting: max 5 requests/second
const RATE_LIMIT = 5;
const RATE_WINDOW = 1000; // ms
const REQUEST_TIMEOUT = 10_000; // 10s
const MAX_RETRIES = 1;
const EXTERNAL_FAILURE_REJECTION_RATIO = 0.5;
const MIN_EXTERNAL_FAILURES_FOR_OUTAGE = 5;

// Domains that are bot-hostile → needsManualCheck
const MANUAL_CHECK_DOMAINS = [
  'x.com',
  'twitter.com',
  'github.com',
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'threads.net',
  // Paywalls and rate-limit-aggressive domains
  'cnbc.com',
  'bloomberg.com',
  'reuters.com',
  'wsj.com',
  'ft.com',
  'nytimes.com',
  'axios.com',
  'science.org',
  'npmjs.com',
  'substack.com',
  'venturebeat.com',
  'nof1.ai',
  'raspberrypi.com',
  'cybersecuritynews.com',
  'epilepsy.com',
  'theshamblog.com',
  'tomsguide.com',
  'winbuzzer.com',
  'theneuron.ai',
  'ai.google.dev',
  'datasette.io',
  'adplist.org',
  // Canonical pages remain browser-reachable but CI GET/HEAD requests are
  // consistently rejected by domain-level anti-bot controls (403/429).
  'deeplearning.ai',
  'news.ycombinator.com',
];

// Skip these URL patterns entirely (not real links)
const SKIP_PATTERNS = [
  /^mailto:/,
  /^tel:/,
  /^javascript:/,
  /^#/,
  /^data:/,
  /^\{\{/, // template expressions
  /^\$\{/, // template literals
];

export function isReservedExampleUrl(value) {
  try {
    const hostname = new URL(value, 'https://gu-log.invalid').hostname.toLowerCase();
    return hostname === 'example.com' || hostname.endsWith('.example.com');
  } catch {
    return false;
  }
}

// ── Link Extraction ──────────────────────────────────────────────

function extractLinks(content, filePath) {
  const links = [];
  const seen = new Set();

  function add(url, type, context) {
    // Clean up URL
    url = url.trim().replace(/[)>]+$/, '');
    if (!url || SKIP_PATTERNS.some((p) => p.test(url)) || isReservedExampleUrl(url)) return;
    const key = `${url}|${filePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ url, type, context, file: filePath });
  }

  // Strip fenced code blocks and inline code to avoid false positives
  const stripped = content
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`[^`\n]+`/g, ''); // inline code

  // 1. Frontmatter sourceUrl (use original content for frontmatter)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const sourceUrlMatch = fmMatch[1].match(/sourceUrl:\s*['"]([^'"]+)['"]/);
    if (sourceUrlMatch) {
      add(sourceUrlMatch[1], 'sourceUrl', 'frontmatter');
    }
  }

  // 2. Markdown links: [text](url)
  const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = mdLinkRe.exec(stripped)) !== null) {
    add(m[2], 'markdown', m[1] || 'link');
  }

  // 3. HTML href="url"
  const hrefRe = /href=["']([^"']+)["']/g;
  while ((m = hrefRe.exec(stripped)) !== null) {
    add(m[1], 'html', 'href');
  }

  return links;
}

// ── Classification ──────────────────────────────────────────────

function isInternalLink(url) {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  // Hostname match only — substring matching breaks on URLs that put the
  // gu-log.vercel.app domain inside a query parameter (e.g.
  // `https://api.qrserver.com/v1/create-qr-code/?data=https://gu-log.vercel.app`),
  // which is an EXTERNAL call to api.qrserver.com, not an internal link.
  try {
    const host = new URL(url).hostname;
    if (host === 'gu-log.vercel.app' || host === 'www.gu-log.vercel.app') {
      return true;
    }
  } catch {
    // not a valid absolute URL — fall through
  }
  return false;
}

export function isManualCheckDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return MANUAL_CHECK_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

// ── Internal Link Validation ─────────────────────────────────────

function checkInternalLink(url) {
  // Normalize: strip domain if present
  let path = url;
  if (url.includes('gu-log.vercel.app')) {
    try {
      path = new URL(url).pathname;
    } catch {
      return false;
    }
  }

  // Strip hash fragment before filesystem check
  path = path.replace(/#.*$/, '');

  // Remove trailing slash, add index.html logic
  path = path.replace(/\/$/, '') || '/';

  const candidates = [
    join(DIST_DIR, path),
    join(DIST_DIR, path, 'index.html'),
    join(DIST_DIR, path + '.html'),
  ];

  return candidates.some((c) => existsSync(c));
}

// ── External Link Validation (with rate limiting) ────────────────

class RateLimiter {
  constructor(maxPerWindow, windowMs) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  async wait() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => t > now - this.windowMs);
    if (this.timestamps.length >= this.maxPerWindow) {
      const waitTime = this.timestamps[0] + this.windowMs - now;
      await new Promise((r) => setTimeout(r, waitTime));
    }
    this.timestamps.push(Date.now());
  }
}

const rateLimiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW);

async function checkExternalLink(url, retries = MAX_RETRIES) {
  await rateLimiter.wait();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    // Try HEAD first, fall back to GET if HEAD fails with 405
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };

    let res = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    // Some servers don't support HEAD
    if (res.status === 405 || res.status === 403) {
      clearTimeout(timeout);
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), REQUEST_TIMEOUT);
      try {
        res = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller2.signal,
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timeout2);
      }
    }

    if (res.ok || res.status === 301 || res.status === 302 || res.status === 308) {
      return { status: 'ok', code: res.status };
    }

    // Retry on server errors
    if (res.status >= 500 && retries > 0) {
      await new Promise((r) => setTimeout(r, 2000));
      return checkExternalLink(url, retries - 1);
    }

    return { status: 'broken', code: res.status };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 2000));
        return checkExternalLink(url, retries - 1);
      }
      return { status: 'timeout', error: 'Request timed out' };
    }
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000));
      return checkExternalLink(url, retries - 1);
    }
    return { status: 'broken', error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// Coalesce exact-URL duplicates before touching the network, then fan each
// result back out to every source occurrence. This keeps per-file reporting
// intact while preventing popular sources from being fetched once per post.
// Checks intentionally remain sequential: the current RateLimiter is designed
// for one caller, and making it concurrency-safe is a separate scheduling job.
export async function scanExternalLinks(
  links,
  checker = checkExternalLink,
  onProgress = /** @type {((checked: number, total: number) => void) | null} */ (null)
) {
  const uniqueUrls = [...new Set(links.map((link) => link.url))];
  const resultByUrl = new Map();

  for (const [index, url] of uniqueUrls.entries()) {
    const result = await checker(url);
    if (!['ok', 'broken', 'timeout'].includes(result?.status)) {
      throw new Error(`External link checker returned an invalid result for ${url}`);
    }
    resultByUrl.set(url, result);
    onProgress?.(index + 1, uniqueUrls.length);
  }

  const externalOk = [];
  const externalBroken = [];
  const externalTimeout = [];

  // Iterate the original occurrence list so baseline/report ordering remains
  // deterministic and every source file still gets its own diagnostic.
  for (const link of links) {
    const result = resultByUrl.get(link.url);
    if (result.status === 'ok') {
      externalOk.push(link);
    } else if (result.status === 'timeout') {
      externalTimeout.push({ ...link, error: result.error });
    } else {
      externalBroken.push({ ...link, statusCode: result.code, error: result.error });
    }
  }

  const uniqueResults = [...resultByUrl.values()];
  return {
    externalOk,
    externalBroken,
    externalTimeout,
    health: {
      attempted: uniqueResults.length,
      ok: uniqueResults.filter((result) => result.status === 'ok').length,
      broken: uniqueResults
        .filter((result) => result.status === 'broken')
        .map((result) => ({ statusCode: result.code, error: result.error })),
      timedOut: uniqueResults.filter((result) => result.status === 'timeout').length,
    },
  };
}

// A normal link scan can contain a handful of real HTTP failures and transient
// network errors. A failure-dominated scan, however, describes the scanner,
// proxy, or network more reliably than it describes the links. Count both
// transport failures and unsuccessful HTTP responses: a proxy that returns
// 403/429/503 for every request still completed at the transport layer but must
// not replace the last trustworthy baseline.
export function evaluateExternalScanHealth({ internalOnly, attempted, ok, broken, timedOut }) {
  if (internalOnly) {
    return {
      healthy: true,
      skipped: true,
      responseFailures: 0,
      transportFailures: 0,
      totalFailures: 0,
      failureRatio: 0,
      transportFailureRatio: 0,
    };
  }

  const responseFailures = broken.filter((link) => Number.isInteger(link.statusCode)).length;
  const transportFailures = timedOut + (broken.length - responseFailures);
  const totalFailures = responseFailures + transportFailures;
  const observed = ok + broken.length + timedOut;
  const failureRatio = attempted === 0 ? 0 : totalFailures / attempted;
  const transportFailureRatio = attempted === 0 ? 0 : transportFailures / attempted;
  const complete = observed === attempted;
  const failureDominated =
    totalFailures >= MIN_EXTERNAL_FAILURES_FOR_OUTAGE &&
    failureRatio >= EXTERNAL_FAILURE_REJECTION_RATIO;

  return {
    healthy: complete && !failureDominated,
    skipped: false,
    complete,
    observed,
    responseFailures,
    transportFailures,
    totalFailures,
    failureRatio,
    transportFailureRatio,
    failureDominated,
  };
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const internalOnly = args.includes('--internal-only');
  const isCI = process.env.CI === 'true' || args.includes('--ci');
  const outputPath = join(ROOT, 'quality', 'broken-links-baseline.json');

  // Load previous baseline BEFORE we overwrite it — used for CI ratchet comparison
  let previousBaseline = null;
  if (isCI && existsSync(outputPath)) {
    try {
      previousBaseline = JSON.parse(await readFile(outputPath, 'utf-8'));
    } catch {
      /* ignore parse errors */
    }
  }

  console.log('🔗 SQAA Level 6: Broken Link Detection');
  if (internalOnly) console.log('  Mode: --internal-only (skipping external checks)');
  console.log('═'.repeat(50));

  // Check dist exists
  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist/ not found. Run `pnpm build` first.');
    process.exit(2);
  }

  // Scan all MDX files
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.mdx'));
  console.log(`📄 Scanning ${files.length} MDX files...\n`);

  // Extract all links
  const allLinks = [];
  for (const file of files) {
    const content = await readFile(join(POSTS_DIR, file), 'utf-8');
    const links = extractLinks(content, file);
    allLinks.push(...links);
  }

  console.log(`🔍 Found ${allLinks.length} total links\n`);

  // Classify
  const internal = allLinks.filter((l) => isInternalLink(l.url));
  const external = allLinks.filter((l) => !isInternalLink(l.url));
  const manualCheck = external.filter((l) => isManualCheckDomain(l.url));
  const autoCheck = external.filter((l) => !isManualCheckDomain(l.url));
  const uniqueAutoCheckCount = new Set(autoCheck.map((link) => link.url)).size;

  console.log(`  📁 Internal: ${internal.length}`);
  console.log(
    `  🌐 External (auto-check): ${autoCheck.length} references / ${uniqueAutoCheckCount} unique URLs`
  );
  console.log(`  🔒 External (manual-check): ${manualCheck.length}`);
  console.log();

  // Validate internal links
  console.log('Checking internal links...');
  const internalOk = [];
  const internalBroken = [];

  for (const link of internal) {
    if (checkInternalLink(link.url)) {
      internalOk.push(link);
    } else {
      internalBroken.push(link);
      console.log(`  ❌ ${link.url} (in ${link.file})`);
    }
  }

  console.log(`  ✅ ${internalOk.length} OK, ❌ ${internalBroken.length} broken\n`);

  // Validate external links (auto-check only)
  let externalOk = [];
  let externalBroken = [];
  let externalTimeout = [];
  let externalHealth = {
    attempted: uniqueAutoCheckCount,
    ok: 0,
    broken: [],
    timedOut: 0,
  };

  if (internalOnly) {
    console.log('Skipping external link checks (--internal-only mode).');
  } else {
    console.log('Checking external links (this may take a while)...');
    const scan = await scanExternalLinks(autoCheck, checkExternalLink, (checked, total) => {
      if (checked % 10 === 0 || checked === total) {
        process.stdout.write(`\r  Progress: ${checked}/${total} unique URLs`);
      }
    });
    ({ externalOk, externalBroken, externalTimeout, health: externalHealth } = scan);
    console.log(); // newline after progress
  }

  const externalScanHealth = evaluateExternalScanHealth({
    internalOnly,
    ...externalHealth,
  });

  // Report
  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 Results:');
  console.log(`  Internal: ✅ ${internalOk.length} OK, ❌ ${internalBroken.length} broken`);
  if (internalOnly) {
    console.log(`  External: ⏭️ skipped (--internal-only)`);
  } else {
    console.log(
      `  External: ✅ ${externalOk.length} OK, ❌ ${externalBroken.length} broken, ⏰ ${externalTimeout.length} timeout, 🔒 ${manualCheck.length} manual`
    );
  }

  if (!externalScanHealth.healthy) {
    const ratio = (externalScanHealth.failureRatio * 100).toFixed(1);
    console.error(
      `\n❌ FATAL: External scan is unhealthy — ${externalScanHealth.totalFailures}/${externalHealth.attempted} (${ratio}%) unique URL checks failed (${externalScanHealth.responseFailures} HTTP error responses, ${externalScanHealth.transportFailures} transport failures).`
    );
    if (!externalScanHealth.complete) {
      console.error(
        `   Scan result is incomplete: observed ${externalScanHealth.observed}/${externalHealth.attempted} attempted unique URL checks.`
      );
    }
    console.error('   Existing broken-links baseline was not updated.');
    process.exit(3);
  }

  if (internalBroken.length > 0) {
    console.log('\n🚨 Broken Internal Links:');
    for (const l of internalBroken) {
      console.log(`  - ${l.url} (${l.file})`);
      if (isCI) {
        console.log(`::error file=src/content/posts/${l.file}::Broken internal link: ${l.url}`);
      }
    }
  }

  if (externalBroken.length > 0) {
    console.log('\n⚠️  Broken External Links:');
    for (const l of externalBroken) {
      console.log(
        `  - [${l.statusCode || 'ERR'}] ${l.url} (${l.file})${l.error ? ` — ${l.error}` : ''}`
      );
    }
  }

  if (externalTimeout.length > 0) {
    console.log('\n⏰ Timed Out:');
    for (const l of externalTimeout) {
      console.log(`  - ${l.url} (${l.file})`);
    }
  }

  if (manualCheck.length > 0) {
    console.log(`\n🔒 Needs Manual Check (${manualCheck.length} links from bot-hostile domains):`);
    // Group by domain
    const byDomain = {};
    for (const l of manualCheck) {
      try {
        const d = new URL(l.url).hostname;
        byDomain[d] = (byDomain[d] || 0) + 1;
      } catch {
        /* skip */
      }
    }
    for (const [domain, count] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${domain}: ${count} links`);
    }
  }

  // Build result JSON
  const today = new Date().toISOString().split('T')[0];
  // When --internal-only, preserve existing external data from baseline
  let preservedExternal = null;
  if (internalOnly && existsSync(outputPath)) {
    try {
      const existing = JSON.parse(await readFile(outputPath, 'utf-8'));
      if (existing.external) preservedExternal = existing.external;
    } catch {
      // ignore parse errors — will omit external key
    }
  }

  const result = {
    date: today,
    total: allLinks.length,
    internal: {
      ok: internalOk.length,
      broken: internalBroken.map((l) => ({ url: l.url, file: l.file, context: l.context })),
    },
    ...(internalOnly
      ? preservedExternal !== null
        ? { external: preservedExternal }
        : {}
      : {
          external: {
            ok: externalOk.length,
            broken: externalBroken.map((l) => ({
              url: l.url,
              file: l.file,
              context: l.context,
              statusCode: l.statusCode,
              error: l.error,
            })),
            timeout: externalTimeout.map((l) => ({ url: l.url, file: l.file, context: l.context })),
            needsManualCheck: manualCheck.map((l) => ({
              url: l.url,
              file: l.file,
              context: l.context,
            })),
          },
        }),
  };

  // Write result
  await mkdir(join(ROOT, 'quality'), { recursive: true });
  const temporaryOutputPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryOutputPath, JSON.stringify(result, null, 2) + '\n');
    await rename(temporaryOutputPath, outputPath);
  } finally {
    await rm(temporaryOutputPath, { force: true });
  }
  console.log(`\n💾 Results saved to quality/broken-links-baseline.json`);

  // Exit code — CI mode uses baseline ratchet: new breakages fail, known baseline tolerated
  if (isCI && previousBaseline) {
    const baselineInternalUrls = new Set(
      (previousBaseline.internal?.broken || []).map((l) => l.url)
    );
    const newInternalBroken = internalBroken.filter((l) => !baselineInternalUrls.has(l.url));

    const baselineExternalUrls = new Set(
      (previousBaseline.external?.broken || []).map((l) => l.url)
    );
    const newExternalBroken = externalBroken.filter((l) => !baselineExternalUrls.has(l.url));

    if (newInternalBroken.length > 0) {
      console.log(
        `\n🚨 EXIT 2: ${newInternalBroken.length} NEW broken internal link(s) found (should block merge)`
      );
      process.exit(2);
    } else if (newExternalBroken.length > 0) {
      console.log(`\n⚠️  EXIT 1: ${newExternalBroken.length} NEW broken external link(s) found`);
      process.exit(1);
    } else {
      const known = internalBroken.length + externalBroken.length;
      if (known > 0) {
        console.log(
          `\n✅ EXIT 0: No NEW broken links (${known} known-broken link(s) in baseline — tolerated)`
        );
      } else {
        console.log('\n✅ EXIT 0: All links OK');
      }
      process.exit(0);
    }
  } else {
    // Non-CI mode (or first run with no baseline): original behavior
    if (internalBroken.length > 0) {
      console.log('\n🚨 EXIT 2: Internal broken links found (should block commit)');
      process.exit(2);
    } else if (externalBroken.length > 0) {
      console.log('\n⚠️  EXIT 1: External broken links found (warning)');
      process.exit(1);
    } else {
      console.log('\n✅ EXIT 0: All links OK');
      process.exit(0);
    }
  }
}

// Guard so this module can be imported (e.g. to test isKnownUndiciSocketRace
// or the process-level handlers registered above) without triggering a full
// scan — main() only runs when this file is executed directly. Compares
// resolved filesystem paths rather than raw import.meta.url / argv[1]
// strings: a naive `import.meta.url === \`file://${process.argv[1]}\`` check
// silently fails (and skips main() entirely — a silent no-op, not a crash)
// when the path contains spaces or non-ASCII characters, since import.meta.url
// percent-encodes those and argv[1] doesn't.
const isDirectlyExecuted = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isDirectlyExecuted) {
  main().catch((err) => {
    console.error('❌ FATAL: unknown error during link check — failing closed.');
    console.error(err?.stack || err);
    process.exit(3);
  });
}
