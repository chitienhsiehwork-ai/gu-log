#!/usr/bin/env node
// 文章不放 emoji（openspec: editorial-charter）。用法：
//   node scripts/check-content-emoji.mjs --staged         # pre-commit：暫存區新增的行
//   node scripts/check-content-emoji.mjs --base=<commit>  # CI：<commit>..HEAD 新增的行
//   node scripts/check-content-emoji.mjs <file>...        # gp-pipeline 草稿：整份檔案
// Exit：0 通過、1 有未核准 emoji、2 檢查跑不完（例如 base 解析不到）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { findEmojiSequences } from './lib/emoji-sequences.mjs';

// ShroomDog 明確核准保留的 emoji，一筆一個 { path, emoji, reason }。
// 只有 ShroomDog 能核准；writer 不得自己加。
export const APPROVED = [];

const POST_PATHSPECS = ['src/content/posts/*.md', 'src/content/posts/*.mdx'];

// 解析 `git diff -U0` 的輸出，回傳每一個新增行 { path, line, text }。
export function parseAddedLines(diff) {
  const added = [];
  let path = null;
  let line = 0;
  let inHeader = false;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) inHeader = true;
    else if (inHeader && raw.startsWith('+++ ')) path = raw.slice(4).replace(/^b\//, '');
    else if (raw.startsWith('@@ ')) {
      inHeader = false;
      line = Number(raw.match(/\+(\d+)/)[1]);
    } else if (!inHeader && raw.startsWith('+'))
      added.push({ path, line: line++, text: raw.slice(1) });
  }
  return added;
}

export function findUnapprovedEmoji(added, approved = APPROVED) {
  return added.flatMap(({ path, line, text }) =>
    findEmojiSequences(text)
      .filter(({ emoji }) => !approved.some((a) => a.path === path && a.emoji === emoji))
      .map(({ emoji }) => ({ path, line, emoji }))
  );
}

function gitDiff(range) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'diff',
      ...range,
      '-U0',
      '-M',
      '--no-color',
      '--diff-filter=ACMR',
      '--',
      ...POST_PATHSPECS,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
}

function main(args) {
  let found;
  if (args.length === 1 && args[0] === '--staged') {
    found = findUnapprovedEmoji(parseAddedLines(gitDiff(['--cached'])));
  } else if (args.length === 1 && args[0].startsWith('--base=') && args[0].length > 7) {
    found = findUnapprovedEmoji(parseAddedLines(gitDiff([args[0].slice(7), 'HEAD'])));
  } else if (args.length > 0 && args.every((arg) => !arg.startsWith('-'))) {
    const added = args.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((text, index) => ({ path, line: index + 1, text }))
    );
    found = findUnapprovedEmoji(added);
  } else {
    throw new Error('用法：--staged、--base=<commit> 或要檢查的檔案');
  }
  for (const { path, line, emoji } of found)
    console.error(`❌ ${path}:${line} 未核准 emoji ${emoji}`);
  if (found.length > 0) {
    console.error('文章預設不放 emoji（kaomoji 可以）；要保留得先經 ShroomDog 核准。');
    return 1;
  }
  console.log('✓ content emoji: 新增內容沒有 emoji');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ content emoji 檢查跑不完：${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  }
}
