import { test, expect } from './fixtures';

const POST_WITH_TRIBUNAL = '/posts/sd-23-20260510-ai-dota-teammates';

async function openTechnicalDetails(page: import('@playwright/test').Page) {
  const details = page.locator('[data-article-technical-details]');
  await expect(details).toBeVisible();
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('summary').click();
  }
}

test('article technical details stay collapsed until requested', async ({ page }) => {
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

  const details = page.locator('[data-article-technical-details]');
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.locator('summary')).toContainText('Tribunal');
  await expect(details.locator('summary')).toContainText('v');
  await expect(details.locator('.ai-judge-panel')).not.toBeVisible();
});

test('tribunal score panel renders judges in balanced visual order', async ({ page }) => {
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });
  await openTechnicalDetails(page);

  const judges = page.locator('.ai-judge-panel .judge-card .judge-name');
  await expect(judges).toHaveText(['Librarian', 'Fresh Eyes', 'Fact Check', 'Vibe']);
});

test('tribunal score panel stays two-up on iPhone 15 width', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });
  await openTechnicalDetails(page);

  const cards = page.locator('.ai-judge-panel .judge-card');
  await expect(cards).toHaveCount(4);

  const layout = await page.locator('.ai-judge-panel').evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const cardRects = Array.from(panel.querySelectorAll('.judge-card')).map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    });

    return {
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      scrollWidth: panel.scrollWidth,
      clientWidth: panel.clientWidth,
      cardRects,
    };
  });

  const [first, second, third] = layout.cardRects;

  expect(Math.abs(second.top - first.top)).toBeLessThan(2);
  expect(second.left).toBeGreaterThan(first.left + 20);
  expect(third.top).toBeGreaterThan(first.top + 20);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  for (const rect of layout.cardRects) {
    expect(rect.left).toBeGreaterThanOrEqual(layout.panelLeft - 1);
    expect(rect.right).toBeLessThanOrEqual(layout.panelRight + 1);
  }
});

test('tribunal score panel content aligns with the post info block', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto('/en/posts/en-sd-23-20260510-ai-dota-teammates', {
    waitUntil: 'domcontentloaded',
  });
  await openTechnicalDetails(page);

  const layout = await page.evaluate(() => {
    const infoLine = document.querySelector('.translation-info div:nth-of-type(2)');
    const judgeCards = document.querySelector('.ai-judge-panel .judge-cards');
    const judgeHeader = document.querySelector('.ai-judge-panel .judge-header');
    const judgeCard = document.querySelector('.ai-judge-panel .judge-card');
    const dimList = document.querySelector('.ai-judge-panel .dim-list');

    if (!infoLine || !judgeCards || !judgeHeader || !judgeCard || !dimList) {
      throw new Error('Expected post info and tribunal score panel to be present');
    }

    return {
      infoLeft: infoLine.getBoundingClientRect().left,
      cardsLeft: judgeCards.getBoundingClientRect().left,
      headerLeft: judgeHeader.getBoundingClientRect().left,
      headerFlexDirection: getComputedStyle(judgeHeader).flexDirection,
      headerAlignItems: getComputedStyle(judgeHeader).alignItems,
      cardTextAlign: getComputedStyle(judgeCard).textAlign,
      cardAlignItems: getComputedStyle(judgeCard).alignItems,
      dimListDisplay: getComputedStyle(dimList).display,
      dimListTextAlign: getComputedStyle(dimList).textAlign,
    };
  });

  expect(Math.abs(layout.cardsLeft - layout.infoLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.headerLeft - layout.infoLeft)).toBeLessThanOrEqual(1);
  expect(layout.headerFlexDirection).toBe('column');
  expect(layout.headerAlignItems).toBe('flex-start');
  expect(['left', 'start']).toContain(layout.cardTextAlign);
  expect(layout.cardAlignItems).toBe('flex-start');
  expect(layout.dimListDisplay).toBe('grid');
  expect(['left', 'start']).toContain(layout.dimListTextAlign);
});

test('tribunal fact-check accent uses wine-red instead of pass-green', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await openTechnicalDetails(page);

  const accent = page.locator('.ai-judge-panel .judge-color-factcheck').first();
  await expect(accent).toBeVisible();

  const [r, g, b] = await accent.evaluate((node) => {
    const match = getComputedStyle(node).color.match(/\d+/g);
    if (!match || match.length < 3) {
      throw new Error('Fact Check accent did not resolve to an RGB color');
    }

    return match.slice(0, 3).map(Number);
  });

  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThan(140);
  expect(r).toBeGreaterThan(g);
  expect(b).toBeGreaterThan(g);
});

test('tribunal score panel collapses only on extra narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 852 });
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });
  await openTechnicalDetails(page);

  const cardTops = await page
    .locator('.ai-judge-panel .judge-card')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));

  expect(cardTops[1]).toBeGreaterThan(cardTops[0] + 20);
});
