import { test, expect } from './fixtures';

const zhMP = '/posts/mp-291-20260414-anthropic-';
const enMP = '/en/posts/en-mp-291-20260414-anthropic-';
const zhGP = '/posts/gp-24-20260204-claude-is-a-space-to-think';
const enGP = '/en/posts/en-gp-24-20260204-claude-is-a-space-to-think';

test.describe('GP translation and MP source-grounded identity', () => {
  test('GIVEN the zh-TW listings WHEN comparing GP and MP THEN only GP uses translation labels', async ({
    page,
  }) => {
    await page.goto('/');

    const gp = page.locator('section.gp-section');
    await expect(gp.locator('.section-subtitle')).toHaveText('ShroomDog 精選長文翻譯');
    await expect(gp.locator('.post-meta').first()).toContainText('翻譯自');

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
  }) => {
    await page.goto('/en');

    const gp = page.locator('section.gp-section');
    await expect(gp.locator('.section-subtitle')).toContainText('translated');

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
