import { test, expect } from './fixtures';

const zhMP = '/posts/mp-291-20260414-anthropic-';
const enMP = '/en/posts/en-mp-291-20260414-anthropic-';
// GP-1 is the self-written demo that stays public but is never listed
// (openspec: editorial-charter, post-takedown).
const zhGP = '/posts/gp-1-20260128-demo';
const enGP = '/en/posts/en-gp-1-20260128-demo';
// A public GP reading guide (has a source-distance stamp, not taken down).
const zhGuide = '/posts/gp-276-20261019-andrewyng-ai-engineering-skills-map';
const enGuide = '/en/posts/en-gp-276-20261019-andrewyng-ai-engineering-skills-map';

test.describe('GP reading-guide and MP source-grounded identity', () => {
  test('GIVEN the zh-TW listings WHEN comparing GP and MP THEN MP never uses translation labels', async ({
    page,
  }) => {
    await page.goto('/');

    // The GP block lists public reading guides only, never the GP-1 demo; the
    // neutral empty state (src/lib/gp-listing.mjs) shows only when it lists none.
    const gp = page.locator('section.gp-section');
    await expect(gp.locator(`a[href^="${zhGP}"]`)).toHaveCount(0);
    const zhGpLinks = await gp.locator('a[href^="/posts/gp-"]').count();
    await expect(gp.locator('[data-gp-empty-notice]')).toHaveCount(zhGpLinks === 0 ? 1 : 0);
    await expect(gp).not.toContainText('翻譯自');

    const mp = page.locator('section.mogu-picks-section');
    await expect(mp.locator('.section-subtitle')).toHaveText('Mogu 消化來源後寫成的文章');
    await expect(mp.locator('.post-meta').first()).toContainText('來源材料');
    await expect(mp).not.toContainText('翻譯自');

    await page.goto('/mogu-picks');
    await expect(page.locator('.page-subtitle')).toHaveText('Mogu 消化來源材料後寫成的文章');
    await expect(page.locator('.pick-meta').first()).toContainText('來源材料');

    await page.goto('/gu-log-picks');
    await expect(page.locator(`main a[href^="${zhGuide}"]`).first()).toBeVisible();
    await expect(page.locator(`main a[href^="${zhGP}"]`)).toHaveCount(0);
    await expect(page.locator('[data-gp-empty-notice]')).toHaveCount(0);
  });

  test('GIVEN the English listings WHEN comparing GP and MP THEN MP uses source-material labels', async ({
    page,
  }) => {
    await page.goto('/en');

    const gp = page.locator('section.gp-section');
    await expect(gp.locator(`a[href^="${enGP}"]`)).toHaveCount(0);
    const enGpLinks = await gp.locator('a[href^="/en/posts/en-gp-"]').count();
    await expect(gp.locator('[data-gp-empty-notice]')).toHaveCount(enGpLinks === 0 ? 1 : 0);

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
    await expect(page.locator(`main a[href^="${enGuide}"]`).first()).toBeVisible();
    await expect(page.locator(`main a[href^="${enGP}"]`)).toHaveCount(0);
    await expect(page.locator('[data-gp-empty-notice]')).toHaveCount(0);
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
