/**
 * 從 src/content/posts 的 MDX frontmatter 讀出已下架（status: taken-down）的文章
 * （openspec: post-takedown）。
 *
 * 給拿不到 astro:content 的 Node 腳本共用，例如 astro.config 的 sitemap filter、
 * postbuild 洩漏檢查、CI 棘輪、下架工具、validator 與內容 gates，以及
 * tribunal-v2-run 的單篇守門。判斷只看 frontmatter 的 `status`，不看檔名、
 * 系列或任何清單。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { TAKEN_DOWN_STATUS } from '../../src/lib/tombstone-copy.mjs';

export { TAKEN_DOWN_STATUS };

export const DEFAULT_POSTS_DIR = fileURLToPath(
  new URL('../../src/content/posts/', import.meta.url)
);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * 切出 frontmatter 與正文。YAML 解析失敗時丟出含來源名稱的錯誤。
 * @param {string} source
 * @param {string} [sourceName]
 */
export function splitPostSource(source, sourceName = '<post>') {
  const match = source.match(FRONTMATTER);
  if (!match) throw new Error(`${sourceName}: frontmatter block is missing`);
  let data;
  try {
    data = parseYaml(match[1]) ?? {};
  } catch (error) {
    throw new Error(`${sourceName}: invalid frontmatter YAML (${error.message})`, {
      cause: error,
    });
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${sourceName}: frontmatter must be a mapping`);
  }
  return { frontmatterText: match[1], data, body: source.slice(match[0].length) };
}

/** 正式網址用的 post id：檔名去掉 .mdx 後轉小寫（與 Astro glob loader 一致）。 */
export function postIdFromFilename(filename) {
  return path
    .basename(filename)
    .replace(/\.mdx$/i, '')
    .toLowerCase();
}

/** 站內正式路徑：繁中 /posts/{id}、英文 /en/posts/{id}。 */
export function postPathFor({ id, lang }) {
  return lang === 'en' ? `/en/posts/${id}` : `/posts/${id}`;
}

/** Frontmatter 欄位在下架後必須拿掉（和 taken-down 不相容），validator 與下架工具共用。 */
export const TAKEN_DOWN_INCOMPATIBLE_FIELDS = Object.freeze([
  'deprecatedBy',
  'deprecatedReason',
  'retiredReason',
  'retiredAt',
]);

/** 這篇（frontmatter 資料）是不是下架文章。JS 這邊只用這個判斷，不各自比字串。 */
export function isTakenDownData(data) {
  return data?.status === TAKEN_DOWN_STATUS;
}

/**
 * 文章原始碼是不是下架文章。frontmatter 讀不出來時回 false，交給 validate-posts 報錯。
 * @param {string} source
 * @param {string} [sourceName]
 */
export function isTakenDownSource(source, sourceName) {
  try {
    return isTakenDownData(splitPostSource(source, sourceName).data);
  } catch {
    return false;
  }
}

/**
 * 讀出目錄中所有 MDX 文章：frontmatter 摘要，加上原始碼（`source`）與正文（`body`）。
 * @param {string} [postsDir]
 */
export function readPostIndex(postsDir = DEFAULT_POSTS_DIR) {
  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.mdx'))
    .sort()
    .map((file) => {
      const source = fs.readFileSync(path.join(postsDir, file), 'utf8');
      const { data, body } = splitPostSource(source, file);
      const id = postIdFromFilename(file);
      const lang = data.lang === 'en' ? 'en' : 'zh-tw';
      return {
        file,
        id,
        lang,
        path: postPathFor({ id, lang }),
        ticketId: typeof data.ticketId === 'string' ? data.ticketId : '',
        status: typeof data.status === 'string' ? data.status : 'published',
        data,
        source,
        body,
      };
    });
}

/**
 * 已下架文章清單。
 * @param {string} [postsDir]
 */
export function listTakenDownPosts(postsDir = DEFAULT_POSTS_DIR) {
  return readPostIndex(postsDir).filter((post) => isTakenDownData(post.data));
}

/**
 * 把網址或路徑正規化成比對用的站內路徑（去掉 origin、query、hash 與結尾斜線）。
 * @param {string} value
 */
export function normalizeSitePath(value) {
  const pathname = new URL(value, 'https://gu-log.vercel.app').pathname;
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
