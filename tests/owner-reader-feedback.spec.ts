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
