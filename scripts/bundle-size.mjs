#!/usr/bin/env node
/**
 * Bundle Size Analyzer for gu-log
 * Scans dist/ directory and reports sizes by category + route-level HTML sizes.
 * Outputs JSON to stdout.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const DIST_DIR = new URL('../dist/', import.meta.url).pathname;

const JS_EXTS = new Set(['.js', '.mjs']);
const CSS_EXTS = new Set(['.css']);
const HTML_EXTS = new Set(['.html', '.htm']);
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);

function toPosixPath(pathValue) {
  return pathValue.split(sep).join('/');
}

function walkDir(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      const size = statSync(fullPath).size;
      const relPath = toPosixPath(relative(DIST_DIR, fullPath));
      results.push({ path: relPath, size });
    }
  }

  return results;
}

function toKB(bytes) {
  return +(bytes / 1024).toFixed(2);
}

function htmlPathToRoute(htmlPath) {
  if (htmlPath === 'index.html') return '/';
  if (htmlPath.endsWith('/index.html')) {
    return `/${htmlPath.slice(0, -'index.html'.length)}`;
  }
  if (htmlPath.endsWith('.html')) {
    return `/${htmlPath.slice(0, -'.html'.length)}`;
  }
  if (htmlPath.endsWith('.htm')) {
    return `/${htmlPath.slice(0, -'.htm'.length)}`;
  }
  return null;
}

function analyze() {
  const files = walkDir(DIST_DIR);

  let totalSize = 0;
  let jsSize = 0;
  let cssSize = 0;
  let htmlSize = 0;
  let imgSize = 0;

  const routeByteMap = {};
  const jsCssFiles = [];

  for (const f of files) {
    totalSize += f.size;
    const ext = extname(f.path).toLowerCase();

    if (JS_EXTS.has(ext)) {
      jsSize += f.size;
      jsCssFiles.push({ path: f.path, sizeKB: toKB(f.size) });
      continue;
    }

    if (CSS_EXTS.has(ext)) {
      cssSize += f.size;
      jsCssFiles.push({ path: f.path, sizeKB: toKB(f.size) });
      continue;
    }

    if (HTML_EXTS.has(ext)) {
      htmlSize += f.size;
      const route = htmlPathToRoute(f.path);
      if (route) {
        routeByteMap[route] = (routeByteMap[route] ?? 0) + f.size;
      }
      continue;
    }

    if (IMG_EXTS.has(ext)) {
      imgSize += f.size;
    }
  }

  const top10LargestFiles = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map((f) => ({ path: f.path, sizeKB: toKB(f.size) }));

  const top10LargestRoutes = Object.entries(routeByteMap)
    .map(([route, size]) => ({ route, sizeKB: toKB(size) }))
    .sort((a, b) => b.sizeKB - a.sizeKB)
    .slice(0, 10);

  const routes = Object.fromEntries(
    Object.entries(routeByteMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([route, size]) => [route, toKB(size)])
  );

  const result = {
    timestamp: new Date().toISOString(),
    totalKB: toKB(totalSize),
    jsKB: toKB(jsSize),
    cssKB: toKB(cssSize),
    htmlKB: toKB(htmlSize),
    imgKB: toKB(imgSize),
    otherKB: toKB(totalSize - jsSize - cssSize - htmlSize - imgSize),
    fileCount: files.length,
    routeCount: Object.keys(routes).length,
    routes,
    top10LargestRoutes,
    jsCssFiles: jsCssFiles.sort((a, b) => b.sizeKB - a.sizeKB),
    top10LargestFiles,
  };

  console.log(JSON.stringify(result, null, 2));
}

analyze();
