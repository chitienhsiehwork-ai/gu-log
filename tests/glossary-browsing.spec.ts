import { readFileSync } from 'node:fs';
import { devices, type Page } from '@playwright/test';
import matter from 'gray-matter';
import { test, expect } from './fixtures';

// openspec: glossary-browsing。e2e-core 只跑 Desktop Chrome，這份 spec 自己換成 iPhone 13
// 的畫面；devices['iPhone 13'] 帶的 defaultBrowserType 是 webkit，所以只取下面這幾個欄位。
const iPhone13 = devices['iPhone 13'];
test.use({
  viewport: iPhone13.viewport,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: iPhone13.isMobile,
  hasTouch: iPhone13.hasTouch,
  userAgent: iPhone13.userAgent,
});

function postTitle(id: string): string {
  const source = readFileSync(new URL(`../src/content/posts/${id}.mdx`, import.meta.url), 'utf8');
  return matter(source).data.title;
}

async function entrySummaries(page: Page) {
  return page
    .locator('.glossary-entry')
    .evaluateAll((entries: HTMLElement[]) =>
      entries.map((entry) => ({ id: entry.id, category: entry.dataset.category }))
    );
}

test.describe('glossary pages share one structure', () => {
  test('both languages list the same entries in the same order and categories', async ({
    page,
  }) => {
    await page.goto('/glossary');
    const zh = await entrySummaries(page);
    await page.goto('/en/glossary');
    const en = await entrySummaries(page);

    expect(zh.length).toBeGreaterThan(0);
    expect(en).toEqual(zh);
  });

  test('a people entry stays on the glossary page', async ({ page }) => {
    await page.goto('/glossary#andrej-karpathy');

    await expect(page).toHaveURL(/\/glossary#andrej-karpathy$/);
    await expect(page.locator('#andrej-karpathy')).toBeVisible();
  });

  test('English post links point to the English post and show its English title', async ({
    page,
  }) => {
    const id = 'en-lv-18-20261011-livingdevops-kubernetes';
    await page.goto('/en/glossary#kubernetes');

    const postLink = page.locator('#kubernetes a[href^="/en/posts/"]');
    await expect(postLink).toHaveAttribute('href', `/en/posts/${id}`);
    await expect(postLink).toHaveText(postTitle(id));
  });
});
