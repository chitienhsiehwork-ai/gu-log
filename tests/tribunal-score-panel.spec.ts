import { test, expect } from './fixtures';

const POST_WITH_TRIBUNAL = '/posts/sd-23-20260510-ai-dota-teammates';

test('tribunal score panel renders judges in balanced visual order', async ({ page }) => {
  await page.goto(POST_WITH_TRIBUNAL, { waitUntil: 'domcontentloaded' });

  const judges = page.locator('.ai-judge-panel .judge-card .judge-name');
  await expect(judges).toHaveText(['Librarian', 'Fresh Eyes', 'Fact Check', 'Vibe']);
});
