#!/usr/bin/env node
/**
 * Takedown ratchet（openspec: post-takedown，design D8）
 *
 * 下架是法律面的決定，VM 上沒更新的自動化暫停不了，所以用基準版本對新版本的
 * 棘輪擋住「把墓碑寫回全文」與「從已封鎖的來源再寫一篇」：
 *
 *   1. 基準版本已是 taken-down 的文章：新版本必須還在、仍是 taken-down、正文為空。
 *   2. GP 暫停期間（src/lib/gp-series-pause.mjs），新增的 GP 文章（含 GP-PENDING）
 *      一律失敗；既有 ticketId 的改名或配對不算新增。
 *   3. 新增文章的 sourceUrl（正規化網址或推文 ID）與任一下架文章相同 → 來源已封鎖。
 *   4. sources/ 底下只准新增 sources/chatgpt/（ShroomDog 自己的對話）。
 *
 * 用法：
 *   node scripts/check-takedown-ratchet.mjs --staged       # pre-commit：HEAD → index
 *   node scripts/check-takedown-ratchet.mjs --base=<sha>   # CI：PR base → HEAD
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GP_SERIES_PAUSED } from '../src/lib/gp-series-pause.mjs';
import { extractTweetId, normalizeUrl } from './dedup-gate.mjs';
import { TAKEN_DOWN_STATUS, splitPostSource } from './lib/taken-down-posts.mjs';

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

function sourceKeys(sourceUrl) {
  if (typeof sourceUrl !== 'string' || sourceUrl.trim() === '') return [];
  const keys = [];
  const normalized = normalizeUrl(sourceUrl);
  if (normalized) keys.push(`url:${normalized}`);
  const tweetId = extractTweetId(sourceUrl);
  if (tweetId) keys.push(`tweet:${tweetId}`);
  return keys;
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
 * @param {Array<{ path: string, content: string }>} input.headTakenDown  新版本的下架文章
 * @param {string[]} input.addedSourcePaths  sources/ 底下新增的檔案
 * @param {Set<string>} input.baseTicketIds  基準版本已存在的 ticketId
 * @param {boolean} [input.gpPaused]
 */
export function evaluateTakedownRatchet({
  baseTakenDown,
  headContents,
  addedPosts,
  headTakenDown,
  addedSourcePaths,
  baseTicketIds,
  gpPaused = GP_SERIES_PAUSED,
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
    if (parsed.data.status !== TAKEN_DOWN_STATUS) {
      errors.push(
        `${file}: taken-down post cannot change status to ${JSON.stringify(parsed.data.status ?? 'published')}`
      );
    }
    if (parsed.body.trim().length > 0) {
      errors.push(`${file}: taken-down post body must stay empty (article text was written back)`);
    }
  }

  const blocked = new Map();
  for (const { path: file, content } of headTakenDown) {
    const parsed = parsePost(content, file);
    if (!parsed || parsed.data.status !== TAKEN_DOWN_STATUS) continue;
    for (const key of sourceKeys(parsed.data.sourceUrl)) {
      if (!blocked.has(key)) blocked.set(key, { file, ticketId: ticketOf(parsed.data) });
    }
  }

  for (const { path: file, content } of addedPosts) {
    const parsed = parsePost(content, file);
    if (!parsed) continue; // validate-posts reports unreadable frontmatter
    const { data } = parsed;
    if (data.status === TAKEN_DOWN_STATUS) continue;
    const ticketId = ticketOf(data);

    if (
      gpPaused &&
      /^GP-(?:\d+|PENDING)$/.test(ticketId) &&
      (ticketId.endsWith('-PENDING') || !baseTicketIds.has(ticketId))
    ) {
      errors.push(
        `${file}: new GP posts are paused — whole-article translations need the source author's consent first (openspec: editorial-charter)`
      );
    }

    for (const key of sourceKeys(data.sourceUrl)) {
      const match = blocked.get(key);
      if (match) {
        errors.push(
          `${file}: source is blocked — ${data.sourceUrl} was taken down as ${match.ticketId || match.file} (openspec: post-takedown)`
        );
        break;
      }
    }
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

function ticketIdsAt(cwd, tree) {
  return new Set(
    grepPosts(cwd, tree, ['-h', '-E', '^ticketId:'])
      .split('\n')
      .map((line) =>
        line
          .replace(/^ticketId:\s*/, '')
          .replace(/^["']|["']\s*$/g, '')
          .trim()
      )
      .filter(Boolean)
  );
}

function addedPaths(cwd, diffArgs, pathspec) {
  const output = git(cwd, [
    '-c',
    'diff.renameLimit=0',
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--diff-filter=A',
    ...diffArgs,
    '--',
    pathspec,
  ]);
  return output.split('\0').filter(Boolean);
}

export function collectRatchetInput({ mode, base, cwd = REPO_ROOT }) {
  const staged = mode === 'staged';
  const baseRev = staged ? 'HEAD' : base;
  const headSpec = (file) => (staged ? `:${file}` : `HEAD:${file}`);
  const diffArgs = staged ? ['--cached', 'HEAD'] : [`${baseRev}...HEAD`];

  const baseTakenDownPaths = takenDownPathsAt(cwd, { rev: baseRev });
  const headTakenDownPaths = takenDownPathsAt(cwd, staged ? { cached: true } : { rev: 'HEAD' });
  const addedPostPaths = addedPaths(cwd, diffArgs, `${POSTS_DIR}/*.mdx`);
  const addedSourcePaths = addedPaths(cwd, diffArgs, SOURCES_DIR);

  const baseBlobs = readBlobs(
    cwd,
    baseTakenDownPaths.map((file) => `${baseRev}:${file}`)
  );
  const headBlobs = readBlobs(
    cwd,
    [...new Set([...baseTakenDownPaths, ...headTakenDownPaths, ...addedPostPaths])].map(headSpec)
  );

  return {
    baseTakenDown: baseTakenDownPaths
      .map((file) => ({ path: file, content: baseBlobs.get(`${baseRev}:${file}`) }))
      .filter(({ content }) => {
        // `git grep` matches the status line anywhere; confirm it is frontmatter.
        const parsed = content ? parsePost(content, 'base') : null;
        return parsed?.data.status === TAKEN_DOWN_STATUS;
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
    addedSourcePaths,
    baseTicketIds: ticketIdsAt(cwd, { rev: baseRev }),
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
    `✓ Takedown ratchet: ${input.baseTakenDown.length} taken-down post(s) intact, ${input.addedPosts.length} new post(s) checked`
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
