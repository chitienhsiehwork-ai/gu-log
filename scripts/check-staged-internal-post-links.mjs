#!/usr/bin/env node
/**
 * pre-commit 的「只改連結」豁免：拿 HEAD 與 staged 版本跑共用的證明
 * （scripts/lib/link-only-proof.mjs）。glossary 資料與站內文章的目標都讀 staged
 * index，跟這次要 commit 的文章同一個版本，所以同一個 commit 新增的詞條也算啟用中。
 *
 * exit 0 = 證明成立（內容品質 gate 可略過）；其他狀況一律 exit 1。
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadStagedGlossary } from './check-glossary-links.mjs';
import { createPostLinkValidator, isLinkOnlyChange } from './lib/link-only-proof.mjs';

const POSTS_DIR = 'src/content/posts';
const SOURCE_FILE = new RegExp(`^${POSTS_DIR}/[^/]+\\.mdx$`, 'u');

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function stagedPostRecords() {
  const output = git(['ls-files', '--stage', '-z', '--', POSTS_DIR]);
  return output
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf('\t');
      if (separator === -1) {
        throw new Error('malformed staged post record');
      }
      const [mode, objectId, stage] = record.slice(0, separator).split(' ');
      return { mode, objectId, stage, file: record.slice(separator + 1) };
    });
}

export function isStagedLinkOnlyChange(file) {
  if (typeof file !== 'string' || !SOURCE_FILE.test(file)) {
    throw new Error('expected one staged post path under src/content/posts');
  }

  const before = git(['show', `HEAD:${file}`]);
  const after = git(['show', `:${file}`]);
  if (before === after) return false;

  return isLinkOnlyChange(before, after, {
    filePath: file,
    glossary: loadStagedGlossary(process.cwd()),
    validatePostLink: createPostLinkValidator({
      listPosts: stagedPostRecords,
      readPost: (target) => git(['show', `:${target}`]),
    }),
  });
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = isStagedLinkOnlyChange(process.argv[2]) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
