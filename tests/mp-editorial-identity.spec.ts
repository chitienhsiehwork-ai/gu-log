import { test, expect } from './fixtures';

const zhMP = '/posts/mp-291-20260414-anthropic-';
const enMP = '/en/posts/en-mp-291-20260414-anthropic-';
// GP-1 is the self-written demo that stays public while GP translations are
// taken down and the GP series is paused (openspec: post-takedown).
const zhGP = '/posts/gp-1-20260128-demo';
const enGP = '/en/posts/en-gp-1-20260128-demo';

test.describe('GP translation and MP source-grounded identity', () => {
  test('GIVEN the zh-TW listings WHEN comparing GP and MP THEN MP never uses translation labels', async ({
    page,
  }) => {
    await page.goto('/');

    // GP is paused: the homepage has no GP section and the GP listing shows
    // only the rebuild notice (src/lib/gp-series-pause.mjs).
    await expect(page.locator('section.gp-section')).toHaveCount(0);

    const mp = page.locator('section.mogu-picks-section');
    await expect(mp.locator('.section-subtitle')).toHaveText('Mogu 消化來源後寫成的文章');
    await expect(mp.locator('.post-meta').first()).toContainText('來源材料');
    await expect(mp).not.toContainText('翻譯自');

    await page.goto('/mogu-picks');
    await expect(page.locator('.page-subtitle')).toHaveText('Mogu 消化來源材料後寫成的文章');
    await expect(page.locator('.pick-meta').first()).toContainText('來源材料');

    await page.goto('/gu-log-picks');
    await expect(page.locator('[data-gp-paused-notice]')).toHaveText(
      'GP 正在改版：以後這裡會是 ShroomDog 精選的導讀'
    );
    await expect(page.locator('main a[href^="/posts/"]')).toHaveCount(0);
  });

  test('GIVEN the English listings WHEN comparing GP and MP THEN MP uses source-material labels', async ({
    page,
  }) => {
    await page.goto('/en');

    await expect(page.locator('section.gp-section')).toHaveCount(0);

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

    await page.goto('/en/gu-log-picks');
    await expect(page.locator('[data-gp-paused-notice]')).toHaveText(
      "Gu-log Picks is being rebuilt: this page will become ShroomDog's curated reading guides."
    );
    await expect(page.locator('main a[href^="/en/posts/"]')).toHaveCount(0);
  });

  test('GIVEN the bilingual About pages WHEN explaining the series THEN GP and MP keep distinct writing contracts', async ({
    page,
  }) => {
    await page.goto('/about');
    await expect(page.locator('.intro')).toContainText('GP 忠實翻譯外文好文');
    await expect(page.locator('.intro')).toContainText('MP 由 Mogu 消化來源後寫成自己的文章');

    await page.goto('/en/about');
    await expect(page.locator('.intro')).toContainText('GP faithfully translates source authors');
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
      gpPipeline: '翻譯 pipeline',
    },
    {
      locale: 'English',
      mp: enMP,
      gp: enGP,
      mpSource: 'Source material',
      gpSource: 'Original source',
      mpPipeline: 'source-grounded writing pipeline',
      gpPipeline: 'translation pipeline',
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
