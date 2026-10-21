/**
 * 中英首頁每個系列區塊的「View all」連結都要打得開。
 *
 * #1164：英文首頁 Lv 區塊的 View all 連到不存在的 /en/level-up，PR CI 沒有任何
 * 一步真的去請求那個網址，一路綠到上線才被發現。這裡不寫死系列清單，直接從首頁
 * 抓連結，以後哪個系列的 View all 指錯，PR 的 e2e-core 就會紅。
 */
import { test, expect } from './fixtures';

for (const home of ['/', '/en']) {
  test(`${home} View all links open existing series listings`, async ({ page, request }) => {
    await page.goto(home);
    const hrefs = await page
      .locator('.view-all a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs.length, `${home} has no View all links`).toBeGreaterThan(0);

    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), `${home} View all → ${href}`).toBe(200);
    }
  });
}
