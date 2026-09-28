#!/usr/bin/env node
/**
 * Takedown ratchet（openspec: post-takedown，design D8）
 *
 * 下架是法律面的決定，VM 上沒更新的自動化暫停不了，所以用基準版本對新版本的
 * 棘輪擋住「把墓碑寫回全文」與「從已封鎖的來源再寫一篇」：
 *
 *   1. 基準版本已是 taken-down 的文章：新版本必須還在、仍是 taken-down、正文為空。
 *   2. 新增的文章，以及改了 sourceUrl 的既有文章，來源與任一下架文章相同 → 來源已
 *      封鎖。比對用 dedup-gate 的 layer1Match（正規化網址、推文 ID、YouTube 影片 ID），
 *      找出所有相同來源的下架文章。唯一的例外三個條件都要成立：這篇是 GP、相同來源的
 *      下架文章全部是 GP、這篇帶有效的來源距離章（驗章用 scripts/lib/source-distance.mjs，
 *      跟 validate-posts 同一份）。有一篇下架的不是 GP 就照樣封鎖。
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
import { isGpTicket, loadPostIndex, verifyStamp } from './lib/source-distance.mjs';
import { TAKEN_DOWN_STATUS, isTakenDownData, splitPostSource } from './lib/taken-down-posts.mjs';

const POSTS_DIR = 'src/content/posts';
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
 * @param {Map<string, object>} [input.postIndex]  驗章用的站內文章索引（預設讀工作目錄的 posts/）
 */
export function evaluateTakedownRatchet({
  baseTakenDown,
  headContents,
  addedPosts,
  changedSourcePosts = [],
  headTakenDown,
  addedSourcePaths,
  postIndex = null,
}) {
  const errors = [];

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

  let index = postIndex;
  const hasValidStamp = (content, data, file) => {
    index ??= loadPostIndex();
    const { required, errors: stampErrors } = verifyStamp({
      content,
      data,
      file,
      postIndex: index,
    });
    return required && stampErrors.length === 0;
  };

  for (const { path: file, content } of [...addedPosts, ...changedSourcePosts]) {
    const parsed = parsePost(content, file);
    if (!parsed) continue; // validate-posts reports unreadable frontmatter
    const { data } = parsed;
    if (isTakenDownData(data)) continue;
    const matches = typeof data.sourceUrl === 'string' ? layer1Match(data.sourceUrl, blocked) : [];
    if (matches.length === 0) continue;

    // 唯一的例外：GP 導讀、相同來源的下架文章全部是 GP、而且這篇帶有效的章。
    const gp = isGpTicket(ticketOf(data));
    const nonGp = matches.filter(({ article }) => !isGpTicket(article.ticketId));
    if (gp && nonGp.length === 0 && hasValidStamp(content, data, file)) continue;

    const shown = gp && nonGp.length > 0 ? nonGp : matches;
    const takenDownAs = shown
      .map(({ article, reason }) => `${article.ticketId || article.file} (${reason})`)
      .join(', ');
    let why = '';
    if (gp && nonGp.length === 0) {
      why =
        '; a GP reading guide may reuse a taken-down GP source only with a valid sourceDistance stamp';
    } else if (gp) {
      why = '; a non-GP post was taken down from it, and no stamp lifts that';
    }
    errors.push(
      `${file}: source is blocked — ${data.sourceUrl} was taken down as ${takenDownAs}${why} (openspec: post-takedown)`
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

function sourceUrlOf(content) {
  const parsed = content ? parsePost(content, 'post') : null;
  return typeof parsed?.data?.sourceUrl === 'string' ? parsed.data.sourceUrl : null;
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
    addedPosts: addedPostPaths.map((file) => ({
      path: file,
      content: headBlobs.get(headSpec(file)) ?? '',
    })),
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
