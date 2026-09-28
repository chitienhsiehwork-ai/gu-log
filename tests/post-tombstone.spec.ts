import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { getGpPausedNotice } from '../src/lib/gp-series-pause.mjs';
import {
  getSourceByline,
  getTombstoneCopy,
  getTombstoneHeading,
  getTombstonePageTitle,
  getTombstoneStoneLines,
} from '../src/lib/tombstone-copy.mjs';
import {
  postIdFromFilename,
  postPathFor,
  splitPostSource,
} from '../scripts/lib/taken-down-posts.mjs';

/**
 * Taken-down posts render only the tombstone (openspec: post-takedown). The
 * owner-approved copy is pinned word for word once, in tests/tombstone-copy.test.ts;
 * here each page must render exactly what src/lib/tombstone-copy.mjs gives for
 * that post's frontmatter, carry `noindex`, drop the article periphery and keep
 * the kaomoji unbroken.
 */

const POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/posts');
const WJ_OR_NBSP = /[\u2060\u00a0]/g;

async function visibleLines(page: Page, selector: string) {
  return (await page.locator(selector).allTextContents()).map((text) =>
    text.replace(WJ_OR_NBSP, (character) => (character === '\u00a0' ? ' ' : '')).trim()
  );
}

/** What the tombstone of one post file must show, from the copy module and its frontmatter. */
function tombstoneOf(file: string) {
  const source = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
  const { data } = splitPostSource(source, file);
  const lang: 'zh-tw' | 'en' = data.lang === 'en' ? 'en' : 'zh-tw';
  const { ticketId, title, translatedDate, takenDownAt, sourceTitle, sourceUrl, author } = data;
  return {
    url: postPathFor({ id: postIdFromFilename(file), lang }),
    ticketId,
    author,
    sourceTitle,
    sourceUrl,
    copy: getTombstoneCopy({ ticketId, lang }),
    stone: getTombstoneStoneLines({ ticketId, lang, translatedDate, takenDownAt }),
    heading: getTombstoneHeading({ ticketId, lang, title }),
    pageTitle: getTombstonePageTitle({ title, lang }),
    byline: getSourceByline({ author, sourceUrl }),
  };
}

type Tombstone = ReturnType<typeof tombstoneOf>;

const GP_ZH = tombstoneOf('gp-50-20260212-karpathy-deepwiki-bacterial-code.mdx');
const GP_EN = tombstoneOf('en-gp-50-20260212-karpathy-deepwiki-bacterial-code.mdx');
const MP_ZH = tombstoneOf('mp-114-20260223-paulford-ai-disruption-software-cost.mdx');
const MP_EN = tombstoneOf('en-mp-114-20260223-paulford-ai-disruption-software-cost.mdx');
const NO_AUTHOR = tombstoneOf('gp-273-20260813-brentfitzgerald-human-is-the-loop.mdx');

async function expectOnlyTombstone(page: Page, expected: Tombstone) {
  const response = await page.goto(expected.url);
  expect(response?.status(), expected.url).toBe(200);

  await expect(page).toHaveTitle(expected.pageTitle);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[data-post-markdown-alternate]')).toHaveCount(1);

  const article = page.locator('article[data-post-representation]');
  await expect(article).toHaveAttribute('data-post-status', 'taken-down');
  await expect(article.locator('[data-post-tombstone]')).toHaveCount(1);

  // document.querySelectorAll does not pierce shadow roots, so the dev
  // toolbar's own headings (dev server only) are not counted.
  expect(await page.evaluate(() => document.querySelectorAll('h1').length)).toBe(1);
  const heading = page.locator('article h1');
  await expect(heading).toHaveText(expected.heading);
  const headingBox = await heading.boundingBox();
  expect(headingBox?.width ?? 0).toBeLessThanOrEqual(1);

  await expect(page.locator('.tombstone-meta .ticket-badge')).toHaveText(expected.ticketId);
  await expect(page.locator('.tombstone-pill')).toHaveText(expected.copy.pill);
  expect(await visibleLines(page, '.tombstone-inscription > span:not(.tombstone-rule)')).toEqual(
    expected.stone
  );
  await expect(page.locator('.tombstone-bubble strong')).toHaveText(expected.copy.bubbleTitle);
  expect(await visibleLines(page, '.tombstone-bubble p')).toEqual([...expected.copy.bubbleLines]);

  const card = page.locator('a.tombstone-card');
  await expect(card).toHaveAttribute('href', expected.sourceUrl);
  await expect(card.locator('.tombstone-card-label')).toHaveText(expected.copy.cardLabel);
  await expect(card.locator('.tombstone-card-title')).toHaveText(expected.sourceTitle);
  await expect(card.locator('.tombstone-card-byline')).toHaveText(expected.byline);
  await expect(page.locator('.tombstone-footer a')).toHaveText(expected.copy.homeLabel);
  await expect(page.locator('.tombstone-footer a')).toHaveAttribute('href', expected.copy.homeHref);
}

test.describe('Taken-down post tombstone', () => {
  test('GIVEN taken-down GP and MP posts in both languages WHEN opened THEN only the tombstone renders', async ({
    page,
  }) => {
    for (const expected of [GP_ZH, GP_EN, MP_ZH, MP_EN]) {
      await expectOnlyTombstone(page, expected);
    }
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
    expect(NO_AUTHOR.author).toBeUndefined();
    await expectOnlyTombstone(page, NO_AUTHOR);
  });

  test('GIVEN a 390px viewport WHEN the tombstone wraps THEN kaomoji stay on one line and nothing overflows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [GP_ZH.url, GP_EN.url]) {
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
    await expect(page.locator('[data-gp-paused-notice]')).toHaveText(getGpPausedNotice('zh-tw'));
    await expect(page.locator('main a[href^="/posts/"]')).toHaveCount(0);
    await expect(page.locator('nav.pagination')).toHaveCount(0);
    expect((await request.get('/gu-log-picks/2')).status()).toBe(404);

    await page.goto('/en/gu-log-picks');
    await expect(page.locator('[data-gp-paused-notice]')).toHaveText(getGpPausedNotice('en'));
    await expect(page.locator('main a[href^="/en/posts/"]')).toHaveCount(0);
  });
});
