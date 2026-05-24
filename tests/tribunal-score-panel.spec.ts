import { test, expect } from './fixtures';

const POST_WITH_TRIBUNAL = '/posts/sd-23-20260510-ai-dota-teammates';

test('tribunal v5 keeps clarity under vibe judge', async ({ page }) => {
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

  const vibeCard = page.locator('.judge-card').filter({ hasText: 'Vibe' });
  const freshEyesCard = page.locator('.judge-card').filter({ hasText: 'Fresh Eyes' });

  await expect(vibeCard).toContainText('Clarity');
  await expect(freshEyesCard).not.toContainText('Clarity');
});

test('tribunal score panel stays left-aligned in dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  const panel = page.locator('.ai-judge-panel');
  await expect(panel).toBeVisible();

  const styles = await page.evaluate(() => {
    const panel = document.querySelector('.ai-judge-panel');
    const header = panel?.querySelector('.judge-header');
    const card = panel?.querySelector('.judge-card');
    const dimList = panel?.querySelector('.dim-list');

    if (!panel || !header || !card || !dimList) {
      throw new Error('Tribunal score panel structure is incomplete');
    }

    return {
      panelTextAlign: getComputedStyle(panel).textAlign,
      headerFlexDirection: getComputedStyle(header).flexDirection,
      headerAlignItems: getComputedStyle(header).alignItems,
      cardTextAlign: getComputedStyle(card).textAlign,
      cardAlignItems: getComputedStyle(card).alignItems,
      dimListTextAlign: getComputedStyle(dimList).textAlign,
      dimListDisplay: getComputedStyle(dimList).display,
    };
  });

  expect(['left', 'start']).toContain(styles.panelTextAlign);
  expect(styles.headerFlexDirection).toBe('column');
  expect(styles.headerAlignItems).toBe('flex-start');
  expect(['left', 'start']).toContain(styles.cardTextAlign);
  expect(styles.cardAlignItems).toBe('flex-start');
  expect(['left', 'start']).toContain(styles.dimListTextAlign);
  expect(styles.dimListDisplay).toBe('grid');
});

test('tribunal fact-check accent stays wine-red in dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  const accent = page.locator('.judge-card .judge-color-factcheck').first();
  await expect(accent).toBeVisible();

  const [r, g, b] = await accent.evaluate((node) => {
    const match = getComputedStyle(node).color.match(/\d+/g);
    if (!match || match.length < 3) {
      throw new Error('Fact Check accent did not resolve to an rgb color');
    }

    return match.slice(0, 3).map(Number);
  });

  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThan(140);
  expect(r).toBeGreaterThan(g);
  expect(b).toBeGreaterThan(g);
});

test('tribunal score panel collapses to a single column on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

  const cards = page.locator('.judge-card');
  await expect(cards).toHaveCount(4);

  const positions = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, left: rect.left };
    }),
  );

  expect(positions[1].top).toBeGreaterThan(positions[0].top);
  expect(Math.abs(positions[1].left - positions[0].left)).toBeLessThan(2);
});
