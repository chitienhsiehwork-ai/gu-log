import { expect, test } from '@playwright/test';

// 語言切換鈕連到頁面算好的對應頁；沒有對應頁的回對方語言首頁（#1164）。
// 「連結不能 404」由 check-links 掃 dist 全站把關，這裡鎖的是每類頁面連到「對的」頁。
// 案例只挑之後補翻譯也不會變的頁面，免得翻譯文章的 PR 被這份 spec 擋下來。
const CASES: ReadonlyArray<readonly [page: string, expected: string]> = [
  // 有翻譯的文章：用 getTranslationPair 找到的那一篇
  [
    '/posts/mp-87-20260216-anthropic-pentagon-claude-military',
    '/en/posts/en-mp-87-20260216-anthropic-pentagon-claude-military',
  ],
  [
    '/en/posts/en-mp-87-20260216-anthropic-pentagon-claude-military',
    '/posts/mp-87-20260216-anthropic-pentagon-claude-military',
  ],
  // 沒有對應頁：下架文章（takedown ratchet 擋住同來源的新文章）、只有中文的頁面、404
  ['/posts/gp-275-20260817-article-qwen-3-8-27b', '/en'],
  ['/reading-tracker', '/en'],
  ['/artifacts/gp-194-html-loop', '/en'],
  ['/briefs/2026-02-28-patrol-05', '/en'],
  ['/404', '/en'],
  // 兩邊都有的標籤
  ['/tags/claude-code', '/en/tags/claude-code'],
  ['/en/tags/claude-code', '/tags/claude-code'],
  // 列表頁連到對方語言同一個列表的第一頁
  ['/mogu-picks/2', '/en/mogu-picks'],
  ['/en/level-up', '/level-up'],
  ['/glossary', '/en/glossary'],
];

// 目前只有中文有的標籤。對方語言有沒有這個標籤頁，看執行當下的內容：
// 有就該連過去，沒有就回首頁。之後補了英文版，這個案例也照樣成立。
const ONE_SIDED_TAG = { page: '/tags/istio', counterpart: '/en/tags/istio' };

const toggle = '.nav-icons a.icon-btn';

test.describe('language toggle', () => {
  for (const [path, expected] of CASES) {
    test(`${path} switches to ${expected}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator(toggle)).toHaveAttribute('href', expected);
      const response = await page.request.get(expected);
      expect(response.status(), expected).toBe(200);
    });
  }

  test(`${ONE_SIDED_TAG.page} links to its counterpart only when it exists`, async ({ page }) => {
    const counterpart = await page.request.get(ONE_SIDED_TAG.counterpart);
    const expected = counterpart.status() === 200 ? ONE_SIDED_TAG.counterpart : '/en';
    await page.goto(ONE_SIDED_TAG.page);
    await expect(page.locator(toggle)).toHaveAttribute('href', expected);
  });
});
