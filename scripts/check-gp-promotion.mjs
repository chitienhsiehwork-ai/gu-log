#!/usr/bin/env node
/**
 * check-gp-promotion.mjs — 新變成 GP 的檔案要通過 publish bar（openspec gp-signature-picks
 * 〈新變成 GP 的檔案 SHALL 在 pre-commit 與 CI 通過 publish bar〉）。
 *
 *   node scripts/check-gp-promotion.mjs --staged         # pre-commit：HEAD → staged
 *   node scripts/check-gp-promotion.mjs --base=<commit>  # CI：<commit> 與 HEAD 的 merge base → HEAD
 *
 * 比較基準版本與新版本的每個新增或改過的文章檔：新版本是 GP（檔名 `gp-`／`en-gp-`，或 ticketId
 * 是 GP），而基準版本沒有這個檔、或它不是 GP 的文章檔（新增、改名或改了 ticketId），分數就要通過
 * src/utils/tribunal-scores.ts 的 meetsPublishBar。`gp-pending-` 檔與 `GP-PENDING` 一律失敗。
 * 基準版本已經是 GP 的檔案不檢查，所以升格後重評寫回較低的分數、下架都不會被擋。
 * 取不到基準版本就失敗，不當成通過。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_GLOB = 'src/content/posts/*.mdx';
const GP_FILE = /^(en-)?gp-/;
const PENDING_FILE = /^(en-)?gp-pending-/;
const PUBLISHED_GP = /^GP-[1-9]\d*$/;

function frontmatter(content) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content ?? '')?.[1];
  if (block === undefined) return null;
  try {
    const data = YAML.parse(block);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

const ticketOf = (data) => (typeof data?.ticketId === 'string' ? data.ticketId : '');
const isGp = (file, data) =>
  GP_FILE.test(path.posix.basename(file)) || ticketOf(data).startsWith('GP-');

/**
 * 純函式核心。
 * @param {Array<{ path: string, base: string | null, head: string }>} changes 新增或改過的文章檔
 * @param {(scores: unknown) => boolean} meetsPublishBar
 * @returns {string[]} 錯誤
 */
export function evaluateGpPromotion(changes, meetsPublishBar) {
  const errors = [];
  for (const { path: file, base, head } of changes) {
    const data = frontmatter(head);
    if (!isGp(file, data)) continue;
    if (PENDING_FILE.test(path.posix.basename(file)) || ticketOf(data) === 'GP-PENDING') {
      errors.push(
        `${file}：GP 沒有上線前的草稿；先寫成 MP，上線後用 scripts/reclassify-post.mjs 升格`
      );
    } else if (base !== null && PUBLISHED_GP.test(ticketOf(frontmatter(base)))) {
      continue; // 基準版本已經是 GP：只改分數、下架都不檢查
    } else if (!data) {
      errors.push(`${file}：讀不到 frontmatter，沒辦法確認它通過 publish bar`);
    } else if (!meetsPublishBar(data.scores)) {
      errors.push(`${file}：新變成 GP，但分數沒通過 publish bar（meetsPublishBar）`);
    }
  }
  return errors;
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function blob(spec, cwd) {
  try {
    return git(['show', spec], cwd);
  } catch {
    return null;
  }
}

/** @param {{ mode: 'staged' } | { mode: 'range', base: string }} options */
export function collectChanges(options, cwd = process.cwd()) {
  const staged = options.mode === 'staged';
  let baseRev;
  try {
    baseRev = staged
      ? git(['rev-parse', '--verify', 'HEAD^{commit}'], cwd).trim()
      : git(['merge-base', `${options.base}^{commit}`, 'HEAD'], cwd).trim();
  } catch {
    throw new Error(`取不到基準版本（${staged ? 'HEAD' : options.base}）`);
  }
  const diffArgs = staged ? ['--cached', baseRev] : [baseRev, 'HEAD'];
  const files = git(
    [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      '--diff-filter=AM',
      ...diffArgs,
      '--',
      POSTS_GLOB,
    ],
    cwd
  )
    .split('\0')
    .filter(Boolean);
  return files.map((file) => ({
    path: file,
    base: blob(`${baseRev}:${file}`, cwd),
    head: blob(staged ? `:${file}` : `HEAD:${file}`, cwd) ?? '',
  }));
}

function parseArgs(argv) {
  const staged = argv.includes('--staged');
  const base = argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length);
  if (staged === Boolean(base) || argv.length !== 1) {
    throw new Error('用法：check-gp-promotion.mjs --staged | --base=<commit>');
  }
  return staged ? { mode: 'staged' } : { mode: 'range', base };
}

async function main() {
  const changes = collectChanges(parseArgs(process.argv.slice(2)));
  let meetsPublishBar = () => false;
  if (changes.some(({ path: file, head }) => isGp(file, frontmatter(head)))) {
    const { tsImport } = await import('tsx/esm/api');
    const url = pathToFileURL(path.join(CODE_ROOT, 'src/utils/tribunal-scores.ts')).href;
    ({ meetsPublishBar } = await tsImport(url, import.meta.url));
  }
  const errors = evaluateGpPromotion(changes, meetsPublishBar);
  if (errors.length > 0) {
    console.error(`❌ GP promotion: ${errors.length} 個檔案不能變成 GP`);
    for (const error of errors) console.error(`   ${error}`);
    console.error('   GP 只由通過 publish bar 的已上線 MP 升格（openspec gp-signature-picks）。');
    return 1;
  }
  console.log(
    `✓ GP promotion: ${changes.length} 個新增或改過的文章檔，沒有未過 publish bar 的新 GP`
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`❌ GP promotion check failed to run: ${error.message}`);
    process.exitCode = 2;
  }
}
