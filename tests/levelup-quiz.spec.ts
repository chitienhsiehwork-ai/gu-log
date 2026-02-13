import { test, expect } from './fixtures';

/**
 * BDD Tests for LevelUpQuiz Component
 *
 * Since no Level-Up articles exist yet, we create a test page dynamically
 * using Astro's dev server. We'll test by navigating to a post that we
 * create as a test fixture.
 *
 * Alternative: test the rendered HTML directly via a dedicated test route.
 * For now, we use a temporary .mdx test post.
 */

// Path to a temporary test post (created in beforeAll, cleaned in afterAll)
const TEST_SLUG = '_test-levelup-quiz-fixture';
const TEST_POST_PATH = `src/content/posts/${TEST_SLUG}.mdx`;
const TEST_URL = `/posts/${TEST_SLUG}`;

import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const testPostFullPath = path.join(projectRoot, TEST_POST_PATH);

const TEST_MDX = `---
ticketId: 'Lv-99'
title: 'Test LevelUpQuiz Fixture'
originalDate: '2026-01-01'
source: 'Test'
sourceUrl: 'https://example.com'
summary: 'Test fixture for LevelUpQuiz component'
lang: 'zh-tw'
tags: ['test']
---

import LevelUpQuiz from '../../components/LevelUpQuiz.astro';
import LevelUpProgress from '../../components/LevelUpProgress.astro';
import ClawdNote from '../../components/ClawdNote.astro';
import AnalogyBox from '../../components/AnalogyBox.astro';

<LevelUpProgress current={2} total={5} title="測試教學" />
<LevelUpProgress current={1} total={5} />

這是一段測試文字，用來確保最低內容長度通過驗證。這段文字需要至少兩百個字元才能通過 validate-posts 的檢查，所以我們在這裡多寫一點內容。Level-Up 教學系統的測試頁面，用來驗證所有新元件是否正常運作。

<LevelUpQuiz
  question="下列哪個是正確答案？"
  options={[
    { label: "A", text: "錯誤選項一" },
    { label: "B", text: "正確選項" },
    { label: "C", text: "錯誤選項二" },
  ]}
  answer="B"
  explanation="B 是正確答案，因為這是測試。"
/>

<ClawdNote variant="murmur">
這是碎碎念風格的測試。
</ClawdNote>

<ClawdNote>
這是一般 note 風格的測試。
</ClawdNote>

<AnalogyBox title="🧪 測試類比">
這就像是在測試一台新車上路前，先在工廠裡跑幾圈。
</AnalogyBox>
`;

test.describe('LevelUpQuiz Component', () => {
  test.beforeAll(async () => {
    fs.writeFileSync(testPostFullPath, TEST_MDX, 'utf-8');
    // Wait for Astro dev server to pick up the new file
    await new Promise((r) => setTimeout(r, 5000));
  });

  test.afterAll(async () => {
    if (fs.existsSync(testPostFullPath)) {
      fs.unlinkSync(testPostFullPath);
    }
  });

  test('GIVEN a quiz WHEN page loads THEN quiz is visible with all options', async ({ page }) => {
    const response = await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    const quiz = page.locator('.levelup-quiz').first();
    await expect(quiz).toBeVisible();

    // Should show the question
    await expect(quiz.locator('.quiz-question')).toContainText('下列哪個是正確答案？');

    // Should show 3 options
    const options = quiz.locator('.quiz-option');
    await expect(options).toHaveCount(3);

    // Result should be hidden
    await expect(quiz.locator('.result-correct')).toBeHidden();
    await expect(quiz.locator('.result-wrong')).toBeHidden();
  });

  test('GIVEN a quiz WHEN user selects correct answer THEN shows green + explanation', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // Wait for hydration

    const quiz = page.locator('.levelup-quiz').first();
    const correctBtn = quiz.locator('.quiz-option[data-label="B"]');

    await correctBtn.click();

    // Correct button should have .correct class
    await expect(correctBtn).toHaveClass(/correct/);

    // Should show correct result
    await expect(quiz.locator('.result-correct')).toBeVisible();
    await expect(quiz.locator('.result-correct')).toContainText('正確！');
    await expect(quiz.locator('.result-correct .result-explanation')).toContainText('B 是正確答案');

    // Wrong result should stay hidden
    await expect(quiz.locator('.result-wrong')).toBeHidden();

    // All buttons should be disabled
    for (const btn of await quiz.locator('.quiz-option').all()) {
      await expect(btn).toBeDisabled();
    }
  });

  test('GIVEN a quiz WHEN user selects wrong answer THEN shows red + correct answer', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    const quiz = page.locator('.levelup-quiz').first();
    const wrongBtn = quiz.locator('.quiz-option[data-label="A"]');
    const correctBtn = quiz.locator('.quiz-option[data-label="B"]');

    await wrongBtn.click();

    // Wrong button should have .wrong class
    await expect(wrongBtn).toHaveClass(/wrong/);

    // Correct button should be highlighted too
    await expect(correctBtn).toHaveClass(/correct/);

    // Should show wrong result
    await expect(quiz.locator('.result-wrong')).toBeVisible();
    await expect(quiz.locator('.result-wrong')).toContainText('不對喔！');
    await expect(quiz.locator('.result-wrong')).toContainText('正確答案是');

    // Correct result should stay hidden
    await expect(quiz.locator('.result-correct')).toBeHidden();
  });

  test('GIVEN a quiz already answered WHEN user clicks another option THEN nothing changes', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    const quiz = page.locator('.levelup-quiz').first();

    // Answer first
    await quiz.locator('.quiz-option[data-label="B"]').click();
    await expect(quiz.locator('.result-correct')).toBeVisible();

    // All buttons should be disabled — clicking should do nothing
    const btnC = quiz.locator('.quiz-option[data-label="C"]');
    await expect(btnC).toBeDisabled();
  });
});

test.describe('ClawdNote murmur variant', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(testPostFullPath)) {
      fs.writeFileSync(testPostFullPath, TEST_MDX, 'utf-8');
      await new Promise((r) => setTimeout(r, 2000));
    }
  });

  test.afterAll(async () => {
    if (fs.existsSync(testPostFullPath)) {
      fs.unlinkSync(testPostFullPath);
    }
  });

  test('GIVEN murmur variant WHEN rendered THEN has murmur styling class', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    // Find the murmur note (first .claude-note--murmur)
    const murmur = page.locator('.claude-note--murmur').first();
    await expect(murmur).toBeVisible();
    await expect(murmur).toContainText('碎碎念');
  });

  test('GIVEN note variant WHEN rendered THEN does NOT have murmur class', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    // The regular note should not have murmur class
    const notes = page.locator('.claude-note:not(.claude-note--murmur)');
    await expect(notes.first()).toBeVisible();
  });
});

test.describe('LevelUpProgress Component', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(testPostFullPath)) {
      fs.writeFileSync(testPostFullPath, TEST_MDX, 'utf-8');
      await new Promise((r) => setTimeout(r, 2000));
    }
  });

  test.afterAll(async () => {
    if (fs.existsSync(testPostFullPath)) {
      fs.unlinkSync(testPostFullPath);
    }
  });

  test('GIVEN progress component WHEN rendered THEN shows level and progress bar', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    const progress = page.locator('.levelup-progress').first();
    await expect(progress).toBeVisible();
    await expect(progress.locator('.progress-level')).toContainText('Level 2 / 5');
    await expect(progress.locator('.progress-title')).toContainText('測試教學');

    // Progress bar should exist
    await expect(progress.locator('.progress-bar-fill')).toBeVisible();
  });

  test('GIVEN progress component without title WHEN rendered THEN does not show title', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    // The second progress bar has no title
    const progress = page.locator('.levelup-progress').nth(1);
    await expect(progress).toBeVisible();
    await expect(progress.locator('.progress-level')).toContainText('Level 1 / 5');
    await expect(progress.locator('.progress-title')).not.toBeVisible();
  });
});

test.describe('AnalogyBox Component', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(testPostFullPath)) {
      fs.writeFileSync(testPostFullPath, TEST_MDX, 'utf-8');
      await new Promise((r) => setTimeout(r, 2000));
    }
  });

  test.afterAll(async () => {
    if (fs.existsSync(testPostFullPath)) {
      fs.unlinkSync(testPostFullPath);
    }
  });

  test('GIVEN analogy box WHEN rendered THEN shows title and content', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    const box = page.locator('.analogy-box').first();
    await expect(box).toBeVisible();
    await expect(box.locator('.analogy-title')).toContainText('測試類比');
    await expect(box.locator('.analogy-badge')).toContainText('類比');
    await expect(box.locator('.analogy-content')).toContainText('測試一台新車');
  });
});
