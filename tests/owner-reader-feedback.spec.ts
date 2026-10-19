import { readFileSync } from 'node:fs';
import { parseHumanSignalExport } from '../src/lib/reader-signal-calibration';
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

const FAKE_JWT = 'owner-session-token';

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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type SyncRoute = { posted: Array<{ authorization?: string; eventIds: string[] }> };

async function mockHumanSignals(
  page: import('@playwright/test').Page,
  respond: (eventIds: string[]) => { status: number; body: unknown }
): Promise<SyncRoute> {
  const state: SyncRoute = { posted: [] };
  await page.route('**/human-signals', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const eventIds = (request.postDataJSON() as { events: Array<{ eventId: string }> }).events.map(
      (event) => event.eventId
    );
    state.posted.push({ authorization: request.headers()['authorization'], eventIds });
    const { status, body } = respond(eventIds);
    await route.fulfill({
      status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  });
  return state;
}

test.describe('human-signal sync channel', () => {
  test('signed-in reader sends recorded feedback and marks accepted events synced', async ({
    page,
  }) => {
    await signIn(page);
    const sync = await mockHumanSignals(page, (eventIds) => ({
      status: 200,
      body: { accepted: eventIds, rejected: [] },
    }));
    await page.goto(`/posts/${ZH_POST}`);

    await page.locator('[data-owner-feedback]').getByRole('button', { name: '好看' }).click();

    await expect.poll(() => sync.posted.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(sync.posted[0].authorization).toBe(`Bearer ${FAKE_JWT}`);
    await expect
      .poll(async () =>
        (await storedEvents(page))
          .filter((event) => event.kind === 'feedback_comment')
          .map((event) => [event.syncStatus, event.transport])
      )
      .toEqual([['synced', 'gu_log_api']]);
  });

  test('signed-out visitor never contacts the endpoint', async ({ page }) => {
    const sync = await mockHumanSignals(page, () => ({ status: 200, body: {} }));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
    });
    await page.goto(`/posts/${ZH_POST}`);

    // Anonymous share still records a local event; it must stay local.
    await page.locator('.share-copy').click();
    await expect.poll(async () => (await storedEvents(page)).length).toBe(1);
    await page.waitForTimeout(3_000);
    expect(sync.posted).toEqual([]);
  });

  test('a 404 from the undeployed endpoint keeps events local without page errors', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const dialogs: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await signIn(page);
    const sync = await mockHumanSignals(page, () => ({
      status: 404,
      body: { detail: 'Not Found' },
    }));
    await page.goto(`/posts/${ZH_POST}`);

    const feedback = page.locator('[data-owner-feedback]');
    await feedback.getByRole('button', { name: '難看想重寫' }).click();
    await expect.poll(() => sync.posted.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await expect(feedback.locator('.owner-feedback-status')).toHaveText('已記錄：難看想重寫');
    await page.locator('.read-status-btn').click();
    await expect(page.locator('.read-status-btn')).toHaveClass(/is-read/);
    expect(
      (await storedEvents(page))
        .filter((event) => event.kind === 'feedback_comment')
        .map((event) => event.syncStatus)
    ).toEqual(['local_only']);
    expect(pageErrors).toEqual([]);
    expect(dialogs).toEqual([]);
  });
});

test.describe('reading tracker export', () => {
  test('downloads local human-signal events in the calibration export format', async ({ page }) => {
    await signIn(page);
    await page.addInitScript(() => {
      if (localStorage.getItem('gu-log-human-signals')) return;
      localStorage.setItem(
        'gu-log-human-signals',
        JSON.stringify({
          version: 1,
          lastUpdated: '2026-10-01T00:00:00.000Z',
          events: [
            {
              eventSchemaVersion: 1,
              eventId: 'hs_feedback_comment_seed',
              kind: 'feedback_comment',
              postId: 'mp-25-20260204-cursor-vibe-coding-lies.mdx',
              lang: 'zh-tw',
              pathname: '/posts/mp-25-20260204-cursor-vibe-coding-lies',
              postVersion: 3,
              readerRevision: '12407a7105ee5292',
              occurredAt: '2026-10-01T00:00:00.000Z',
              readerTrustTier: 'unknown',
              transport: 'local_storage',
              syncStatus: 'local_only',
              source: 'first_party',
              polarity: 'rewrite_needed',
            },
          ],
        })
      );
    });
    await page.goto('/reading-tracker');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '匯出閱讀紀錄' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^gu-log-human-signals-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;

    expect(Object.keys(file).sort()).toEqual(['events', 'exportSchemaVersion', 'exportedAt']);
    expect(file.exportSchemaVersion).toBe(1);
    expect(Number.isNaN(Date.parse(String(file.exportedAt)))).toBe(false);
    // The calibration report must be able to read the file as-is.
    expect(parseHumanSignalExport(file).events).toHaveLength(1);
    expect(file.events).toEqual([
      expect.objectContaining({
        eventId: 'hs_feedback_comment_seed',
        kind: 'feedback_comment',
        readerRevision: '12407a7105ee5292',
      }),
    ]);
  });
});
