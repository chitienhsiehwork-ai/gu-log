#!/usr/bin/env node
/**
 * take-down-posts.mjs — 依規則把文章下架成墓碑（openspec: post-takedown，design D10）
 *
 * 下架清單不另存快照：每次都依 takedown-list.json 的授權與規則，從當下語料算出。
 *
 *   --plan                      依規則列出下架清單與統計（JSON），controller 用它對帳
 *   --resolve-source-metadata   替缺 sourceTitle／author 的文章查來源 metadata，寫進 --cache
 *   --apply --date YYYY-MM-DD   改 frontmatter、清空正文；已下架的檔案不再變動（可重跑）
 *   --prune-assets              搭配 --apply：刪除只被下架文章用到的 src/assets/posts/** 目錄
 *
 * 其他選項：--list <path>（規則檔）、--cache <path>（metadata cache，不 commit）、
 * --posts-dir／--assets-dir（測試用）。網路查詢需要 NODE_USE_ENV_PROXY=1（沙盒 proxy）。
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
import { findEmojiSequences } from './lib/emoji-sequences.mjs';
import { postIdFromFilename, splitPostSource } from './lib/taken-down-posts.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_LIST_PATH = path.join(
  REPO_ROOT,
  'openspec/changes/translation-takedown-tombstone/takedown-list.json'
);
const DEFAULT_POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const DEFAULT_ASSETS_DIR = path.join(REPO_ROOT, 'src/assets/posts');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INCOMPATIBLE_FIELDS = ['deprecatedBy', 'deprecatedReason', 'retiredReason', 'retiredAt'];
const MAX_SOURCE_TITLE = 160;
const MAX_TWEET_TITLE = 80;

// ─── Rules ─────────────────────────────────────────────────────────

/** Load and validate the rules file; a batch without an owner authorization never runs. */
export function loadTakedownList(listPath = DEFAULT_LIST_PATH) {
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
      alreadyTakenDown: post.data.status === TAKEN_DOWN_STATUS,
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

// ─── Source metadata ───────────────────────────────────────────────

const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
});

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
}

function metaContent(html, attribute, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    if (key?.toLowerCase() !== name) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    const value = content?.[1] ?? content?.[2];
    if (value && value.trim()) return decodeEntities(value).trim();
  }
  return null;
}

/** Title and author from a web page: og:title → twitter:title → <title>; author meta tags. */
export function extractHtmlMetadata(html) {
  const title =
    metaContent(html, 'property', 'og:title') ??
    metaContent(html, 'name', 'og:title') ??
    metaContent(html, 'name', 'twitter:title') ??
    metaContent(html, 'property', 'twitter:title') ??
    (() => {
      const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      return raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() || null : null;
    })();
  const author =
    metaContent(html, 'name', 'author') ??
    metaContent(html, 'property', 'article:author') ??
    metaContent(html, 'name', 'article:author') ??
    null;
  return { title, author: author && !/^https?:\/\//i.test(author) ? author : null };
}

/** First sentence of a tweet, at most MAX_TWEET_TITLE characters. */
export function firstSentence(text, limit = MAX_TWEET_TITLE) {
  const withoutUrls = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Latin terminators need a following space ("v1.2" is not a sentence end);
  // CJK terminators end a sentence on their own.
  const sentence = withoutUrls.match(/^[\s\S]*?(?:[.!?](?=\s|$)|[。！？])/u)?.[0] ?? withoutUrls;
  const chars = [...sentence.trim()];
  return chars.length <= limit
    ? chars.join('')
    : `${chars
        .slice(0, limit - 1)
        .join('')
        .trimEnd()}…`;
}

/** Title and author from an fxtwitter status payload: X Article title, else the tweet's first sentence. */
export function tweetMetadata(payload) {
  const tweet = payload?.tweet;
  if (!tweet) return { title: null, author: null };
  const articleTitle = tweet.article?.title;
  const text = tweet.raw_text?.text ?? tweet.text ?? '';
  return {
    title: articleTitle?.trim() || (text.trim() ? firstSentence(text) : null),
    author: tweet.author?.name?.trim() || null,
  };
}

/** Emoji-free, single-line, bounded value that is never the gu-log title. */
export function cleanMetadataValue(value, { forbid = [], max = MAX_SOURCE_TITLE } = {}) {
  if (typeof value !== 'string') return null;
  let cleaned = decodeEntities(value).replace(/\s*\{#[^}]*\}/g, '');
  for (const { emoji } of findEmojiSequences(cleaned)) cleaned = cleaned.replaceAll(emoji, ' ');
  cleaned = cleaned
    .replace(/\u200d|\ufe0f|\u2060/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const chars = [...cleaned];
  if (chars.length > max)
    cleaned = `${chars
      .slice(0, max - 1)
      .join('')
      .trimEnd()}…`;
  if (forbid.some((other) => typeof other === 'string' && other.trim() === cleaned)) return null;
  return cleaned;
}

function tweetApiUrl(sourceUrl) {
  const match = sourceUrl.match(
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i
  );
  return match ? `https://api.fxtwitter.com/${match[1]}/status/${match[2]}` : null;
}

async function fetchWithTimeout(url, { timeoutMs = 15000, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; gu-log-takedown/1.0; +https://gu-log.vercel.app)',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveSourceMetadata(sourceUrl, { fetchImpl = fetchWithTimeout } = {}) {
  const api = tweetApiUrl(sourceUrl);
  try {
    if (api) {
      const response = await fetchImpl(api);
      if (!response.ok) return { title: null, author: null, via: `fxtwitter:${response.status}` };
      return { ...tweetMetadata(await response.json()), via: 'fxtwitter' };
    }
    const response = await fetchImpl(sourceUrl);
    if (!response.ok) return { title: null, author: null, via: `http:${response.status}` };
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('html')) return { title: null, author: null, via: `type:${type}` };
    return { ...extractHtmlMetadata(await response.text()), via: 'html' };
  } catch (error) {
    return { title: null, author: null, via: `error:${error.name}` };
  }
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
 */
export function takeDownSource(source, { file, date, sourceTitle, author }) {
  if (!DATE_PATTERN.test(date ?? '')) throw new Error(`${file}: --date must be YYYY-MM-DD`);
  const { frontmatterText, data } = splitPostSource(source, file);
  if (data.status === TAKEN_DOWN_STATUS) return { changed: false, content: source };

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
  if (data.author === undefined && typeof author === 'string' && author.trim()) {
    kept.push(`author: ${yamlString(author.trim())}`);
  }

  const content = `---\n${kept.join('\n')}\n---\n`;
  const after = parseYaml(kept.join('\n'));
  const changedKeys = new Set([
    'status',
    'takenDownAt',
    'summary',
    'sourceTitle',
    'author',
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
    after.status !== TAKEN_DOWN_STATUS ||
    after.takenDownAt !== date ||
    after.summary !== summary ||
    INCOMPATIBLE_FIELDS.some((field) => after[field] !== undefined) ||
    (data.author !== undefined && !sameValue(after.author, data.author))
  ) {
    throw new Error(`${file}: rewrite did not produce the expected takedown fields`);
  }
  return { changed: true, content };
}

// ─── Assets ────────────────────────────────────────────────────────

/** `src/assets/posts/<dir>` directories referenced only by taken-down posts. */
export function findOrphanAssetDirs({ posts, assetsDir = DEFAULT_ASSETS_DIR }) {
  if (!fs.existsSync(assetsDir)) return [];
  const dirs = fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const liveSources = posts
    .filter((post) => post.data.status !== TAKEN_DOWN_STATUS)
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
  const args = {
    list: DEFAULT_LIST_PATH,
    postsDir: DEFAULT_POSTS_DIR,
    assetsDir: DEFAULT_ASSETS_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--plan') args.plan = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--resolve-source-metadata') args.resolve = true;
    else if (arg === '--prune-assets') args.pruneAssets = true;
    else if (arg === '--list') args.list = path.resolve(next());
    else if (arg === '--cache') args.cache = path.resolve(next());
    else if (arg === '--date') args.date = next();
    else if (arg === '--posts-dir') args.postsDir = path.resolve(next());
    else if (arg === '--assets-dir') args.assetsDir = path.resolve(next());
    else throw new Error(`unknown argument: ${arg}`);
  }
  if ([args.plan, args.apply, args.resolve].filter(Boolean).length !== 1) {
    throw new Error('choose exactly one of --plan, --resolve-source-metadata, --apply');
  }
  return args;
}

function readCache(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) return {};
  return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

/** sourceTitle / author per ticket, so both languages of a pair share them. */
function metadataForTicket(ticketPosts, cache) {
  const primary = ticketPosts.find((post) => post.data.lang !== 'en') ?? ticketPosts[0];
  const forbid = ticketPosts.map((post) => post.data.title);
  const cached = cache[primary.data.sourceUrl] ?? {};
  const existing = ticketPosts.find((post) => typeof post.data.sourceTitle === 'string');
  const sourceTitle =
    existing?.data.sourceTitle ??
    cleanMetadataValue(cached.sourceTitle, { forbid }) ??
    cleanMetadataValue(primary.data.source, { forbid }) ??
    sourceHost(primary.data.sourceUrl);
  const author = cleanMetadataValue(cached.author, { forbid, max: 80 });
  return { sourceTitle, author };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = loadTakedownList(args.list);
  const posts = readPosts(args.postsDir);
  const plan = planTakedown({ list, posts });

  if (args.plan) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const planned = new Set(plan.posts.map((post) => post.file));
  const byTicket = new Map();
  for (const post of posts.filter((candidate) => planned.has(candidate.file))) {
    const bucket = byTicket.get(post.data.ticketId) ?? [];
    bucket.push(post);
    byTicket.set(post.data.ticketId, bucket);
  }

  if (args.resolve) {
    if (!args.cache) throw new Error('--resolve-source-metadata needs --cache <path>');
    const cache = readCache(args.cache);
    const pending = [...byTicket.values()]
      .map((ticketPosts) => ticketPosts.find((post) => post.data.lang !== 'en') ?? ticketPosts[0])
      .filter((post) => post.data.status !== TAKEN_DOWN_STATUS)
      .filter((post) => post.data.sourceTitle === undefined || post.data.author === undefined)
      .filter((post) => !cache[post.data.sourceUrl]);
    let done = 0;
    for (const post of pending) {
      const result = await resolveSourceMetadata(post.data.sourceUrl);
      cache[post.data.sourceUrl] = {
        sourceTitle: result.title,
        author: result.author,
        via: result.via,
      };
      done += 1;
      if (done % 20 === 0 || done === pending.length) {
        fs.writeFileSync(args.cache, `${JSON.stringify(cache, null, 2)}\n`);
        console.error(`resolved ${done}/${pending.length}`);
      }
    }
    fs.writeFileSync(args.cache, `${JSON.stringify(cache, null, 2)}\n`);
    return;
  }

  if (!DATE_PATTERN.test(args.date ?? '')) throw new Error('--apply needs --date YYYY-MM-DD');
  const cache = readCache(args.cache);
  let changed = 0;
  for (const ticketPosts of byTicket.values()) {
    const metadata = metadataForTicket(ticketPosts, cache);
    for (const post of ticketPosts) {
      const result = takeDownSource(post.source, {
        file: post.file,
        date: args.date,
        sourceTitle: metadata.sourceTitle,
        author: metadata.author,
      });
      if (!result.changed) continue;
      fs.writeFileSync(path.join(args.postsDir, post.file), result.content);
      post.source = result.content;
      post.data = splitPostSource(result.content, post.file).data;
      changed += 1;
    }
  }

  const orphans = findOrphanAssetDirs({ posts, assetsDir: args.assetsDir });
  if (args.pruneAssets) {
    for (const dir of orphans) fs.rmSync(path.join(args.assetsDir, dir), { recursive: true });
  }
  console.log(
    JSON.stringify(
      {
        changedFiles: changed,
        planned: plan.counts,
        orphanAssetDirs: orphans,
        prunedAssets: Boolean(args.pruneAssets),
      },
      null,
      2
    )
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`take-down-posts: ${error.message}`);
    process.exit(1);
  });
}
