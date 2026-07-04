/**
 * publish-bar-visibility spec 的頁面層 Tier-1 測試。
 * Spec: openspec/specs/publish-bar-visibility/spec.md
 *
 * 用 production 判定函式（isBelowPublishBar / meetsPublishBar /
 * hasTribunalScore）從 src/content/posts 動態挑代表文章，不寫死 slug——
 * 文章日後被背景 tribunal 拉過 bar 也不會讓測試爛掉；某類別目前沒有
 * 代表文章時 skip（不算失敗）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { test, expect } from './fixtures';
import {
  hasTribunalScore,
  isBelowPublishBar,
  meetsPublishBar,
} from '../src/utils/tribunal-scores';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');
const BANNER = '.sub8-refining-banner';

type PostKind = 'below-bar' | 'passing' | 'grandfathered';

/** 挑第一篇符合類別的 zh-tw 已發佈文章，回傳其 URL slug（無 .mdx）。 */
function pickPost(kind: PostKind): string | null {
  const files = fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'))
    .sort();
  for (const file of files) {
    const fm = matter.read(path.join(POSTS_DIR, file)).data as {
      status?: string;
      scores?: Parameters<typeof isBelowPublishBar>[0];
    };
    if (fm.status === 'deprecated' || fm.status === 'retired') continue;
    const matched =
      kind === 'below-bar'
        ? isBelowPublishBar(fm.scores)
        : kind === 'passing'
          ? meetsPublishBar(fm.scores)
          : !hasTribunalScore(fm.scores);
    if (matched) return file.replace(/\.mdx$/, '');
  }
  return null;
}

test.describe('publish-bar-visibility — 文章頁 banner 行為', () => {
  test('below-bar 文章照常發佈（200）且掛精修中 banner 含 composite 分數', async ({ page }) => {
    // Scenario: Below-bar post builds and serves + Banner on below-bar post page
    const slug = pickPost('below-bar');
    test.skip(!slug, 'repo 目前沒有 below-bar 的 zh-tw 文章');
    const res = await page.goto(`/posts/${slug}/`);
    expect(res?.status()).toBe(200);
    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible();
    await expect(banner.locator('.banner-score')).toContainText('/10');
  });

  test('passing 文章頁不渲染精修中 banner', async ({ page }) => {
    // Scenario: No banner on passing post page
    const slug = pickPost('passing');
    test.skip(!slug, 'repo 目前沒有 meetsPublishBar 的 zh-tw 文章');
    const res = await page.goto(`/posts/${slug}/`);
    expect(res?.status()).toBe(200);
    await expect(page.locator(BANNER)).toHaveCount(0);
  });

  test('grandfathered（未評分）文章頁不渲染精修中 banner', async ({ page }) => {
    // Scenario: Grandfathered post stays on homepage（banner 半邊；首頁半邊在
    // tests/post-status.test.ts 以 getIndexPosts 覆蓋）
    const slug = pickPost('grandfathered');
    test.skip(!slug, 'repo 目前沒有未評分的 zh-tw 文章');
    const res = await page.goto(`/posts/${slug}/`);
    expect(res?.status()).toBe(200);
    await expect(page.locator(BANNER)).toHaveCount(0);
  });
});
