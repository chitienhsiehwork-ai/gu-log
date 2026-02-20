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
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const DIST_DIR = join(ROOT, 'dist');

// Rate limiting: max 5 requests/second
const RATE_LIMIT = 5;
const RATE_WINDOW = 1000; // ms
const REQUEST_TIMEOUT = 10_000; // 10s
const MAX_RETRIES = 1;

// Domains that are bot-hostile → needsManualCheck
const MANUAL_CHECK_DOMAINS = [
  'x.com',
  'twitter.com',
  'github.com',
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'threads.net',
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

// ── Link Extraction ──────────────────────────────────────────────

function extractLinks(content, filePath) {
  const links = [];
  const seen = new Set();

  function add(url, type, context) {
    // Clean up URL
    url = url.trim().replace(/[)>]+$/, '');
    if (!url || SKIP_PATTERNS.some((p) => p.test(url))) return;
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
  if (url.includes('gu-log.vercel.app')) return true;
  return false;
}

function isManualCheckDomain(url) {
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

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('🔗 SQAA Level 6: Broken Link Detection');
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

  console.log(`  📁 Internal: ${internal.length}`);
  console.log(`  🌐 External (auto-check): ${autoCheck.length}`);
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
  console.log('Checking external links (this may take a while)...');
  const externalOk = [];
  const externalBroken = [];
  const externalTimeout = [];

  let checked = 0;
  for (const link of autoCheck) {
    checked++;
    if (checked % 10 === 0 || checked === autoCheck.length) {
      process.stdout.write(`\r  Progress: ${checked}/${autoCheck.length}`);
    }

    const result = await checkExternalLink(link.url);
    if (result.status === 'ok') {
      externalOk.push(link);
    } else if (result.status === 'timeout') {
      externalTimeout.push({ ...link, error: result.error });
    } else {
      externalBroken.push({ ...link, statusCode: result.code, error: result.error });
    }
  }
  console.log(); // newline after progress

  // Report
  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 Results:');
  console.log(`  Internal: ✅ ${internalOk.length} OK, ❌ ${internalBroken.length} broken`);
  console.log(
    `  External: ✅ ${externalOk.length} OK, ❌ ${externalBroken.length} broken, ⏰ ${externalTimeout.length} timeout, 🔒 ${manualCheck.length} manual`
  );

  if (internalBroken.length > 0) {
    console.log('\n🚨 Broken Internal Links:');
    for (const l of internalBroken) {
      console.log(`  - ${l.url} (${l.file})`);
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
  const result = {
    date: today,
    total: allLinks.length,
    internal: {
      ok: internalOk.length,
      broken: internalBroken.map((l) => ({ url: l.url, file: l.file, context: l.context })),
    },
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
      needsManualCheck: manualCheck.map((l) => ({ url: l.url, file: l.file, context: l.context })),
    },
  };

  // Write result
  const outputPath = join(ROOT, 'quality', 'broken-links-baseline.json');
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(ROOT, 'quality'), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n💾 Results saved to quality/broken-links-baseline.json`);

  // Exit code
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
