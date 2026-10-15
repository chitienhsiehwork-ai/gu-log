import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

// openspec: owner-reader-feedback / human-finishability-signals
const readerRevisions = JSON.parse(
  readFileSync(new URL('../src/data/post-reader-revisions.json', import.meta.url), 'utf8')
) as Record<string, string>;

const ZH_POST = 'mp-25-20260204-cursor-vibe-coding-lies';
const EN_POST = 'en-mp-25-20260204-cursor-vibe-coding-lies';
const PAGES = [
  { id: ZH_POST, path: `/posts/${ZH_POST}` },
  { id: EN_POST, path: `/en/posts/${EN_POST}` },
] as const;

test.describe('reader revision on article controls', () => {
  for (const { id, path } of PAGES) {
    test(`read and share controls carry the manifest reader revision (${id})`, async ({ page }) => {
      const expected = readerRevisions[id];
      expect(expected).toMatch(/^[0-9a-f]{16}$/);

      await page.goto(path);

      await expect(page.locator('[data-read-button]')).toHaveAttribute(
        'data-reader-revision',
        expected
      );
      await expect(page.locator('.share-buttons')).toHaveAttribute(
        'data-reader-revision',
        expected
      );
    });
  }
});

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.fake-signature';

async function signIn(page: import('@playwright/test').Page) {
  await page.addInitScript((jwt) => localStorage.setItem('gu-log-jwt', jwt), FAKE_JWT);
}

async function storedEvents(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('gu-log-human-signals') || '{"events":[]}') as {
          events: Array<Record<string, unknown>>;
        }
      ).events
  );
}

test.describe('owner one-tap feedback', () => {
  test('stays hidden for anonymous visitors', async ({ page }) => {
    await page.goto(`/posts/${ZH_POST}`);
    await expect(page.locator('[data-owner-feedback]')).toBeHidden();
    await expect(page.locator('.owner-feedback-option')).toHaveCount(3);
  });

  test('signed-in reader records rewrite_needed with version snapshot and note', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/posts/${ZH_POST}`);

    const feedback = page.locator('[data-owner-feedback]');
    await expect(feedback).toBeVisible();
    await expect(feedback.locator('.owner-feedback-option')).toHaveText([
      '好看',
      '普通',
      '難看想重寫',
    ]);
    await expect(feedback.locator('.owner-feedback-note')).toHaveAttribute('maxlength', '280');

    await feedback.locator('.owner-feedback-note').fill('節奏太拖');
    await feedback.getByRole('button', { name: '難看想重寫' }).click();

    await expect(feedback.locator('.owner-feedback-status')).toHaveText('已記錄：難看想重寫');
    await expect(feedback.getByRole('button', { name: '難看想重寫' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const feedbackEvents = (await storedEvents(page)).filter(
      (event) => event.kind === 'feedback_comment'
    );
    expect(feedbackEvents).toHaveLength(1);
    expect(feedbackEvents[0]).toMatchObject({
      kind: 'feedback_comment',
      source: 'first_party',
      polarity: 'rewrite_needed',
      commentText: '節奏太拖',
      postId: `${ZH_POST}.mdx`,
      lang: 'zh-tw',
      pathname: expect.stringMatching(new RegExp(`^/posts/${ZH_POST}/?$`)),
      postVersion: expect.any(Number),
      readerRevision: readerRevisions[ZH_POST],
    });

    // Changing one's mind appends a new event instead of rewriting the old one.
    await feedback.getByRole('button', { name: '好看' }).click();
    const polarities = (await storedEvents(page))
      .filter((event) => event.kind === 'feedback_comment')
      .map((event) => event.polarity);
    expect(polarities).toEqual(['rewrite_needed', 'positive']);
  });

  test('English article shows English labels and records 普通 as unknown polarity', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/en/posts/${EN_POST}`);

    const feedback = page.locator('[data-owner-feedback]');
    await expect(feedback.locator('.owner-feedback-option')).toHaveText([
      'Loved it',
      "It's OK",
      'Needs a rewrite',
    ]);
    await feedback.getByRole('button', { name: "It's OK" }).click();
    await expect(feedback.locator('.owner-feedback-status')).toHaveText("Recorded: It's OK");
    const [event] = (await storedEvents(page)).filter(
      (stored) => stored.kind === 'feedback_comment'
    );
    expect(event).toMatchObject({
      source: 'first_party',
      polarity: 'unknown',
      lang: 'en',
      readerRevision: readerRevisions[EN_POST],
    });
    expect(event).not.toHaveProperty('commentText');
  });
});
