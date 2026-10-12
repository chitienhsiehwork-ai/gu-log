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

interface GlossaryItem {
  term: string;
  category: string;
  related?: string[];
  enDefinition?: string;
  enMoguNote?: string;
}

const glossaryData: GlossaryItem[] = JSON.parse(
  readFileSync(new URL('../src/data/glossary.json', import.meta.url), 'utf8')
);

function postTitle(id: string): string {
  const source = readFileSync(new URL(`../src/content/posts/${id}.mdx`, import.meta.url), 'utf8');
  return matter(source).data.title;
}

// 目標詞條的上緣要在 sticky 控制列下緣之下，也還在畫面裡。
async function expectBelowToolbar(page: Page, selector: string) {
  const toolbar = await page.locator('#glossary-toolbar').boundingBox();
  const target = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(toolbar && target && viewport).toBeTruthy();
  expect(toolbar!.y).toBeLessThanOrEqual(0.5);
  expect(target!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height - 1);
  expect(target!.y).toBeLessThan(viewport!.height);
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

  test('related terms use the language separator without stray spaces', async ({ page }) => {
    const karpathy = glossaryData.find((entry) => entry.term === 'Andrej Karpathy')!;
    for (const [route, label, separator] of [
      ['/glossary', '相關：', '、'],
      ['/en/glossary', 'Related: ', ', '],
    ]) {
      await page.goto(`${route}#andrej-karpathy`);
      await expect(
        page.locator('#andrej-karpathy .term-meta', { hasText: label.trim() })
      ).toHaveText(`${label}${karpathy.related!.join(separator)}`);
    }
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
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expectBelowToolbar(page, '#elixir');

    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(elixir.locator('.mogu-note')).toBeHidden();
  });

  // 錨點規則的頁面端：名稱裡的標點不進錨點（Software 3.0 → #software-30）。
  test('an anchor made from a term with punctuation opens that entry', async ({ page }) => {
    await page.goto('/glossary#software-30');

    const entry = page.locator('#software-30');
    await expect(entry.locator('.term-name')).toHaveText('Software 3.0');
    await expect(entry.locator('.entry-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(entry.locator('.mogu-note')).toBeVisible();
  });

  test('following a related link expands the target below the sticky controls', async ({
    page,
  }) => {
    await page.goto('/glossary#andrej-karpathy');

    await page.locator('#andrej-karpathy').getByRole('link', { name: 'Vibe Coding' }).tap();

    const target = page.locator('#vibe-coding');
    await expect(page).toHaveURL(/#vibe-coding$/);
    await expect(target.locator('.entry-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(target.locator('.mogu-note')).toBeVisible();
    await expectBelowToolbar(page, '#vibe-coding');
    // 原本展開的詞條不會因為錨點換掉就收起來。
    await expect(page.locator('#andrej-karpathy .mogu-note')).toBeVisible();
  });

  test('a malformed URL anchor does not stop the page script', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    for (const url of ['/glossary#100%', '/glossary#%E5']) {
      await page.goto(url);
      await expect(page.locator('#agent button.entry-toggle')).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await expect(page.getByRole('button', { name: '複製「Agent」的連結' })).toBeVisible();
    }
    expect(errors).toEqual([]);
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

  test('the intro does not mention the copy button', async ({ page }) => {
    await page.goto('/glossary');

    await expect(page.locator('.glossary-intro')).toBeVisible();
    await expect(page.locator('.glossary-copy-hint')).toBeHidden();
  });

  test('an entry opened from the URL anchor is expanded below the sticky controls', async ({
    page,
  }) => {
    await page.goto('/glossary#elixir');

    await expect(page.locator('#elixir .mogu-note')).toBeVisible();
    await expectBelowToolbar(page, '#elixir');
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
  await expect(page.locator('.glossary-copy-hint')).toBeVisible();

  const copyButton = page.getByRole('button', { name: '複製「Agent」的連結' });
  await copyButton.tap();

  await expect(copyButton).toHaveClass(/copied/);
  await expect(page.getByRole('status')).toHaveText('已複製「Agent」的連結');
  expect(
    await page.evaluate(() => (window as Window & { __copiedText?: string }).__copiedText)
  ).toMatch(/\/glossary#agent$/);
});

test.describe('sticky controls and in-page filters', () => {
  test('a related entry hidden by the people filter switches the filter back to all', async ({
    page,
  }) => {
    await page.goto('/glossary');

    await page.getByRole('button', { name: '人物', exact: true }).tap();
    await expect(page.locator('#vibe-coding')).toBeHidden();
    await page.locator('#andrej-karpathy .entry-toggle').tap();
    await page.locator('#andrej-karpathy').getByRole('link', { name: 'Vibe Coding' }).tap();

    await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#vibe-coding .entry-toggle')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(page.locator('#vibe-coding .mogu-note')).toBeVisible();
    await expect(page).toHaveURL(/\/glossary#vibe-coding$/);
    await expectBelowToolbar(page, '#vibe-coding');
  });

  test('every category has a filter button that shows only its entries', async ({ page }) => {
    for (const [route, products, models] of [
      ['/glossary', '產品', '模型'],
      ['/en/glossary', 'Products', 'Models'],
    ]) {
      await page.goto(route);
      for (const [category, label] of [
        ['products', products],
        ['models', models],
      ]) {
        await page.getByRole('button', { name: label, exact: true }).tap();
        const visible = page.locator('.glossary-entry:visible');
        await expect(visible).toHaveCount(
          glossaryData.filter((entry) => entry.category === category).length
        );
        await expect(visible.locator('.term-cat')).toHaveText(
          (await visible.locator('.term-cat').allTextContents()).map(() => label)
        );
      }
    }
  });

  test('the English page opens an anchored people entry in English', async ({ page }) => {
    const karpathy = glossaryData.find((entry) => entry.term === 'Andrej Karpathy')!;
    await page.goto('/en/glossary#andrej-karpathy');

    const entry = page.locator('#andrej-karpathy');
    await expect(entry.locator('.term-def')).toHaveText(karpathy.enDefinition!);
    await expect(entry.locator('.mogu-note')).toContainText(karpathy.enMoguNote!);
    await expect(entry.locator('.term-cat')).toHaveText('People');
    await expectBelowToolbar(page, '#andrej-karpathy');
  });
});
