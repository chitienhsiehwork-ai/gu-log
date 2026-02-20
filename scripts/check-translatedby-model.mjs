#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { formatModelName } from './detect-model.mjs';

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split('\n');
  let inTranslatedBy = false;

  for (const line of lines) {
    if (/^translatedBy:\s*$/.test(line)) {
      inTranslatedBy = true;
      fm.translatedBy = fm.translatedBy || {};
      continue;
    }

    if (inTranslatedBy) {
      const sub = line.match(/^\s{2}(model|harness):\s*["']?([^"']+)["']?\s*$/);
      if (sub) {
        fm.translatedBy[sub[1]] = sub[2].trim();
        continue;
      }

      if (!/^\s/.test(line)) {
        inTranslatedBy = false;
      }
    }
  }

  return fm;
}

const rawModel = process.env.OPENCLAW_MODEL || '';
if (!rawModel) {
  console.log('ℹ️  OPENCLAW_MODEL not set, skipping translatedBy.model consistency check');
  process.exit(0);
}

const modelId = rawModel.includes('/') ? rawModel.split('/').pop() : rawModel;
const expected = formatModelName(rawModel);

if (expected === modelId && /[-_/]/.test(modelId)) {
  console.log(`ℹ️  No friendly model mapping for "${rawModel}", skipping consistency check`);
  process.exit(0);
}

const files = process.argv.slice(2).filter(Boolean);
if (files.length === 0) {
  console.log('ℹ️  No files provided for translatedBy.model check');
  process.exit(0);
}

let errors = 0;
for (const file of files) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) continue;

  const content = fs.readFileSync(abs, 'utf-8');
  const fm = parseFrontmatter(content);
  const actual = fm?.translatedBy?.model;

  if (!actual) continue;

  if (actual.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    console.log(`❌ ${path.basename(file)} translatedBy.model mismatch`);
    console.log(`   expected: "${expected}" (from OPENCLAW_MODEL=${rawModel})`);
    console.log(`   actual:   "${actual}"`);
    errors++;
  }
}

if (errors > 0) {
  console.log(`\n❌ translatedBy.model consistency check failed: ${errors} file(s) mismatched`);
  process.exit(1);
}

console.log(`✓ translatedBy.model matches runtime model (${expected})`);
process.exit(0);
