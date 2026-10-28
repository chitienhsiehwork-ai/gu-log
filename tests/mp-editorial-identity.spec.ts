import { test, expect } from './fixtures';
import { expectGpHomeBlock, expectGpSeriesListing } from './helpers/gp-listing';

const zhMP = '/posts/mp-291-20260414-anthropic-';
const enMP = '/en/posts/en-mp-291-20260414-anthropic-';
// GP-1 is the self-written demo that stays public but is never listed
// (openspec: gp-signature-picks, post-takedown).
const zhGP = '/posts/gp-1-20260128-demo';
const enGP = '/en/posts/en-gp-1-20260128-demo';

test.describe('GP signature picks and MP source-grounded identity', () => {
  test('GIVEN the zh-TW listings WHEN comparing GP and MP THEN MP never uses translation labels', async ({
    page,
    request,
  }) => {
    // GP 系列頁與首頁 GP 區塊照內容判斷（tests/helpers/gp-listing.ts）：系列頁正好列出
    // 公開的招牌文章，一篇都沒有時顯示中性空狀態；首頁只放其中過了 publish bar 的前幾篇、
    // 放不下的由「查看全部」帶去系列頁，一篇都放不了就不輸出 GP 區。永遠不列墓碑與 GP-1 示範文。
    const gpSeries = await expectGpSeriesListing(page, request, 'zh-tw');

    await page.goto('/');
    await expectGpHomeBlock(page, 'zh-tw', gpSeries);

    const mp = page.locator('section.mogu-picks-section');
    await expect(mp.locator('.section-subtitle')).toHaveText('Mogu 消化來源後寫成的文章');
    await expect(mp.locator('.post-meta').first()).toContainText('來源材料');
    await expect(mp).not.toContainText('翻譯自');

    await page.goto('/mogu-picks');
    await expect(page.locator('.page-subtitle')).toHaveText('Mogu 消化來源材料後寫成的文章');
    await expect(page.locator('.pick-meta').first()).toContainText('來源材料');
  });

  test('GIVEN the English listings WHEN comparing GP and MP THEN MP uses source-material labels', async ({
    page,
    request,
  }) => {
    const gpSeries = await expectGpSeriesListing(page, request, 'en');

    await page.goto('/en');
    await expectGpHomeBlock(page, 'en', gpSeries);

    const mp = page.locator('section.mogu-picks-section');
    await expect(mp.locator('.section-subtitle')).toHaveText(
      'Articles written by Mogu from source material'
    );
    await expect(mp.locator('.post-meta').first()).toContainText('Source material:');
    await expect(mp.locator('.section-subtitle')).not.toContainText('Translated');

    await page.goto('/en/mogu-picks');
    await expect(page.locator('.page-subtitle')).toHaveText(
      'Articles written by Mogu from source material'
    );
    await expect(page.locator('.pick-meta').first()).toContainText('Source material:');
  });

  test('GIVEN the bilingual About pages WHEN explaining the series THEN MP is the everyday series and GP its signature picks', async ({
    page,
  }) => {
    await page.goto('/about');
    await expect(page.locator('.intro')).toContainText('GP 是 ShroomDog 從中指定的招牌文章');
    await expect(page.locator('.intro')).not.toContainText(/翻譯|導讀/);
    await expect(page.locator('.intro')).toContainText('Mogu 消化來源後寫成的文章');

    await page.goto('/en/about');
    await expect(page.locator('.intro')).toContainText('ShroomDog picks out as signature articles');
    await expect(page.locator('.intro')).not.toContainText(/translat|reading guide/);
    await expect(page.locator('.intro')).toContainText("MP is Mogu's own writing");
  });

  for (const fixture of [
    {
      locale: 'zh-TW',
      mp: zhMP,
      gp: zhGP,
      source: '來源材料',
      pipeline: '來源寫作 pipeline',
      retired: '導讀 pipeline',
    },
    {
      locale: 'English',
      mp: enMP,
      gp: enGP,
      source: 'Source material',
      pipeline: 'source-grounded writing pipeline',
      retired: 'reading-guide pipeline',
    },
  ]) {
    test(`GIVEN ${fixture.locale} article pages WHEN rendered THEN GP shares the MP source-grounded provenance`, async ({
      page,
    }) => {
      for (const path of [fixture.mp, fixture.gp]) {
        await page.goto(path);
        await expect(page.locator('.source-citation strong')).toContainText(fixture.source);
        const details = page.locator('[data-article-technical-details]');
        await expect(details).toContainText(fixture.pipeline);
        await expect(details).not.toContainText(fixture.retired);
      }
    });
  }
});
