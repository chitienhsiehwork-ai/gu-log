import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * BDD Tests for Level-Up tutorial components.
 *
 * The deterministic Astro fixture avoids mutating the content collection while
 * Playwright projects run in parallel.
 */

const TEST_URL = '/artifacts/levelup-components-fixture';

async function openFixture(page: Page) {
  const response = await page.goto(TEST_URL, { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
}

test.describe('LevelUpQuiz Component', () => {
  test('GIVEN a quiz WHEN page loads THEN quiz is visible with all options', async ({ page }) => {
    await openFixture(page);

    const quiz = page.locator('.levelup-quiz').first();
    await expect(quiz).toBeVisible();
    await expect(quiz.locator('.quiz-question')).toContainText('下列哪個是正確答案？');
    await expect(quiz.locator('.quiz-option')).toHaveCount(3);
    await expect(quiz.locator('.result-correct')).toBeHidden();
    await expect(quiz.locator('.result-wrong')).toBeHidden();
  });

  test('GIVEN a quiz WHEN user selects correct answer THEN shows green + explanation', async ({
    page,
  }) => {
    await openFixture(page);

    const quiz = page.locator('.levelup-quiz').first();
    const correctBtn = quiz.locator('.quiz-option[data-label="B"]');

    await correctBtn.click();

    await expect(correctBtn).toHaveClass(/correct/);
    await expect(quiz.locator('.result-correct')).toBeVisible();
    await expect(quiz.locator('.result-correct')).toContainText('正確！');
    await expect(quiz.locator('.result-correct .result-explanation')).toContainText('B 是正確答案');
    await expect(quiz.locator('.result-wrong')).toBeHidden();

    for (const btn of await quiz.locator('.quiz-option').all()) {
      await expect(btn).toBeDisabled();
    }
  });

  test('GIVEN a quiz WHEN user selects wrong answer THEN shows red + correct answer', async ({
    page,
  }) => {
    await openFixture(page);

    const quiz = page.locator('.levelup-quiz').first();
    const wrongBtn = quiz.locator('.quiz-option[data-label="A"]');
    const correctBtn = quiz.locator('.quiz-option[data-label="B"]');

    await wrongBtn.click();

    await expect(wrongBtn).toHaveClass(/wrong/);
    await expect(correctBtn).toHaveClass(/correct/);
    await expect(quiz.locator('.result-wrong')).toBeVisible();
    await expect(quiz.locator('.result-wrong')).toContainText('不對喔！');
    await expect(quiz.locator('.result-wrong')).toContainText('正確答案是');
    await expect(quiz.locator('.result-correct')).toBeHidden();
  });

  test('GIVEN a quiz already answered WHEN user clicks another option THEN nothing changes', async ({
    page,
  }) => {
    await openFixture(page);

    const quiz = page.locator('.levelup-quiz').first();
    await quiz.locator('.quiz-option[data-label="B"]').click();
    await expect(quiz.locator('.result-correct')).toBeVisible();
    await expect(quiz.locator('.quiz-option[data-label="C"]')).toBeDisabled();
  });
});

test.describe('MoguNote murmur variant', () => {
  test('GIVEN murmur variant WHEN rendered THEN has murmur styling class', async ({ page }) => {
    await openFixture(page);

    const murmur = page.locator('.mogu-note--murmur').first();
    await expect(murmur).toBeVisible();
    await expect(murmur).toContainText('碎碎念');
  });

  test('GIVEN note variant WHEN rendered THEN does NOT have murmur class', async ({ page }) => {
    await openFixture(page);
    await expect(page.locator('.mogu-note:not(.mogu-note--murmur)').first()).toBeVisible();
  });
});

test.describe('LevelUpProgress Component', () => {
  test('GIVEN progress component WHEN rendered THEN shows level and progress bar', async ({
    page,
  }) => {
    await openFixture(page);

    const progress = page.locator('.levelup-progress').first();
    await expect(progress).toBeVisible();
    await expect(progress.locator('.progress-level')).toContainText('Level 2 / 5');
    await expect(progress.locator('.progress-title')).toContainText('測試教學');
    await expect(progress.locator('.progress-bar-fill')).toBeVisible();
  });

  test('GIVEN progress component without title WHEN rendered THEN does not show title', async ({
    page,
  }) => {
    await openFixture(page);

    const progress = page.locator('.levelup-progress').nth(1);
    await expect(progress).toBeVisible();
    await expect(progress.locator('.progress-level')).toContainText('Level 1 / 5');
    await expect(progress.locator('.progress-title')).not.toBeVisible();
  });
});

test.describe('AnalogyBox Component', () => {
  test('GIVEN analogy box WHEN rendered THEN shows title and content', async ({ page }) => {
    await openFixture(page);

    const box = page.locator('.analogy-box').first();
    await expect(box).toBeVisible();
    await expect(box.locator('.analogy-title')).toContainText('測試類比');
    await expect(box.locator('.analogy-badge')).toContainText('類比');
    await expect(box.locator('.analogy-content')).toContainText('測試一台新車');
  });
});
