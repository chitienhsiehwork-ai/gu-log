import { test, expect } from './fixtures';

test.describe('SD-8 progressive disclosure', () => {
  const postUrl = '/posts/sd-8-20260307-openclaw-survival-guide-for-non-engineers/';

  test('GIVEN the long article WHEN it loads THEN the reading value callout appears before prose', async ({
    page,
  }) => {
    await page.goto(postUrl);

    const callout = page.locator('[data-article-takeaways]');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText('讀完，會得到什麼？');
    await expect(callout).toContainText('選出 Cowork、VPS 或本機');

    const calloutComesFirst = await page.locator('.post-content').evaluate((content) => {
      const takeaways = content.querySelector('[data-article-takeaways]');
      const firstParagraph = content.querySelector('p');
      if (!takeaways || !firstParagraph) return false;
      return Boolean(
        takeaways.compareDocumentPosition(firstParagraph) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(calloutComesFirst).toBe(true);
  });

  test('GIVEN optional detail sections WHEN the article loads THEN all nine are collapsed', async ({
    page,
  }) => {
    await page.goto(postUrl);

    const disclosures = page.locator('[data-article-disclosure]');
    await expect(disclosures).toHaveCount(9);

    const openStates = await disclosures.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLDetailsElement).open)
    );
    expect(openStates).toEqual(Array(9).fill(false));
    await expect(page.locator('[data-article-disclosure] [data-article-disclosure]')).toHaveCount(
      0
    );
  });

  test('GIVEN a collapsed story WHEN the reader activates its summary THEN the story expands', async ({
    page,
  }) => {
    await page.goto(postUrl);

    const story = page
      .locator('[data-article-disclosure]')
      .filter({ hasText: '一覺醒來，帳單爆了' });
    const summary = story.locator('summary');

    await expect(story).not.toHaveAttribute('open', '');
    await summary.click();
    await expect(story).toHaveAttribute('open', '');
    await expect(story).toContainText('$13.86。一天。');

    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(story).not.toHaveAttribute('open', '');
  });

  test('GIVEN a disclosure row WHEN a pointer hovers it THEN the visible title shows feedback', async ({
    page,
  }) => {
    await page.goto(postUrl);

    const summary = page.locator('[data-article-disclosure] summary').first();
    const title = summary.locator('.article-disclosure__title');
    const before = await title.evaluate((element) => getComputedStyle(element).color);

    await summary.hover();
    await expect
      .poll(() => title.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(before);

    const summaryColor = await summary.evaluate((element) => getComputedStyle(element).color);
    await expect(title).toHaveCSS('color', summaryColor);
  });

  test('GIVEN reduced motion WHEN the article loads THEN disclosure transitions are disabled', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(postUrl);

    const disclosure = page.locator('[data-article-disclosure]').first();
    await expect(disclosure.locator('.article-disclosure__title')).toHaveCSS(
      'transition-duration',
      '0s'
    );
    await expect(disclosure.locator('.article-disclosure__icon')).toHaveCSS(
      'transition-duration',
      '0s'
    );
  });
});
