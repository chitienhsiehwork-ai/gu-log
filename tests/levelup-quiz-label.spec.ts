import { expect, test } from './fixtures';

test.describe('LevelUpQuiz answer labels', () => {
  test('highlights the correct option when its authored label contains CSS syntax', async ({
    page,
  }) => {
    await page.goto('/artifacts/levelup-components-fixture');

    const quiz = page.locator('.levelup-quiz').first();
    const options = quiz.locator('.quiz-option');
    const correctOption = options.nth(1);
    const authoredLabel = 'B"]';

    await quiz.evaluate((element, label) => {
      (element as HTMLElement).dataset.answer = label;
    }, authoredLabel);
    await correctOption.evaluate((element, label) => {
      (element as HTMLElement).dataset.label = label;
    }, authoredLabel);

    await options.first().click();

    await expect(correctOption).toHaveClass(/correct/);
    await expect(quiz.locator('.result-wrong')).toBeVisible();
  });
});
