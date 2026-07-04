#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function fail(message) {
  throw new Error(message);
}

function parseCounterJson(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(`${label}: invalid JSON: ${error.message}`);
  }

  validateCounterSchema(value, label);
  return value;
}

function validateCounterSchema(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label}: expected top-level object`);
  }

  for (const [prefix, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) {
      fail(`${label}: ${prefix} must be an object`);
    }
    if (!Number.isInteger(entry.next) || entry.next < 0) {
      fail(`${label}: ${prefix}.next must be a non-negative integer`);
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeScalarField({ baseValue, oursValue, theirsValue, path }) {
  const oursChanged = !sameValue(oursValue, baseValue);
  const theirsChanged = !sameValue(theirsValue, baseValue);

  if (!oursChanged && !theirsChanged) return oursValue;
  if (oursChanged && !theirsChanged) return oursValue;
  if (!oursChanged && theirsChanged) return theirsValue;
  if (sameValue(oursValue, theirsValue)) return oursValue;

  fail(`${path}: both sides changed differently`);
}

export function mergeArticleCounter(base, ours, theirs) {
  validateCounterSchema(base, 'base');
  validateCounterSchema(ours, 'ours');
  validateCounterSchema(theirs, 'theirs');

  const merged = {};
  const prefixes = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);

  for (const prefix of [...prefixes].sort()) {
    const baseEntry = base[prefix];
    const oursEntry = ours[prefix];
    const theirsEntry = theirs[prefix];

    if (baseEntry && (!oursEntry || !theirsEntry)) {
      fail(`${prefix}: prefix deletion requires manual resolution`);
    }
    if (!oursEntry || !theirsEntry) {
      merged[prefix] = cloneJson(oursEntry ?? theirsEntry);
      continue;
    }

    const entry = {};
    const fields = new Set([
      ...Object.keys(baseEntry ?? {}),
      ...Object.keys(oursEntry),
      ...Object.keys(theirsEntry),
    ]);

    for (const field of [...fields].sort()) {
      if (field === 'next') {
        entry.next = Math.max(oursEntry.next, theirsEntry.next);
        continue;
      }

      entry[field] = mergeScalarField({
        baseValue: baseEntry?.[field],
        oursValue: oursEntry[field],
        theirsValue: theirsEntry[field],
        path: `${prefix}.${field}`,
      });
    }

    merged[prefix] = entry;
  }

  return merged;
}

export function mergeArticleCounterText(baseText, oursText, theirsText) {
  return `${JSON.stringify(
    mergeArticleCounter(
      parseCounterJson(baseText, 'base'),
      parseCounterJson(oursText, 'ours'),
      parseCounterJson(theirsText, 'theirs')
    ),
    null,
    2
  )}\n`;
}

export function mergeArticleCounterFiles(basePath, oursPath, theirsPath) {
  const merged = mergeArticleCounterText(
    fs.readFileSync(basePath, 'utf8'),
    fs.readFileSync(oursPath, 'utf8'),
    fs.readFileSync(theirsPath, 'utf8')
  );
  fs.writeFileSync(oursPath, merged);
}

function main(argv) {
  const [, , basePath, oursPath, theirsPath, worktreePath = 'scripts/article-counter.json'] = argv;
  if (!basePath || !oursPath || !theirsPath) {
    console.error('merge-article-counter.mjs: expected %O %A %B [%P]');
    return 2;
  }

  try {
    mergeArticleCounterFiles(basePath, oursPath, theirsPath);
    console.error(`merge-article-counter.mjs: merged ${worktreePath}`);
    return 0;
  } catch (error) {
    console.error(
      `merge-article-counter.mjs: ${error.message} — leaving conflict for manual resolution`
    );
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
