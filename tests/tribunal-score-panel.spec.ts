import { test, expect } from './fixtures';

const POST_WITH_TRIBUNAL = '/posts/sd-23-20260510-ai-dota-teammates';

test('tribunal score panel renders judges in balanced visual order', async ({ page }) => {
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

  const judges = page.locator('.ai-judge-panel .judge-card .judge-name');
  await expect(judges).toHaveText(['Librarian', 'Fresh Eyes', 'Fact Check', 'Vibe']);
});

test('tribunal score panel stays two-up on iPhone 15 width', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

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

test('tribunal score panel collapses only on extra narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 852 });
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

  const cardTops = await page
    .locator('.ai-judge-panel .judge-card')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));

  expect(cardTops[1]).toBeGreaterThan(cardTops[0] + 20);
});
