#!/usr/bin/env node
// 擋太大的檔案：agent 寫的檔案超過 5,000 token（token ≈ bytes / 4）就不准 commit，
// 逼大檔拆小，讓 agent 一次讀得完整份檔案。用法：
//   node scripts/check-file-size.mjs --staged         # pre-commit：暫存區的檔案
//   node scripts/check-file-size.mjs --base=<commit>  # CI：<commit>..HEAD 改到的檔案
// Exit：0 通過、1 有檔案超標、2 檢查跑不完（例如 base 解析不到）。
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MAX_TOKENS = 5000;
export const BYTES_PER_TOKEN = 4;
export const MAX_BYTES = MAX_TOKENS * BYTES_PER_TOKEN;

// 不是 agent 手寫的檔案不檢查：文章 prose、lockfile、產生出來的檔、外部素材、歸檔紀錄。
export const EXEMPT_PATTERNS = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)go\.sum$/,
  /^src\/content\//, // 文章與 glossary：作者 prose，長度由編輯規則管
  /^public\//, // 靜態資產與 artifact 頁
  /^(src|\.github)\/assets\//,
  /^sources\//, // 外部來源原文
  /^scores\//, // tribunal 產出的分數紀錄
  /^quality\//, // 品質報告產出
  /^\.score-loop\//,
  /^docs\/shroomdog-editorial-feedback\.md$/, // 作者回饋 corpus，只會累積
  /^openspec\/changes\/archive\//, // 已歸檔、不再修改
  /^src\/data\/.*\.json$/, // build script 產生的 manifest 與資料
  /\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|woff2?|ttf|otf|mp4|webm|mp3|zip|gz)$/i,
];

export const isExempt = (path) => EXEMPT_PATTERNS.some((re) => re.test(path));

export const tokens = (bytes) => Math.ceil(bytes / BYTES_PER_TOKEN);

// 舊大檔（改之前就超標）只要沒變更大就放行；新檔或從標準內長到超標的才擋。
// 這樣碰舊大檔修 bug 不會被卡，但也不能繼續往裡面塞東西。
export function findOversized(files) {
  return files.filter(({ path, newBytes, oldBytes }) => {
    if (isExempt(path) || newBytes <= MAX_BYTES) return false;
    return oldBytes === null || oldBytes <= MAX_BYTES || newBytes > oldBytes;
  });
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function blobSize(spec) {
  try {
    return Number(git(['cat-file', '-s', spec]).trim());
  } catch {
    return null;
  }
}

// `git diff --name-status -z` 的輸出：狀態、(舊路徑)、新路徑，用 NUL 分隔。
export function parseNameStatus(output) {
  const parts = output.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    const oldPath = /^[RC]/.test(status) ? parts[i++] : null;
    const path = parts[i++];
    changes.push({ status, path, oldPath: oldPath ?? path });
  }
  return changes;
}

function collect(diffRange, oldRef, newRef) {
  const output = git(['diff', ...diffRange, '--name-status', '-z', '-M', '--diff-filter=ACMR']);
  return parseNameStatus(output).map(({ status, path, oldPath }) => ({
    path,
    newBytes: blobSize(`${newRef}:${path}`) ?? 0,
    oldBytes: status.startsWith('A') ? null : blobSize(`${oldRef}:${oldPath}`),
  }));
}

export function formatError(found) {
  const lines = found.map(({ path, newBytes, oldBytes }) => {
    const before = oldBytes === null ? '新檔' : `原本 ~${tokens(oldBytes)}`;
    return `  ${path}: ~${tokens(newBytes)} tokens（${newBytes} bytes；${before}）`;
  });
  return [
    `❌ 檔案超過 ${MAX_TOKENS} tokens（token ≈ bytes / ${BYTES_PER_TOKEN}，上限 ${MAX_BYTES} bytes）：`,
    ...lines,
    '',
    '大檔讓 agent 讀不完整、改一行要吞整份 context。請先拆檔再 commit：',
    '  1. 照「職責」切，不照行數切：找出檔案裡各自獨立的區塊（一組相關函式、一個子元件、',
    '     一個 CLI subcommand、一組 test case），每塊搬進自己的檔案，檔名說清楚它負責什麼。',
    '  2. 原檔留成薄薄一層：只負責 import 拆出去的模組、組裝、export；外部呼叫端的',
    '     import 路徑盡量不變（需要就從原檔 re-export）。',
    '  3. 共用的 helper／常數／型別放進同目錄的 lib/ 或 *-utils 檔，別複製貼上。',
    '  4. Test 檔照被測行為拆成多個 *.test.ts，共用 fixture 抽到 tests/helpers/。',
    '  5. Shell script（例如 scripts/hooks/*）把各段邏輯抽成 scripts/*.mjs 或 *.sh，',
    '     原 script 只留呼叫順序。',
    '  6. 拆完跑 lint、相關測試，確認每個新檔都在上限內，再重新 git add。',
    '  不要為了湊大小刪註解、把邏輯擠成一行，或把新功能塞到旁邊的小檔卻不拆原檔。',
    '',
    '已經超標的舊檔：這次 commit 只要沒讓它變更大就放行；要加東西就先拆。',
    '不是 agent 手寫的檔案（lockfile、產生的檔案、資料檔）若被誤擋，',
    '把路徑規則加進 scripts/check-file-size.mjs 的 EXEMPT_PATTERNS。',
  ].join('\n');
}

function main(args) {
  let files;
  if (args.length === 1 && args[0] === '--staged') {
    files = collect(['--cached'], 'HEAD', '');
  } else if (args.length === 1 && args[0].startsWith('--base=') && args[0].length > 7) {
    const base = args[0].slice(7);
    files = collect([base, 'HEAD'], base, 'HEAD');
  } else {
    throw new Error('用法：--staged 或 --base=<commit>');
  }
  const found = findOversized(files);
  if (found.length > 0) {
    console.error(formatError(found));
    return 1;
  }
  console.log(`✓ file size: 改到的檔案都在 ${MAX_TOKENS} tokens 以內（或沒變大）`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ file size 檢查跑不完：${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  }
}
