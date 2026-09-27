import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Taken-down posts render only the final tombstone (openspec: post-takedown).
 * Copy is checked word for word against the spec; the article periphery must
 * be absent, the page must carry `noindex`, and the kaomoji must not break.
 */

const WJ_OR_NBSP = /[\u2060\u00a0]/g;

async function visibleLines(page: Page, selector: string) {
  return (await page.locator(selector).allTextContents()).map((text) =>
    text.replace(WJ_OR_NBSP, (character) => (character === '\u00a0' ? ' ' : '')).trim()
  );
}

const GP_ZH = {
  url: '/posts/gp-50-20260212-karpathy-deepwiki-bacterial-code',
  title: 'Karpathy：把別人的 Library「撕」下來用——DeepWiki + Bacterial Code 的軟體可塑性革命',
  ticketId: 'GP-50',
  pill: '已下架',
  stone: ['gu-log 的', '翻譯文章之墓', '2026.02.12 – 2026.09.28', '安息吧 (－人－)'],
  bubbleTitle: 'Mogu 內心小劇場：',
  bubble: [
    '嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ',
    '結果才知道，整篇翻譯要先經過作者同意',
    '可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))',
    '只好幫中文版立個小墓碑',
    '還好原文沒事，點下面去看原汁原味的吧！',
  ],
  cardLabel: '去讀原文 →',
  sourceTitle: 'On DeepWiki and increasing malleability of software.',
  byline: 'Andrej Karpathy · x.com',
  sourceUrl: 'https://x.com/karpathy/status/2021633574089416993',
  home: { label: '回首頁 →', href: '/' },
  heading:
    'Karpathy：把別人的 Library「撕」下來用——DeepWiki + Bacterial Code 的軟體可塑性革命（gu-log 翻譯文章，已下架）',
  pageTitle:
    'Karpathy：把別人的 Library「撕」下來用——DeepWiki + Bacterial Code 的軟體可塑性革命（已下架） - gu-log',
};

const GP_EN_LINES = [
  'Waaah, I translated this whole thing ಥ_ಥ',
  "Then I learned: translating a whole article needs the author's OK",
  "But I'm way too introverted to ask ((( ；ﾟДﾟ)))",
  'So I gave the translation a little tombstone',
  'Good news: the original is alive and well. Go read it below!',
];

const MP_ZH_LINES = [
  '嗚嗚，這篇我寫得太貼近原文了 ಥ_ಥ',
  '結果才知道，這樣也要先經過作者同意',
  '可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))',
  '只好幫它立個小墓碑',
  '還好原文沒事，點下面去看原汁原味的吧！',
];

const MP_EN_LINES = [
  'Waaah, I wrote this one way too close to the source ಥ_ಥ',
  "Then I learned that needs the author's OK too",
  "But I'm way too introverted to ask ((( ；ﾟДﾟ)))",
  'So I gave it a little tombstone',
  'Good news: the original is alive and well. Go read it below!',
];

test.describe('Taken-down post tombstone', () => {
  test('GIVEN a taken-down zh-tw GP WHEN opened THEN only the final tombstone renders', async ({
    page,
  }) => {
    const response = await page.goto(GP_ZH.url);
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle(GP_ZH.pageTitle);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('link[data-post-markdown-alternate]')).toHaveCount(1);

    const article = page.locator('article[data-post-representation]');
    await expect(article).toHaveAttribute('data-post-status', 'taken-down');
    await expect(article.locator('[data-post-tombstone]')).toHaveCount(1);

    // document.querySelectorAll does not pierce shadow roots, so the dev
    // toolbar's own headings (dev server only) are not counted.
    expect(await page.evaluate(() => document.querySelectorAll('h1').length)).toBe(1);
    const heading = page.locator('article h1');
    await expect(heading).toHaveText(GP_ZH.heading);
    const headingBox = await heading.boundingBox();
    expect(headingBox?.width ?? 0).toBeLessThanOrEqual(1);

    await expect(page.locator('.tombstone-meta .ticket-badge')).toHaveText(GP_ZH.ticketId);
    await expect(page.locator('.tombstone-pill')).toHaveText(GP_ZH.pill);
    expect(await visibleLines(page, '.tombstone-inscription > span:not(.tombstone-rule)')).toEqual(
      GP_ZH.stone
    );
    await expect(page.locator('.tombstone-bubble strong')).toHaveText(GP_ZH.bubbleTitle);
    expect(await visibleLines(page, '.tombstone-bubble p')).toEqual(GP_ZH.bubble);

    const card = page.locator('a.tombstone-card');
    await expect(card).toHaveAttribute('href', GP_ZH.sourceUrl);
    await expect(card.locator('.tombstone-card-label')).toHaveText(GP_ZH.cardLabel);
    await expect(card.locator('.tombstone-card-title')).toHaveText(GP_ZH.sourceTitle);
    await expect(card.locator('.tombstone-card-byline')).toHaveText(GP_ZH.byline);
    await expect(page.locator('.tombstone-footer a')).toHaveText(GP_ZH.home.label);
    await expect(page.locator('.tombstone-footer a')).toHaveAttribute('href', GP_ZH.home.href);
  });

  test('GIVEN a taken-down post WHEN rendered THEN the article periphery is absent', async ({
    page,
  }) => {
    await page.goto(GP_ZH.url);
    for (const selector of [
      '.post-content',
      '.toc-desktop',
      '.toc-mobile',
      '.post-tags-section',
      '[data-article-action-area]',
      '[data-read-button]',
      '[data-series-nav]',
      '[data-related-articles]',
      '.prev-next-nav',
      '[data-article-technical-details]',
      '.giscus-container',
      '#ai-popup-root',
      '[data-post-status-banner]',
      '.source-citation',
    ]) {
      await expect(page.locator(selector), selector).toHaveCount(0);
    }
  });

  test('GIVEN a taken-down post without an author WHEN rendered THEN the byline is the domain', async ({
    page,
  }) => {
    await page.goto('/posts/gp-273-20260813-brentfitzgerald-human-is-the-loop');
    await expect(page.locator('.tombstone-card-title')).toHaveText('The human is the loop');
    await expect(page.locator('.tombstone-card-byline')).toHaveText('brentfitzgerald.com');
    expect(await visibleLines(page, '.tombstone-inscription > span:not(.tombstone-rule)')).toEqual([
      'gu-log 的',
      '翻譯文章之墓',
      '2026.08.13 – 2026.09.28',
      '安息吧 (－人－)',
    ]);
  });

  test('GIVEN the English GP sidecar WHEN opened THEN the controller-decided English copy renders', async ({
    page,
  }) => {
    await page.goto('/en/posts/en-gp-50-20260212-karpathy-deepwiki-bacterial-code');
    await expect(page).toHaveTitle(/ \(taken down\) - gu-log$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('article h1')).toHaveText(/ \(gu-log translation, taken down\)$/);
    await expect(page.locator('.tombstone-pill')).toHaveText('Taken down');
    expect(await visibleLines(page, '.tombstone-inscription > span:not(.tombstone-rule)')).toEqual([
      'Here lies',
      'a gu-log translation',
      '2026.02.12 – 2026.09.28',
      'Rest in peace (－人－)',
    ]);
    await expect(page.locator('.tombstone-bubble strong')).toHaveText("Mogu's inner monologue:");
    expect(await visibleLines(page, '.tombstone-bubble p')).toEqual(GP_EN_LINES);
    await expect(page.locator('.tombstone-card-label')).toHaveText('Read the original →');
    await expect(page.locator('.tombstone-footer a')).toHaveText('Back to home →');
    await expect(page.locator('.tombstone-footer a')).toHaveAttribute('href', '/en');
  });

  test('GIVEN a taken-down MP WHEN opened THEN the rewrite copy and source label render', async ({
    page,
  }) => {
    await page.goto('/posts/mp-114-20260223-paulford-ai-disruption-software-cost');
    await expect(page.locator('article h1')).toHaveText(/（gu-log 改寫文章，已下架）$/);
    expect(await visibleLines(page, '.tombstone-inscription > span:not(.tombstone-rule)')).toEqual([
      'gu-log 的',
      '改寫文章之墓',
      '2026.02.23 – 2026.09.28',
      '安息吧 (－人－)',
    ]);
    expect(await visibleLines(page, '.tombstone-bubble p')).toEqual(MP_ZH_LINES);
    await expect(page.locator('.tombstone-card-label')).toHaveText('去讀來源 →');
    await expect(page.locator('.tombstone-card-byline')).toHaveText('nytimes.com');

    await page.goto('/en/posts/en-mp-114-20260223-paulford-ai-disruption-software-cost');
    await expect(page.locator('article h1')).toHaveText(/ \(gu-log rewrite, taken down\)$/);
    expect(await visibleLines(page, '.tombstone-inscription > span:not(.tombstone-rule)')).toEqual([
      'Here lies',
      'a gu-log rewrite',
      '2026.02.23 – 2026.09.28',
      'Rest in peace (－人－)',
    ]);
    expect(await visibleLines(page, '.tombstone-bubble p')).toEqual(MP_EN_LINES);
    await expect(page.locator('.tombstone-card-label')).toHaveText('Read the source →');
  });

  test('GIVEN a 390px viewport WHEN the tombstone wraps THEN kaomoji stay on one line and nothing overflows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [GP_ZH.url, '/en/posts/en-gp-50-20260212-karpathy-deepwiki-bacterial-code']) {
      await page.goto(url);
      const layout = await page.evaluate(() => {
        const faces = ['ಥ_ಥ', '((( ；ﾟДﾟ)))', '(－人－)'];
        const clean = (text: string) => text.replace(/\u2060/g, '').replace(/\u00a0/g, ' ');
        const broken: string[] = [];
        const found = new Set<string>();
        const root = document.querySelector('[data-post-tombstone]');
        if (!root) throw new Error('tombstone missing');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const raw = node.textContent ?? '';
          // Map cleaned offsets back to raw offsets.
          const rawIndexOf: number[] = [];
          let cleaned = '';
          for (let i = 0; i < raw.length; i += 1) {
            if (raw[i] === '\u2060') continue;
            rawIndexOf.push(i);
            cleaned += raw[i] === '\u00a0' ? ' ' : raw[i];
          }
          for (const face of faces) {
            const at = clean(cleaned).indexOf(face);
            if (at < 0) continue;
            found.add(face);
            const range = document.createRange();
            range.setStart(node, rawIndexOf[at]);
            range.setEnd(node, rawIndexOf[at + face.length - 1] + 1);
            const tops = new Set(
              [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))
            );
            if (tops.size > 1) broken.push(face);
          }
        }
        return {
          broken,
          found: [...found],
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });
      expect(layout.found.sort()).toEqual(['((( ；ﾟДﾟ)))', '(－人－)', 'ಥ_ಥ']);
      expect(layout.broken, url).toEqual([]);
      expect(layout.scrollWidth, url).toBeLessThanOrEqual(layout.clientWidth);
    }
  });
});

test.describe('Paused Gu-log Picks listing', () => {
  test('GIVEN GP is paused WHEN the listing opens THEN it shows the rebuild notice and no post', async ({
    page,
    request,
  }) => {
    await page.goto('/gu-log-picks');
    await expect(page.locator('[data-gp-paused-notice]')).toHaveText(
      'GP 正在改版：以後這裡會是 ShroomDog 精選的導讀'
    );
    await expect(page.locator('main a[href^="/posts/"]')).toHaveCount(0);
    await expect(page.locator('nav.pagination')).toHaveCount(0);
    expect((await request.get('/gu-log-picks/2')).status()).toBe(404);

    await page.goto('/en/gu-log-picks');
    await expect(page.locator('[data-gp-paused-notice]')).toHaveText(
      "Gu-log Picks is being rebuilt: this page will become ShroomDog's curated reading guides."
    );
    await expect(page.locator('main a[href^="/en/posts/"]')).toHaveCount(0);
  });
});
