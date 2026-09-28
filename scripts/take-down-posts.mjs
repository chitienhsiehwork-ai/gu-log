#!/usr/bin/env node
/**
 * take-down-posts.mjs — 依規則把文章下架成墓碑（openspec: post-takedown，design D10）
 *
 * 下架清單不另存快照：每次都依規則檔（takedown-list.json）的授權與規則，從當下語料算出。
 *
 *   --list <path> --plan                   依規則列出下架清單與統計（JSON），controller 用它對帳
 *   --list <path> --apply --date YYYY-MM-DD 改 frontmatter、清空正文；已下架的檔案不再變動（可重跑）
 *
 * `--list` 必填：規則檔跟著該批的 OpenSpec change 走，archive 後路徑會變。
 * 工具不連網：`sourceTitle` 依序取既有 `sourceTitle`、`source`、`sourceUrl` 的網域，
 * 已經寫進文章的 `sourceTitle`／`author` 一律不動。`--apply` 最後會列出只剩下架文章
 * 在用的 `src/assets/posts/**` 目錄，交給執行的人刪。`--posts-dir`／`--assets-dir` 給測試用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

import {
  TAKEN_DOWN_STATUS,
  getNeutralSummary,
  getTakedownSeries,
} from '../src/lib/tombstone-copy.mjs';
import {
  TAKEN_DOWN_INCOMPATIBLE_FIELDS as INCOMPATIBLE_FIELDS,
  isTakenDownData,
  postIdFromFilename,
  splitPostSource,
} from './lib/taken-down-posts.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const DEFAULT_ASSETS_DIR = path.join(REPO_ROOT, 'src/assets/posts');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ─── Rules ─────────────────────────────────────────────────────────

/** Load and validate the rules file; a batch without an owner authorization never runs. */
export function loadTakedownList(listPath) {
  const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  const auth = list.authorization ?? {};
  for (const field of ['by', 'date', 'channel', 'scope']) {
    if (typeof auth[field] !== 'string' || auth[field].trim() === '') {
      throw new Error(`takedown list has no owner authorization (${field} missing): ${listPath}`);
    }
  }
  if (!DATE_PATTERN.test(auth.date)) {
    throw new Error(`takedown authorization date must be YYYY-MM-DD: ${auth.date}`);
  }
  if (!Array.isArray(list.rules) || list.rules.length === 0) {
    throw new Error(`takedown list has no rules: ${listPath}`);
  }
  return list;
}

export function sourceHost(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function hostMatchesDomain(host, domain) {
  const normalized = domain.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

function seriesOf(ticketId) {
  return typeof ticketId === 'string' ? ticketId.split('-')[0] : '';
}

/** Which rule (if any) selects a post. Only `ticketId` and `sourceUrl` are consulted. */
export function matchRule(rules, data) {
  const series = seriesOf(data.ticketId);
  for (const rule of rules) {
    if (rule.series !== series) continue;
    const excluded = (rule.excludeTickets ?? []).some((entry) => entry.ticketId === data.ticketId);
    if (excluded) continue;
    if (Array.isArray(rule.domains)) {
      const host = sourceHost(data.sourceUrl);
      if (!host || !rule.domains.some(({ domain }) => hostMatchesDomain(host, domain))) continue;
    }
    return rule.id;
  }
  return null;
}

export function readPosts(postsDir = DEFAULT_POSTS_DIR) {
  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.mdx'))
    .sort()
    .map((file) => {
      const source = fs.readFileSync(path.join(postsDir, file), 'utf8');
      const { data } = splitPostSource(source, file);
      return { file, id: postIdFromFilename(file), source, data };
    });
}

/**
 * Compute the takedown plan from the current corpus.
 * @param {{ list: object, posts: Array<{ file: string, id: string, data: object }> }} input
 */
export function planTakedown({ list, posts }) {
  const selected = [];
  for (const post of posts) {
    const rule = matchRule(list.rules, post.data);
    if (!rule) continue;
    selected.push({
      ticketId: post.data.ticketId,
      lang: post.data.lang === 'en' ? 'en' : 'zh-tw',
      id: post.id,
      file: post.file,
      rule,
      sourceUrl: post.data.sourceUrl,
      status: post.data.status ?? 'published',
      alreadyTakenDown: isTakenDownData(post.data),
    });
  }

  const boundaryTickets = new Set((list.boundaryCases ?? []).map((entry) => entry.ticketId));
  const leakedBoundary = selected.filter((post) => boundaryTickets.has(post.ticketId));
  if (leakedBoundary.length > 0) {
    throw new Error(
      `boundary cases must not be taken down by rule: ${[...new Set(leakedBoundary.map((post) => post.ticketId))].join(', ')}`
    );
  }

  const byRule = {};
  for (const post of selected) {
    const bucket = (byRule[post.rule] ??= { tickets: new Set(), zh: 0, en: 0 });
    bucket.tickets.add(post.ticketId);
    bucket[post.lang === 'en' ? 'en' : 'zh'] += 1;
  }
  const counts = {
    files: selected.length,
    tickets: new Set(selected.map((post) => post.ticketId)).size,
    alreadyTakenDown: selected.filter((post) => post.alreadyTakenDown).length,
    byRule: Object.fromEntries(
      Object.entries(byRule).map(([rule, bucket]) => [
        rule,
        { tickets: bucket.tickets.size, zh: bucket.zh, en: bucket.en },
      ])
    ),
  };
  return {
    authorization: list.authorization,
    counts,
    boundaryCases: (list.boundaryCases ?? []).map(({ ticketId, category }) => ({
      ticketId,
      category,
    })),
    posts: selected,
  };
}

// ─── Frontmatter rewrite ───────────────────────────────────────────

const TOP_LEVEL_KEY = /^([A-Za-z_][\w-]*):(?:\s|$)/;

/** Split frontmatter lines into top-level entries (key + continuation lines). */
function frontmatterEntries(frontmatterText) {
  const entries = [];
  for (const line of frontmatterText.split('\n')) {
    const key = line.match(TOP_LEVEL_KEY)?.[1];
    if (key) entries.push({ key, lines: [line] });
    else if (entries.length > 0) entries[entries.length - 1].lines.push(line);
    else entries.push({ key: null, lines: [line] });
  }
  return entries;
}

const yamlString = (value) => JSON.stringify(value);

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Rewrite one post into a tombstone (pure). Keeps every original field except the
 * ones D1 changes, and verifies that by re-parsing the result.
 * @param {string} source
 * @param {{ file: string, date: string, sourceTitle: string }} options
 * @returns {{ changed: boolean, content: string }}
 */
export function takeDownSource(source, { file, date, sourceTitle }) {
  if (!DATE_PATTERN.test(date ?? '')) throw new Error(`${file}: --date must be YYYY-MM-DD`);
  const { frontmatterText, data } = splitPostSource(source, file);
  if (isTakenDownData(data)) return { changed: false, content: source };

  const series = getTakedownSeries(data.ticketId);
  if (!series) throw new Error(`${file}: only GP/MP posts can be taken down (${data.ticketId})`);
  const lang = data.lang === 'en' ? 'en' : 'zh-tw';
  const summary = getNeutralSummary({ ticketId: data.ticketId, lang });
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const resolvedTitle = typeof data.sourceTitle === 'string' ? data.sourceTitle : sourceTitle;
  if (typeof resolvedTitle !== 'string' || !resolvedTitle.trim()) {
    throw new Error(`${file}: sourceTitle is required`);
  }
  if (resolvedTitle.trim() === title) {
    throw new Error(`${file}: sourceTitle must not be the gu-log title`);
  }

  const kept = [];
  let hasStatus = false;
  for (const entry of frontmatterEntries(frontmatterText)) {
    if (INCOMPATIBLE_FIELDS.includes(entry.key)) continue;
    if (entry.key === 'summary') {
      kept.push(`summary: ${yamlString(summary)}`);
    } else if (entry.key === 'status') {
      hasStatus = true;
      kept.push(`status: ${yamlString(TAKEN_DOWN_STATUS)}`);
    } else if (entry.key === 'takenDownAt') {
      continue;
    } else {
      kept.push(...entry.lines);
    }
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  if (!hasStatus) kept.push(`status: ${yamlString(TAKEN_DOWN_STATUS)}`);
  kept.push(`takenDownAt: ${yamlString(date)}`);
  if (data.sourceTitle === undefined) kept.push(`sourceTitle: ${yamlString(resolvedTitle.trim())}`);

  const content = `---\n${kept.join('\n')}\n---\n`;
  const after = parseYaml(kept.join('\n'));
  const changedKeys = new Set([
    'status',
    'takenDownAt',
    'summary',
    'sourceTitle',
    ...INCOMPATIBLE_FIELDS,
  ]);
  for (const [key, value] of Object.entries(data)) {
    if (changedKeys.has(key)) continue;
    if (!sameValue(after[key], value)) {
      throw new Error(`${file}: rewrite changed frontmatter field ${key}`);
    }
  }
  for (const key of Object.keys(after)) {
    if (!(key in data) && !changedKeys.has(key)) {
      throw new Error(`${file}: rewrite added unexpected field ${key}`);
    }
  }
  if (
    !isTakenDownData(after) ||
    after.takenDownAt !== date ||
    after.summary !== summary ||
    INCOMPATIBLE_FIELDS.some((field) => after[field] !== undefined)
  ) {
    throw new Error(`${file}: rewrite did not produce the expected takedown fields`);
  }
  return { changed: true, content };
}

// ─── Assets ────────────────────────────────────────────────────────

/**
 * `src/assets/posts/<dir>` directories referenced only by taken-down posts.
 * @param {{ posts: Array<{ source: string, data: { status?: string } }>, assetsDir?: string }} input
 * @returns {string[]}
 */
export function findOrphanAssetDirs({ posts, assetsDir = DEFAULT_ASSETS_DIR }) {
  if (!fs.existsSync(assetsDir)) return [];
  const dirs = fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const liveSources = posts
    .filter((post) => !isTakenDownData(post.data))
    .map((post) => post.source);
  const repoSources = [path.join(REPO_ROOT, 'src/pages'), path.join(REPO_ROOT, 'src/components')]
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => listFiles(dir).map((file) => fs.readFileSync(file, 'utf8')));
  return dirs.filter((dir) => {
    const needle = `assets/posts/${dir}/`;
    return ![...liveSources, ...repoSources].some((text) => text.includes(needle));
  });
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

// ─── CLI ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { postsDir: DEFAULT_POSTS_DIR, assetsDir: DEFAULT_ASSETS_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--plan') args.plan = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--list') args.list = path.resolve(next());
    else if (arg === '--date') args.date = next();
    else if (arg === '--posts-dir') args.postsDir = path.resolve(next());
    else if (arg === '--assets-dir') args.assetsDir = path.resolve(next());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.list) throw new Error('--list <path> is required (the batch rule file)');
  if (Boolean(args.plan) === Boolean(args.apply)) {
    throw new Error('choose exactly one of --plan, --apply');
  }
  return args;
}

/**
 * sourceTitle per ticket, so both languages of a pair share it: an existing
 * sourceTitle, else `source`, else the sourceUrl domain — never a gu-log title.
 * @param {Array<{ data: Record<string, any> }>} ticketPosts
 */
export function sourceTitleForTicket(ticketPosts) {
  const existing = ticketPosts.find((post) => typeof post.data.sourceTitle === 'string');
  if (existing) return existing.data.sourceTitle;
  const primary = ticketPosts.find((post) => post.data.lang !== 'en') ?? ticketPosts[0];
  const titles = new Set(ticketPosts.map((post) => String(post.data.title ?? '').trim()));
  const source = typeof primary.data.source === 'string' ? primary.data.source.trim() : '';
  return source && !titles.has(source) ? source : sourceHost(primary.data.sourceUrl);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = loadTakedownList(args.list);
  const posts = readPosts(args.postsDir);
  const plan = planTakedown({ list, posts });

  if (args.plan) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  if (!DATE_PATTERN.test(args.date ?? '')) throw new Error('--apply needs --date YYYY-MM-DD');
  const planned = new Set(plan.posts.map((post) => post.file));
  const byTicket = new Map();
  for (const post of posts.filter((candidate) => planned.has(candidate.file))) {
    const bucket = byTicket.get(post.data.ticketId) ?? [];
    bucket.push(post);
    byTicket.set(post.data.ticketId, bucket);
  }

  let changed = 0;
  for (const ticketPosts of byTicket.values()) {
    const sourceTitle = sourceTitleForTicket(ticketPosts);
    for (const post of ticketPosts) {
      const result = takeDownSource(post.source, { file: post.file, date: args.date, sourceTitle });
      if (!result.changed) continue;
      fs.writeFileSync(path.join(args.postsDir, post.file), result.content);
      post.source = result.content;
      post.data = splitPostSource(result.content, post.file).data;
      changed += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        changedFiles: changed,
        planned: plan.counts,
        orphanAssetDirs: findOrphanAssetDirs({ posts, assetsDir: args.assetsDir }),
      },
      null,
      2
    )
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(`take-down-posts: ${error.message}`);
    process.exit(1);
  }
}
