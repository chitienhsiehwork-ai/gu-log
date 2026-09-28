import { test, expect } from './fixtures';
import { expectGpHomeBlock, expectGpSeriesListing } from './helpers/gp-listing';

const zhMP = '/posts/mp-291-20260414-anthropic-';
const enMP = '/en/posts/en-mp-291-20260414-anthropic-';
// GP-1 is the self-written demo that stays public but is never listed
// (openspec: editorial-charter, post-takedown).
const zhGP = '/posts/gp-1-20260128-demo';
const enGP = '/en/posts/en-gp-1-20260128-demo';

test.describe('GP reading-guide and MP source-grounded identity', () => {
  test('GIVEN the zh-TW listings WHEN comparing GP and MP THEN MP never uses translation labels', async ({
    page,
    request,
  }) => {
    // GP 系列頁與首頁 GP 區塊照內容判斷（tests/helpers/gp-listing.ts）：系列頁正好列出
    // 公開的導讀，首頁只放其中過了 publish bar 的前幾篇、放不下的由「查看全部」帶去系列頁；
    // 系列頁一篇都不會列時才顯示中性空狀態，永遠不列墓碑與 GP-1 示範文。
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

  test('GIVEN the bilingual About pages WHEN explaining the series THEN GP and MP keep distinct writing contracts', async ({
    page,
  }) => {
    await page.goto('/about');
    await expect(page.locator('.intro')).toContainText('GP 是 ShroomDog 精選的導讀');
    await expect(page.locator('.intro')).not.toContainText('翻譯');
    await expect(page.locator('.intro')).toContainText('MP 由 Mogu 消化來源後寫成自己的文章');

    await page.goto('/en/about');
    await expect(page.locator('.intro')).toContainText("GP is ShroomDog's curated reading guides");
    await expect(page.locator('.intro')).not.toContainText('translat');
    await expect(page.locator('.intro')).toContainText("MP is Mogu's own writing");
  });

  for (const fixture of [
    {
      locale: 'zh-TW',
      mp: zhMP,
      gp: zhGP,
      mpSource: '來源材料',
      gpSource: '原文出處',
      mpPipeline: '來源寫作 pipeline',
      gpPipeline: '導讀 pipeline',
    },
    {
      locale: 'English',
      mp: enMP,
      gp: enGP,
      mpSource: 'Source material',
      gpSource: 'Original source',
      mpPipeline: 'source-grounded writing pipeline',
      gpPipeline: 'reading-guide pipeline',
    },
  ]) {
    test(`GIVEN ${fixture.locale} article pages WHEN rendered THEN MP and GP expose different provenance`, async ({
      page,
    }) => {
      await page.goto(fixture.mp);
      await expect(page.locator('.source-citation strong')).toContainText(fixture.mpSource);
      await expect(page.locator('[data-article-technical-details]')).toContainText(
        fixture.mpPipeline
      );

      await page.goto(fixture.gp);
      await expect(page.locator('.source-citation strong')).toContainText(fixture.gpSource);
      await expect(page.locator('[data-article-technical-details]')).toContainText(
        fixture.gpPipeline
      );
    });
  }
});
