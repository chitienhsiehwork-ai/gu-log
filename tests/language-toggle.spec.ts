import { expect, test } from '@playwright/test';

// 語言切換鈕連到頁面算好的對應頁；沒有對應頁的回對方語言首頁（#1164）。
// 「連結不能 404」由 check-links 掃 dist 全站把關，這裡鎖的是每類頁面連到「對的」頁。
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
  // 還沒有英文版的文章、只有中文的頁面
  ['/posts/sd-8-20260307-openclaw-survival-guide-for-non-engineers', '/en'],
  ['/reading-tracker', '/en'],
  ['/artifacts/gp-194-html-loop', '/en'],
  // 標籤：對方語言也有這個標籤才連過去
  ['/tags/claude-code', '/en/tags/claude-code'],
  ['/en/tags/claude-code', '/tags/claude-code'],
  ['/tags/istio', '/en'],
  // 列表頁連到對方語言同一個列表的第一頁
  ['/mogu-picks/2', '/en/mogu-picks'],
  ['/en/level-up', '/level-up'],
  ['/glossary', '/en/glossary'],
];

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
});
