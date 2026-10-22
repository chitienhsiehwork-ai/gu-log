/**
 * 站內連結的判斷與檢查（scripts/check-links.mjs 用）。站內連結 = 以 / 開頭或正式站
 * origin 的網址；有沒有壞掉，看 build 出來的 dist/ 裡有沒有對應的檔案。
 *
 * MDX 正文的連結由 check-links 自己抽；導覽列、語言切換、標籤這些頁面框架的連結不在
 * MDX 裡，collectDistAnchorLinks 直接掃 dist/ 的 HTML 補上。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const INTERNAL_ORIGINS = new Set(['https://gu-log.vercel.app', 'https://www.gu-log.vercel.app']);

export function isInternalLink(url) {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  // Exact origin matching prevents URLs that put the
  // gu-log.vercel.app domain inside a query parameter (e.g.
  // `https://api.qrserver.com/v1/create-qr-code/?data=https://gu-log.vercel.app`),
  // or use a different scheme/port from borrowing a file in dist.
  try {
    return INTERNAL_ORIGINS.has(new URL(url).origin);
  } catch {
    // not a valid absolute URL — fall through
  }
  return false;
}

export function checkInternalLink(url, distDir) {
  if (!isInternalLink(url)) return false;

  let path;
  try {
    // WHATWG URL parsing matches the browser: it removes query/fragment data
    // and normalizes literal or percent-encoded dot segments before the
    // pathname ever reaches the filesystem.
    const parsed = new URL(url, 'https://gu-log.vercel.app');
    if (!INTERNAL_ORIGINS.has(parsed.origin)) return false;
    // dist 的目錄名是原字（例如 tags/Claude Code、tags/斷詞），pathname 是編碼過的
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }

  path = path.replace(/\/$/, '') || '/';
  const distRoot = resolve(distDir);
  const resolvedPath = resolve(distRoot, `.${path}`);
  const candidates = [resolvedPath, join(resolvedPath, 'index.html'), resolvedPath + '.html'];
  const distPrefix = `${distRoot}${sep}`;

  return candidates.some(
    (candidate) =>
      (candidate === distRoot || candidate.startsWith(distPrefix)) && existsSync(candidate)
  );
}

const ANCHOR_HREF = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
// noindex, nofollow 的頁面（404、測試 fixture）宣告連結不給爬蟲追，fixture 還會故意連到
// 不存在的假文章，掃描跟搜尋引擎一樣跳過。
const NOFOLLOW_META = /<meta\s+name=["']robots["']\s+content=["'][^"']*\bnofollow\b/i;

/** 一頁 HTML 裡 `<a href>` 指到的站內網址（不含 <script> 裡組字串的假標籤）。 */
export function extractInternalAnchorHrefs(html) {
  if (NOFOLLOW_META.test(html)) return [];
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  return [...markup.matchAll(ANCHOR_HREF)]
    .map((match) => (match[1] ?? match[2] ?? match[3]).trim().replace(/&amp;/g, '&'))
    .filter(isInternalLink);
}

/**
 * 掃 dist/ 每一頁 HTML 的站內 `<a href>`，同一個網址只留一筆，`file` 記第一個出現的頁面、
 * `context` 記總共幾頁。
 */
export async function collectDistAnchorLinks(distDir) {
  const pages = (await readdir(distDir, { recursive: true }))
    .filter((file) => file.endsWith('.html'))
    .sort();
  const byUrl = new Map();
  for (const page of pages) {
    const html = await readFile(join(distDir, page), 'utf-8');
    for (const url of new Set(extractInternalAnchorHrefs(html))) {
      const seen = byUrl.get(url);
      if (seen) seen.pages += 1;
      else byUrl.set(url, { url, file: `dist/${page.split(sep).join('/')}`, pages: 1 });
    }
  }
  return {
    pageCount: pages.length,
    links: [...byUrl.values()].map(({ url, file, pages: count }) => ({
      url,
      type: 'html',
      context: `<a href> on ${count} page(s)`,
      file,
    })),
  };
}
