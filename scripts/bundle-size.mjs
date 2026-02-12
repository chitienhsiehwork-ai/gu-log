#!/usr/bin/env node
/**
 * Bundle Size Analyzer for gu-log
 * Scans dist/ directory and reports sizes by category.
 * Outputs JSON to stdout.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const DIST_DIR = new URL('../dist/', import.meta.url).pathname;

const JS_EXTS = new Set(['.js', '.mjs']);
const CSS_EXTS = new Set(['.css']);
const HTML_EXTS = new Set(['.html', '.htm']);
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);

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
      results.push({ path: relative(DIST_DIR, fullPath), size });
    }
  }
  return results;
}

function analyze() {
  const files = walkDir(DIST_DIR);

  let totalSize = 0;
  let jsSize = 0;
  let cssSize = 0;
  let htmlSize = 0;
  let imgSize = 0;

  for (const f of files) {
    totalSize += f.size;
    const ext = extname(f.path).toLowerCase();
    if (JS_EXTS.has(ext)) jsSize += f.size;
    else if (CSS_EXTS.has(ext)) cssSize += f.size;
    else if (HTML_EXTS.has(ext)) htmlSize += f.size;
    else if (IMG_EXTS.has(ext)) imgSize += f.size;
  }

  // Top 10 largest files
  const top10 = files
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(f => ({ path: f.path, sizeKB: +(f.size / 1024).toFixed(2) }));

  const toKB = (bytes) => +(bytes / 1024).toFixed(2);

  const result = {
    timestamp: new Date().toISOString(),
    totalKB: toKB(totalSize),
    jsKB: toKB(jsSize),
    cssKB: toKB(cssSize),
    htmlKB: toKB(htmlSize),
    imgKB: toKB(imgSize),
    otherKB: toKB(totalSize - jsSize - cssSize - htmlSize - imgSize),
    fileCount: files.length,
    top10LargestFiles: top10,
  };

  console.log(JSON.stringify(result, null, 2));
}

analyze();
