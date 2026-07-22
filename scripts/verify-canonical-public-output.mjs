#!/usr/bin/env node

/**
 * Canonical-only build-artifact gate (OpenSpec restore-public-rebrand-redirects
 * task 2.2). Builds the legacy public source-path set independently from the
 * migration manifest and vercel.mjs's listing constants (not from
 * buildRedirectConfig's output), then checks that no legacy article/listing
 * URL leaks into `pnpm run build`'s actual output: dist/sitemap*.xml,
 * dist/rss.xml, dist/search-index*.json, and URL-bearing attributes
 * (href/src/content) in rendered HTML. Only URL-bearing fields/attributes are
 * scanned -- prose that merely mentions a retired name is not a finding.
 * Fails closed if dist/ or any required artifact is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTING_SERIES, LANG_PREFIXES } from '../vercel.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = path.join(ROOT, 'quality/brand-taxonomy-post-migration.json');
const DIST_DIR = path.join(ROOT, 'dist');
const SITE_ORIGIN = 'https://gu-log.vercel.app';

function articlePath(lang, slug) {
  return lang === 'en' ? `/en/posts/${slug}` : `/posts/${slug}`;
}

export function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/** Independent ground truth for "legacy public source path", built directly
 * from the migration manifest + the listing constants -- not from
 * buildRedirectConfig's output -- so this gate can't be fooled by a bug in
 * the redirect config it's meant to check against. */
export function buildLegacySurfaces(manifest) {
  const exactArticlePaths = new Set();
  for (const entry of manifest.entries) {
    exactArticlePaths.add(articlePath(entry.lang, entry.oldSlug));
  }
  const listingPrefixes = [];
  for (const { oldBase } of LISTING_SERIES) {
    for (const prefix of LANG_PREFIXES) {
      listingPrefixes.push(`${prefix}/${oldBase}`);
    }
  }
  return { exactArticlePaths, listingPrefixes };
}

export function isLegacyUrlPath(urlPath, legacy) {
  if (legacy.exactArticlePaths.has(urlPath)) return true;
  return legacy.listingPrefixes.some(
    (prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`)
  );
}

function toPath(urlString) {
  if (typeof urlString !== 'string' || urlString.length === 0) return null;
  try {
    const resolved = new URL(urlString, SITE_ORIGIN);
    if (resolved.origin !== SITE_ORIGIN) return null;
    const pathname = resolved.pathname;
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  } catch {
    return null;
  }
}

function findFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(entry.name)) out.push(full);
    }
  }
  return out;
}

const LOC_RE = /<loc>([^<]+)<\/loc>/g;
const LINK_RE = /<link>([^<]+)<\/link>/g;
const GUID_RE = /<guid[^>]*>([^<]+)<\/guid>/g;
const ATTR_RE = /\b(?:href|src|content)="([^"]*)"/g;

function scanXmlLike(content, patterns) {
  const urls = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      urls.push(match[1]);
    }
  }
  return urls;
}

function scanHtmlAttrs(content) {
  const urls = [];
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function checkUrls(urls, legacy, sourceLabel, violations) {
  for (const raw of urls) {
    const urlPath = toPath(raw);
    if (urlPath && isLegacyUrlPath(urlPath, legacy)) {
      violations.push({ source: sourceLabel, url: raw, path: urlPath });
    }
  }
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(
      `FAIL: ${path.relative(ROOT, DIST_DIR)} does not exist. Run "pnpm run build" before this gate.`
    );
    process.exitCode = 1;
    return;
  }

  const sitemapFiles = findFiles(DIST_DIR, (name) => /^sitemap.*\.xml$/.test(name));
  const rssPath = path.join(DIST_DIR, 'rss.xml');
  const searchIndexFiles = findFiles(DIST_DIR, (name) => /^search-index.*\.json$/.test(name));
  const htmlFiles = findFiles(DIST_DIR, (name) => name.endsWith('.html'));

  const missing = [];
  if (sitemapFiles.length === 0) missing.push('dist/sitemap*.xml');
  if (!fs.existsSync(rssPath)) missing.push('dist/rss.xml');
  if (searchIndexFiles.length === 0) missing.push('dist/search-index*.json');
  if (htmlFiles.length === 0) missing.push('dist/**/*.html');

  if (missing.length > 0) {
    console.error(`FAIL: missing required build artifacts: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const manifest = loadManifest();
  const legacy = buildLegacySurfaces(manifest);
  const violations = [];

  for (const file of sitemapFiles) {
    const content = fs.readFileSync(file, 'utf8');
    checkUrls(scanXmlLike(content, [LOC_RE]), legacy, path.relative(ROOT, file), violations);
  }

  const rssContent = fs.readFileSync(rssPath, 'utf8');
  checkUrls(
    scanXmlLike(rssContent, [LINK_RE, GUID_RE]),
    legacy,
    path.relative(ROOT, rssPath),
    violations
  );

  for (const file of searchIndexFiles) {
    const items = JSON.parse(fs.readFileSync(file, 'utf8'));
    const label = path.relative(ROOT, file);
    for (const item of items) {
      if (typeof item.slug === 'string') {
        const derivedUrl = item.lang === 'en' ? `/en/posts/${item.slug}` : `/posts/${item.slug}`;
        checkUrls([derivedUrl], legacy, `${label}#slug=${item.slug}`, violations);
      }
      if (typeof item.sourceUrl === 'string') {
        checkUrls([item.sourceUrl], legacy, `${label}#sourceUrl`, violations);
      }
    }
  }

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    checkUrls(scanHtmlAttrs(content), legacy, path.relative(ROOT, file), violations);
  }

  if (violations.length > 0) {
    console.error(`FAIL: ${violations.length} legacy public URL(s) found in build output:`);
    for (const violation of violations.slice(0, 50)) {
      console.error(`  ${violation.source}: ${violation.url}`);
    }
    if (violations.length > 50) {
      console.error(`  ... ${violations.length - 50} more`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK: canonical-only build output -- ${sitemapFiles.length} sitemap file(s), rss.xml, ${searchIndexFiles.length} search-index file(s), ${htmlFiles.length} HTML file(s) checked, 0 legacy public URLs found.`
  );
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
