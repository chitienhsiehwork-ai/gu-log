import { listTakenDownPosts, normalizeSitePath } from './taken-down-posts.mjs';

// /artifacts/ 底下給 e2e 用的 *-fixture 頁不是給讀者看的內容。
const FIXTURE_PAGE = /^\/artifacts\/[^/]+-fixture$/;

// sitemap 不收的頁：下架文章（openspec: post-takedown，保留網址、回墓碑頁加 noindex，
// 判斷只看 frontmatter 的 status）和測試 fixture 頁。
export function createSitemapFilter(
  takenDownPaths = new Set(listTakenDownPosts().map((post) => post.path))
) {
  return (page) => {
    const sitePath = normalizeSitePath(page);
    return !takenDownPaths.has(sitePath) && !FIXTURE_PAGE.test(sitePath);
  };
}
