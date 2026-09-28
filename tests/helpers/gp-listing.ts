/**
 * GP 列表的 e2e 期望值與斷言（openspec: editorial-charter〈讀者開啟 GP 系列頁〉）。
 *
 * 期望值照內容算，不寫死「GP 列表是空的」：讀出 src/content/posts 的 frontmatter，交給頁面
 * 用的同一組純函式（getListablePosts／getIndexPosts、isListedGpTicket）算出每個語言該列哪
 * 幾篇，之後發布新的 GP 導讀不用回來改測試。墓碑與 GP-1 另外直接看 frontmatter 再擋一次：
 * 就算共用函式壞掉、頁面跟期望值一起錯，它們也不能出現在列表上。
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { getGpEmptyNotice, isListedGpTicket } from '../../src/lib/gp-listing.mjs';
import { getIndexPosts, getListablePosts } from '../../src/utils/post-status';
import {
  isTakenDownData,
  postPathFor,
  readPostIndex,
} from '../../scripts/lib/taken-down-posts.mjs';

type Lang = 'zh-tw' | 'en';
type PostEntries = Parameters<typeof getListablePosts>[0];

/** 首頁每個系列區塊最多預覽幾篇（src/pages/index.astro、src/pages/en/index.astro）。 */
const HOME_PREVIEW_LIMIT = 3;

let postIndex: ReturnType<typeof readPostIndex> | undefined;

/** 全部文章讀一次約一秒，用到才讀，不拖慢其他 spec 的收集。 */
function posts() {
  postIndex ??= readPostIndex();
  return postIndex;
}

/**
 * 頁面拿到的 content entry：frontmatter 原樣，加上 src/content.config.ts 的預設值
 * （lang、status）。
 */
function entries(): PostEntries {
  return posts().map(({ id, lang, status, data }) => ({
    id,
    data: { ...data, lang, status },
  })) as unknown as PostEntries;
}

function gpPaths(listable: PostEntries): string[] {
  return listable
    .filter((post) => isListedGpTicket(post.data.ticketId))
    .map((post) => postPathFor({ id: post.id, lang: post.data.lang }))
    .sort();
}

/** GP 系列頁（src/pages/gu-log-picks、src/pages/en/gu-log-picks）該列的文章。 */
function expectedSeriesPaths(lang: Lang): string[] {
  return gpPaths(getListablePosts(entries(), lang));
}

/** 首頁 GP 區塊能放的文章：首頁用 getIndexPosts，沒過 publish bar 的不上首頁。 */
function expectedHomePaths(lang: Lang): string[] {
  return gpPaths(getIndexPosts(entries(), lang));
}

/**
 * 該語言的墓碑與 GP-1 示範文。刻意寫死 spec 點名的 GP-1、不用 GP_DEMO_TICKET，
 * 常數被改錯也擋得住。
 */
function neverListedPaths(lang: Lang): ReadonlySet<string> {
  return new Set(
    posts()
      .filter(
        (post) => post.lang === lang && (isTakenDownData(post.data) || post.ticketId === 'GP-1')
      )
      .map((post) => post.path)
  );
}

function seriesListingPath(lang: Lang): string {
  return lang === 'en' ? '/en/gu-log-picks' : '/gu-log-picks';
}

function postLinkSelector(lang: Lang): string {
  return lang === 'en' ? 'a[href^="/en/posts/"]' : 'a[href^="/posts/"]';
}

async function listedPostPaths(scope: Locator, lang: Lang): Promise<string[]> {
  return scope
    .locator(postLinkSelector(lang))
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

function expectNeverListed(listed: readonly string[], lang: Lang) {
  const neverListed = neverListedPaths(lang);
  expect(
    listed.filter((path) => neverListed.has(path)),
    'GP 列表不能出現墓碑或 GP-1'
  ).toEqual([]);
}

/**
 * 開 GP 系列頁並照內容斷言：沒有公開導讀時是中性空狀態、零連結、沒有分頁；有的話沒有
 * 空狀態，所有分頁列出的文章正好是期望的那幾篇。回傳頁面上的順序，給首頁區塊比對。
 */
export async function expectGpSeriesListing(
  page: Page,
  request: APIRequestContext,
  lang: Lang
): Promise<string[]> {
  const listingPath = seriesListingPath(lang);
  const expected = expectedSeriesPaths(lang);
  const emptyNotice = page.locator('[data-gp-empty-notice]');

  const response = await page.goto(listingPath);
  expect(response?.status(), listingPath).toBe(200);

  if (expected.length === 0) {
    await expect(emptyNotice).toHaveText(getGpEmptyNotice(lang));
    await expect(page.locator(`main ${postLinkSelector(lang)}`)).toHaveCount(0);
    await expect(page.locator('nav.pagination')).toHaveCount(0);
    expect((await request.get(`${listingPath}/2`)).status()).toBe(404);
    return [];
  }

  // 每頁幾篇是頁面自己的事：沿著「下一頁」走到底，收集每一頁列出的文章。
  const listed: string[] = [];
  let lastPage = 1;
  for (;;) {
    await expect(emptyNotice).toHaveCount(0);
    const onPage = await listedPostPaths(page.locator('main'), lang);
    expect(onPage, `${listingPath} 第 ${lastPage} 頁沒有列出文章`).not.toEqual([]);
    expectNeverListed(onPage, lang);
    listed.push(...onPage);
    const next = page.locator('nav.pagination a.pagination-next');
    if ((await next.count()) === 0) break;
    expect(listed.length, `${listingPath} 列出的文章比期望的多`).toBeLessThan(expected.length);
    const nextPath = await next.getAttribute('href');
    if (!nextPath) throw new Error(`${listingPath} 第 ${lastPage} 頁的「下一頁」沒有 href`);
    expect((await page.goto(nextPath))?.status(), nextPath).toBe(200);
    lastPage += 1;
  }

  expect([...listed].sort()).toEqual(expected);
  expect((await request.get(`${listingPath}/${lastPage + 1}`)).status()).toBe(404);
  return listed;
}

/**
 * 在已開好的首頁斷言 GP 區塊。空狀態只看系列頁會不會列出任何導讀（openspec:
 * editorial-charter）：一篇都沒有時是中性空狀態、零連結、沒有「查看全部」。有的話沒有空狀態，
 * 照首頁的挑選規則（getIndexPosts）依 `seriesOrder`（expectGpSeriesListing 回傳的系列頁順序）
 * 放最前面幾篇；系列頁列的比首頁放的多時，要有連到系列頁的「查看全部」。首頁區塊是系列頁的
 * 預覽，排序跟著系列頁，測試就不必另寫一套排序規則。
 */
export async function expectGpHomeBlock(page: Page, lang: Lang, seriesOrder: readonly string[]) {
  const listedCount = expectedSeriesPaths(lang).length;
  const eligible = new Set(expectedHomePaths(lang));
  expect(seriesOrder, '首頁能放的 GP 都該列在系列頁上').toEqual(
    expect.arrayContaining([...eligible])
  );
  const expected = seriesOrder.filter((path) => eligible.has(path)).slice(0, HOME_PREVIEW_LIMIT);
  const section = page.locator('section.gp-section');
  const emptyNotice = section.locator('[data-gp-empty-notice]');
  const viewAll = section.locator('.view-all a');

  if (listedCount === 0) {
    await expect(emptyNotice).toHaveText(getGpEmptyNotice(lang));
  } else {
    await expect(emptyNotice).toHaveCount(0);
  }

  const shown = await listedPostPaths(section, lang);
  expect(shown).toEqual(expected);
  expectNeverListed(shown, lang);

  if (listedCount > expected.length) {
    await expect(viewAll).toHaveAttribute('href', seriesListingPath(lang));
  } else {
    await expect(viewAll).toHaveCount(0);
  }
}
