#!/usr/bin/env node
// Level D evaluator — fixture loader + schema validator.
// Level E 會擴充：接上 Librarian dupCheck、算 per-category precision + recall。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYAML } from 'yaml';

const FIXTURES_DIR = 'tribunal/fixtures';
const VALID_CLASSES = ['hard-dup', 'soft-dup', 'intentional-series', 'clean-diff'];
const VALID_ACTIONS = ['BLOCK', 'WARN', 'allow'];

function listYamlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...listYamlFiles(p));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      out.push(p);
    }
  }
  return out;
}

function validateFixture(path, data) {
  const errors = [];
  const required = [
    'inputPost',
    'corpusSnapshot',
    'expectedClass',
    'expectedAction',
    'humanReasoning',
    'sourceRef',
  ];
  for (const key of required) {
    if (!(key in data)) errors.push(`missing required field: ${key}`);
  }
  if (data.expectedClass && !VALID_CLASSES.includes(data.expectedClass)) {
    errors.push(
      `expectedClass "${data.expectedClass}" not in ${JSON.stringify(VALID_CLASSES)}`,
    );
  }
  if (data.expectedAction && !VALID_ACTIONS.includes(data.expectedAction)) {
    errors.push(
      `expectedAction "${data.expectedAction}" not in ${JSON.stringify(VALID_ACTIONS)}`,
    );
  }
  if (data.inputPost) {
    if (typeof data.inputPost.slug !== 'string') errors.push('inputPost.slug must be string');
    if (typeof data.inputPost.contentSnapshot !== 'string')
      errors.push('inputPost.contentSnapshot must be string');
    if (!data.inputPost.frontmatter || typeof data.inputPost.frontmatter !== 'object')
      errors.push('inputPost.frontmatter must be object');
  }
  if (data.corpusSnapshot) {
    if (!Array.isArray(data.corpusSnapshot)) {
      errors.push('corpusSnapshot must be array');
    } else {
      data.corpusSnapshot.forEach((item, i) => {
        if (typeof item.slug !== 'string')
          errors.push(`corpusSnapshot[${i}].slug must be string`);
        if (typeof item.contentSnapshot !== 'string')
          errors.push(`corpusSnapshot[${i}].contentSnapshot must be string`);
        if (!item.frontmatter || typeof item.frontmatter !== 'object')
          errors.push(`corpusSnapshot[${i}].frontmatter must be object`);
      });
    }
  }
  // expectedClass 與路徑子目錄一致（tribunal/fixtures/{class}/*.yaml）
  const rel = relative(FIXTURES_DIR, path);
  const dirClass = rel.split('/')[0];
  if (VALID_CLASSES.includes(dirClass) && data.expectedClass && dirClass !== data.expectedClass) {
    errors.push(
      `directory mismatch: placed in ${dirClass}/ but expectedClass is ${data.expectedClass}`,
    );
  }
  return errors;
}

function main() {
  const files = listYamlFiles(FIXTURES_DIR);
  const counts = Object.fromEntries(VALID_CLASSES.map((c) => [c, 0]));
  let totalErrors = 0;

  console.log(`\n=== Level D Eval Harness — fixture loader ===\n`);
  console.log(`Scanning ${FIXTURES_DIR}/ ...`);

  for (const file of files) {
    let data;
    try {
      data = parseYAML(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`  ✗ ${file}: YAML parse error — ${err.message}`);
      totalErrors++;
      continue;
    }
    const errors = validateFixture(file, data);
    if (errors.length > 0) {
      console.error(`  ✗ ${file}:`);
      for (const e of errors) console.error(`      - ${e}`);
      totalErrors += errors.length;
    } else {
      counts[data.expectedClass] += 1;
      console.log(`  ✓ ${file}  (${data.expectedClass} → ${data.expectedAction})`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total fixtures: ${files.length}`);
  for (const c of VALID_CLASSES) {
    const n = counts[c];
    const marker = n === 0 ? '⚠️ ' : '   ';
    console.log(`${marker}${c.padEnd(22)} ${n}`);
  }

  const missing = VALID_CLASSES.filter((c) => counts[c] === 0);
  if (missing.length > 0) {
    console.log(
      `\n⚠️  Coverage gap — 無 fixture 的分類：${missing.join(', ')}`,
    );
    console.log(`   Level E 之前必補齊（見 spec R3 / R6）。`);
  }

  if (totalErrors > 0) {
    console.error(`\n✗ ${totalErrors} schema error(s) — 修好再跑`);
    process.exit(1);
  }
  console.log(`\n✓ 全部 fixture schema 通過`);
}

main();
