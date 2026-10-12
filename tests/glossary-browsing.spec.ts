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

test.describe('compact entries expand in place', () => {
  test('entries start compact without MoguNote', async ({ page }) => {
    await page.goto('/glossary');

    const agent = page.locator('#agent');
    await expect(agent.locator('.term-name')).toHaveText('Agent');
    await expect(agent.locator('.term-cat')).toHaveText('概念');
    await expect(agent.locator('.term-def')).toBeVisible();
    await expect(agent.locator('.mogu-note')).toBeHidden();
    await expect(page.locator('.glossary-entry .mogu-note:visible')).toHaveCount(0);
  });

  test('tap expands an entry in place and tapping again collapses it', async ({ page }) => {
    await page.goto('/glossary');

    const agent = page.locator('#agent');
    const toggle = agent.getByRole('button', { name: /^Agent/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(agent.locator('.mogu-note')).toBeVisible();
    await expect(agent.getByRole('link', { name: 'Subagent' })).toBeVisible();
    await expect(page).toHaveURL(/\/glossary$/);

    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(agent.locator('.mogu-note')).toBeHidden();
  });

  test('keyboard toggles an entry', async ({ page }) => {
    await page.goto('/glossary');

    const toggle = page.locator('#elixir .entry-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#elixir .mogu-note')).toBeVisible();

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#elixir .mogu-note')).toBeHidden();
  });

  test('an entry opened from the URL anchor is expanded, visible and can be collapsed', async ({
    page,
  }) => {
    await page.goto('/glossary#elixir');

    const elixir = page.locator('#elixir');
    const toggle = elixir.locator('.entry-toggle');
    await expect(elixir.locator('.mogu-note')).toBeVisible();
    await expect(elixir.locator('.term-name')).toBeInViewport();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(elixir.locator('.mogu-note')).toBeHidden();
  });

  test('following a related link expands the target and scrolls it into view', async ({ page }) => {
    await page.goto('/glossary#andrej-karpathy');

    await page.locator('#andrej-karpathy').getByRole('link', { name: 'Vibe Coding' }).tap();

    const target = page.locator('#vibe-coding');
    await expect(page).toHaveURL(/#vibe-coding$/);
    await expect(target.locator('.entry-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(target.locator('.mogu-note')).toBeVisible();
    await expect(target.locator('.term-name')).toBeInViewport();
    // 原本展開的詞條不會因為錨點換掉就收起來。
    await expect(page.locator('#andrej-karpathy .mogu-note')).toBeVisible();
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('entries still expand through their own anchor link', async ({ page }) => {
    await page.goto('/glossary');

    const agent = page.locator('#agent');
    await expect(agent.locator('.mogu-note')).toBeHidden();

    await agent.getByRole('link', { name: /^Agent/ }).click();
    await expect(page).toHaveURL(/\/glossary#agent$/);
    await expect(agent.locator('.mogu-note')).toBeVisible();
  });

  test('an entry opened from the URL anchor is expanded', async ({ page }) => {
    await page.goto('/glossary#elixir');

    await expect(page.locator('#elixir .mogu-note')).toBeVisible();
    await expect(page.locator('#elixir .term-name')).toBeInViewport();
  });
});

test('the copy button copies the entry link and says so', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as Window & { __copiedText?: string }).__copiedText = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('/glossary');

  const copyButton = page.getByRole('button', { name: '複製「Agent」的連結' });
  await copyButton.tap();

  await expect(copyButton).toHaveClass(/copied/);
  await expect(page.getByRole('status')).toHaveText('已複製「Agent」的連結');
  expect(
    await page.evaluate(() => (window as Window & { __copiedText?: string }).__copiedText)
  ).toMatch(/\/glossary#agent$/);
});
