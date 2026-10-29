#!/usr/bin/env node
/**
 * Takedown ratchet（openspec: post-takedown，design D8）
 *
 * 下架是法律面的決定，VM 上沒更新的自動化暫停不了，所以用基準版本對新版本的
 * 棘輪擋住「把墓碑寫回全文」與「從已封鎖的來源再寫一篇」：
 *
 *   1. 基準版本已是 taken-down 的文章：新版本必須還在、仍是 taken-down、正文為空。
 *   2. 新增的文章，以及改了 sourceUrl 的既有文章，來源與任一下架文章相同 → 來源已
 *      封鎖，不分系列、沒有例外。比對用 dedup-gate 的 layer1Match（正規化網址、推文 ID、
 *      YouTube 影片 ID），找出所有相同來源的下架文章。改系列不算新文章：遷移清單
 *      （quality/brand-taxonomy-post-migration.json）有記、舊檔在基準版本、新版本已
 *      不在、sourceUrl 沒變的改名算既有文章；之後替它補上缺少的語言版本（同 ticketId、
 *      同 sourceUrl）也不算新增。
 *   3. sources/ 底下只准新增 sources/chatgpt/（ShroomDog 自己的對話）。
 *
 * 用法：
 *   node scripts/check-takedown-ratchet.mjs --staged       # pre-commit：HEAD → index
 *   node scripts/check-takedown-ratchet.mjs --base=<sha>   # CI：PR base → HEAD
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { layer1Match, sourceIdentity } from './dedup-gate.mjs';
import { TAKEN_DOWN_STATUS, isTakenDownData, splitPostSource } from './lib/taken-down-posts.mjs';

const POSTS_DIR = 'src/content/posts';
const MIGRATION_MANIFEST = 'quality/brand-taxonomy-post-migration.json';
const SOURCES_DIR = 'sources';
const ALLOWED_SOURCES_PREFIX = 'sources/chatgpt/';
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parsePost(content, name) {
  try {
    return splitPostSource(content, name);
  } catch {
    return null;
  }
}

function ticketOf(data) {
  return typeof data?.ticketId === 'string' ? data.ticketId : '';
}

function sourceUrlOf(content) {
  const parsed = content ? parsePost(content, 'post') : null;
  return typeof parsed?.data?.sourceUrl === 'string' ? parsed.data.sourceUrl : null;
}

const RECLASSIFIED_FROM = /^(?:GP|MP)-\d+$/;
const postPath = (filename) => `${POSTS_DIR}/${filename}`;
const isEnglishPath = (file) => path.posix.basename(file).startsWith('en-');

/**
 * 遷移清單有記、舊檔在基準版本、新版本已不在、sourceUrl 沒變：這是改系列搬過來的
 * 既有文章，不是新文章。
 */
function isRecordedReclassification(file, sourceUrl, { manifestEntries, basePosts, headPosts }) {
  const name = path.posix.basename(file);
  return manifestEntries.some((entry) => {
    if (entry?.newFilename !== name || typeof entry.oldFilename !== 'string') return false;
    const oldPath = postPath(entry.oldFilename);
    if (oldPath === file || headPosts.get(oldPath)) return false;
    const before = basePosts.get(oldPath) ?? null;
    return before !== null && sourceUrlOf(before) === sourceUrl;
  });
}

/**
 * 替改系列的文章補上缺少的語言版本：同 ticketId、同 sourceUrl 的另一個語言檔是遷移
 * 清單記下的改系列文章，而且它本身是還在線上的既有文章（基準版本就有，或這次改系列
 * 搬過來）。另一個語言檔已下架時，補上的檔案就是把下架文章救回來，照樣擋。
 */
function isAddedLanguageOfReclassified(file, data, context) {
  const ticket = ticketOf(data);
  if (!ticket) return false;
  return context.manifestEntries.some((entry) => {
    if (entry?.newTicketId !== ticket || typeof entry.newFilename !== 'string') return false;
    const siblingPath = postPath(entry.newFilename);
    if (siblingPath === file || isEnglishPath(siblingPath) === isEnglishPath(file)) return false;
    const sibling = parsePost(context.headPosts.get(siblingPath) ?? '', siblingPath);
    if (!sibling || ticketOf(sibling.data) !== ticket) return false;
    if (isTakenDownData(sibling.data)) return false;
    if (sibling.data.sourceUrl !== data.sourceUrl) return false;
    if (context.basePosts.get(siblingPath)) return true;
    return isRecordedReclassification(siblingPath, data.sourceUrl, context);
  });
}

/**
 * 純函式核心，給單元測試直接餵資料。
 *
 * @param {object} input
 * @param {Array<{ path: string, content: string }>} input.baseTakenDown  基準版本的下架文章
 * @param {Map<string, string | null>} input.headContents  上述檔案在新版本的內容（null＝不存在）
 * @param {Array<{ path: string, content: string }>} input.addedPosts  新增的文章
 * @param {Array<{ path: string, content: string }>} [input.changedSourcePosts]  改了 sourceUrl 的既有文章（新版本內容）
 * @param {Array<{ path: string, content: string }>} input.headTakenDown  新版本的下架文章
 * @param {string[]} input.addedSourcePaths  sources/ 底下新增的檔案
 * @param {object[]} [input.manifestEntries]  新版本遷移清單的項目
 * @param {Map<string, string | null>} [input.basePosts]  遷移項目提到的文章在基準版本的內容
 * @param {Map<string, string | null>} [input.headPosts]  遷移項目提到的文章在新版本的內容
 */
export function evaluateTakedownRatchet({
  baseTakenDown,
  headContents,
  addedPosts,
  changedSourcePosts = [],
  headTakenDown,
  addedSourcePaths,
  manifestEntries = [],
  basePosts = new Map(),
  headPosts = new Map(),
}) {
  const errors = [];
  // 只有 GP、MP 之間的改系列（reclassify-post.mjs）算數；SP／CP 是品牌改名時的遷移項目。
  const reclassification = {
    manifestEntries: manifestEntries.filter((entry) => RECLASSIFIED_FROM.test(entry?.oldTicketId)),
    basePosts,
    headPosts,
  };

  for (const { path: file } of baseTakenDown) {
    const content = headContents.get(file) ?? null;
    if (content === null) {
      errors.push(`${file}: taken-down post was deleted or renamed; keep its URL as a tombstone`);
      continue;
    }
    const parsed = parsePost(content, file);
    if (!parsed) {
      errors.push(`${file}: taken-down post frontmatter is unreadable`);
      continue;
    }
    if (!isTakenDownData(parsed.data)) {
      errors.push(
        `${file}: taken-down post cannot change status to ${JSON.stringify(parsed.data.status ?? 'published')}`
      );
    }
    if (parsed.body.trim().length > 0) {
      errors.push(`${file}: taken-down post body must stay empty (article text was written back)`);
    }
  }

  const blocked = [];
  for (const { path: file, content } of headTakenDown) {
    const parsed = parsePost(content, file);
    if (!isTakenDownData(parsed?.data)) continue;
    blocked.push({
      file,
      ticketId: ticketOf(parsed.data),
      ...sourceIdentity(parsed.data.sourceUrl),
    });
  }

  const added = new Set(addedPosts.map(({ path: file }) => file));
  for (const { path: file, content } of [...addedPosts, ...changedSourcePosts]) {
    const parsed = parsePost(content, file);
    if (!parsed) continue; // validate-posts reports unreadable frontmatter
    const { data } = parsed;
    if (isTakenDownData(data)) continue;
    const matches = typeof data.sourceUrl === 'string' ? layer1Match(data.sourceUrl, blocked) : [];
    if (matches.length === 0) continue;

    // 改系列搬過來的既有文章與替它補的語言版本不算新文章。
    if (
      added.has(file) &&
      (isRecordedReclassification(file, data.sourceUrl, reclassification) ||
        isAddedLanguageOfReclassified(file, data, reclassification))
    ) {
      continue;
    }

    const takenDownAs = matches
      .map(({ article, reason }) => `${article.ticketId || article.file} (${reason})`)
      .join(', ');
    errors.push(
      `${file}: source is blocked — ${data.sourceUrl} was taken down as ${takenDownAs} (openspec: post-takedown)`
    );
  }

  for (const file of addedSourcePaths) {
    if (!file.startsWith(ALLOWED_SOURCES_PREFIX)) {
      errors.push(
        `${file}: third-party source captures stay outside the repo; only sources/chatgpt/ may grow`
      );
    }
  }

  return errors;
}

// ─── git adapter ───────────────────────────────────────────────────

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

/** Read many blobs through one `git cat-file --batch`; missing objects map to null. */
function readBlobs(cwd, specs) {
  const result = new Map();
  if (specs.length === 0) return result;
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: `${specs.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  let offset = 0;
  for (const spec of specs) {
    const newline = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, newline).toString('utf8');
    offset = newline + 1;
    if (header.endsWith(' missing')) {
      result.set(spec, null);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    result.set(spec, output.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }
  return result;
}

/**
 * `tree` is either `{ cached: true }` (the index) or `{ rev: '<commit>' }`.
 * git grep takes --cached as an option before the pattern and a revision after it.
 */
function grepPosts(cwd, tree, grepArgs) {
  const args = ['grep', ...(tree.cached ? ['--cached'] : []), ...grepArgs];
  if (!tree.cached) args.push(tree.rev);
  args.push('--', `${POSTS_DIR}/*.mdx`);
  try {
    return git(cwd, args);
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
}

function takenDownPathsAt(cwd, tree) {
  return grepPosts(cwd, tree, [
    '-l',
    '-E',
    `^status:[[:space:]]*["']?${TAKEN_DOWN_STATUS}["']?[[:space:]]*$`,
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^[^:]+:(?=src\/)/, ''));
}

function changedPaths(cwd, filter, diffArgs, pathspec) {
  const output = git(cwd, [
    '-c',
    'diff.renameLimit=0',
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    `--diff-filter=${filter}`,
    ...diffArgs,
    '--',
    pathspec,
  ]);
  return output.split('\0').filter(Boolean);
}

const addedPaths = (cwd, diffArgs, pathspec) => changedPaths(cwd, 'A', diffArgs, pathspec);

function parseManifestEntries(content) {
  try {
    const entries = JSON.parse(content ?? '')?.entries;
    return Array.isArray(entries) ? entries : [];
  } catch {
    return []; // 讀不到清單就沒有改系列例外（fail closed）
  }
}

/** 新增文章用得到的遷移項目：它自己的改名，以及同 ticket 其他語言檔的改名。 */
function relevantManifestPaths(entries, addedPosts) {
  const names = new Set(addedPosts.map(({ path: file }) => path.posix.basename(file)));
  const tickets = new Set(
    addedPosts.map(({ path: file, content }) => ticketOf(parsePost(content, file)?.data))
  );
  tickets.delete('');
  const paths = new Set();
  for (const entry of entries) {
    if (typeof entry?.oldFilename !== 'string' || typeof entry.newFilename !== 'string') continue;
    if (!names.has(entry.newFilename) && !tickets.has(entry.newTicketId)) continue;
    paths.add(postPath(entry.oldFilename));
    paths.add(postPath(entry.newFilename));
  }
  return [...paths];
}

/**
 * @param {{ mode: string, base?: string, cwd?: string }} options  mode 是 staged 或 range
 */
export function collectRatchetInput({ mode, base, cwd = REPO_ROOT }) {
  const staged = mode === 'staged';
  const baseRev = staged ? 'HEAD' : base;
  const headSpec = (file) => (staged ? `:${file}` : `HEAD:${file}`);
  const diffArgs = staged ? ['--cached', 'HEAD'] : [`${baseRev}...HEAD`];

  const baseTakenDownPaths = takenDownPathsAt(cwd, { rev: baseRev });
  const headTakenDownPaths = takenDownPathsAt(cwd, staged ? { cached: true } : { rev: 'HEAD' });
  const addedPostPaths = addedPaths(cwd, diffArgs, `${POSTS_DIR}/*.mdx`);
  const modifiedPostPaths = changedPaths(cwd, 'M', diffArgs, `${POSTS_DIR}/*.mdx`);
  const addedSourcePaths = addedPaths(cwd, diffArgs, SOURCES_DIR);

  const baseBlobs = readBlobs(
    cwd,
    [...new Set([...baseTakenDownPaths, ...modifiedPostPaths])].map((file) => `${baseRev}:${file}`)
  );
  const headBlobs = readBlobs(
    cwd,
    [
      ...new Set([
        ...baseTakenDownPaths,
        ...headTakenDownPaths,
        ...addedPostPaths,
        ...modifiedPostPaths,
      ]),
    ].map(headSpec)
  );
  const addedPosts = addedPostPaths.map((file) => ({
    path: file,
    content: headBlobs.get(headSpec(file)) ?? '',
  }));

  const manifestEntries =
    addedPosts.length > 0
      ? parseManifestEntries(
          readBlobs(cwd, [headSpec(MIGRATION_MANIFEST)]).get(headSpec(MIGRATION_MANIFEST))
        )
      : [];
  const manifestPaths = relevantManifestPaths(manifestEntries, addedPosts);
  const manifestBaseBlobs = readBlobs(
    cwd,
    manifestPaths.map((file) => `${baseRev}:${file}`)
  );
  const manifestHeadBlobs = readBlobs(cwd, manifestPaths.map(headSpec));

  return {
    baseTakenDown: baseTakenDownPaths
      .map((file) => ({ path: file, content: baseBlobs.get(`${baseRev}:${file}`) }))
      .filter(({ content }) => {
        // `git grep` matches the status line anywhere; confirm it is frontmatter.
        const parsed = content ? parsePost(content, 'base') : null;
        return isTakenDownData(parsed?.data);
      }),
    headContents: new Map(
      baseTakenDownPaths.map((file) => [file, headBlobs.get(headSpec(file)) ?? null])
    ),
    headTakenDown: headTakenDownPaths.map((file) => ({
      path: file,
      content: headBlobs.get(headSpec(file)) ?? '',
    })),
    addedPosts,
    // 既有文章改了 sourceUrl，跟新增文章一樣要過來源封鎖。
    changedSourcePosts: modifiedPostPaths
      .map((file) => ({
        path: file,
        base: baseBlobs.get(`${baseRev}:${file}`) ?? null,
        content: headBlobs.get(headSpec(file)) ?? '',
      }))
      .filter(({ base, content }) => sourceUrlOf(base) !== sourceUrlOf(content))
      .map(({ path: file, content }) => ({ path: file, content })),
    addedSourcePaths,
    manifestEntries,
    basePosts: new Map(
      manifestPaths.map((file) => [file, manifestBaseBlobs.get(`${baseRev}:${file}`) ?? null])
    ),
    headPosts: new Map(
      manifestPaths.map((file) => [file, manifestHeadBlobs.get(headSpec(file)) ?? null])
    ),
  };
}

function parseArgs(argv) {
  const staged = argv.includes('--staged');
  const base = argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length);
  if (staged === Boolean(base)) {
    throw new Error('usage: check-takedown-ratchet.mjs --staged | --base=<commit>');
  }
  return staged ? { mode: 'staged' } : { mode: 'range', base };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = collectRatchetInput(options);
  const errors = evaluateTakedownRatchet(input);
  if (errors.length > 0) {
    console.error(`❌ Takedown ratchet: ${errors.length} problem(s)`);
    for (const error of errors) console.error(`   ${error}`);
    console.error('   See openspec post-takedown (CI 棘輪) — a takedown is a legal decision.');
    process.exit(1);
  }
  console.log(
    `✓ Takedown ratchet: ${input.baseTakenDown.length} taken-down post(s) intact, ${input.addedPosts.length + input.changedSourcePosts.length} new or re-sourced post(s) checked`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(`❌ Takedown ratchet failed to run: ${error.message}`);
    process.exit(2);
  }
}
