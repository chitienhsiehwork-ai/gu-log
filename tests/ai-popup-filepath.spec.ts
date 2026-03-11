import { test, expect } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Tests for AiPopup filePath correctness.
 *
 * Bug context: Astro Content Collections `post.id` already includes the `.mdx`
 * extension (e.g. "clawd-picks-151.mdx"). The page template was appending
 * `.mdx` again, producing paths like "src/content/posts/clawd-picks-151.mdx.mdx"
 * → 404 on the API side.
 *
 * These tests ensure the double-extension bug never recurs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, '../src/pages');

// ---------------------------------------------------------------------------
// Static source-code checks (no browser needed)
// ---------------------------------------------------------------------------

test.describe('AiPopup filePath — Static Analysis', () => {
  /**
   * Scan all .astro files that use <AiPopup> and verify
   * the filePath prop never appends a literal ".mdx" to post.id
   * (because post.id already ends with .mdx in Astro Content Collections).
   */
  test('GIVEN page templates using AiPopup WHEN checking filePath prop THEN should NOT append .mdx to post.id (double extension bug)', () => {
    const astroFiles = findAstroFilesRecursively(PAGES_DIR);

    const violations: { file: string; line: number; text: string }[] = [];

    // Pattern: `${post.id}.mdx` or ${entry.id}.mdx — appending .mdx to an id
    // that already contains the extension.
    const doubleExtensionRe = /\$\{[^}]*\.id\}\.mdx/;

    for (const filePath of astroFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (doubleExtensionRe.test(lines[i])) {
          violations.push({
            file: path.relative(PAGES_DIR, filePath),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} → ${v.text}`)
        .join('\n');
      expect(
        violations,
        `Double .mdx extension detected in AiPopup filePath prop!\n` +
          `post.id already includes ".mdx" — do not append it again.\n${report}`,
      ).toHaveLength(0);
    }
  });

  test('GIVEN page templates using AiPopup WHEN checking filePath prop THEN filePath should end with exactly one .mdx', () => {
    const astroFiles = findAstroFilesRecursively(PAGES_DIR);

    const violations: { file: string; line: number; text: string }[] = [];

    // Catch any filePath="..." or filePath={...} that ends with .mdx.mdx
    const doubleExtLiteral = /filePath=.*\.mdx\.mdx/;

    for (const filePath of astroFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (doubleExtLiteral.test(lines[i])) {
          violations.push({
            file: path.relative(PAGES_DIR, filePath),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} → ${v.text}`)
        .join('\n');
      expect(violations, `Literal .mdx.mdx found in filePath:\n${report}`).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// E2E: verify the actual filePath sent to the API
// ---------------------------------------------------------------------------

test.describe('AiPopup filePath — E2E Request Validation', () => {
  test.beforeEach(async () => {
    // Desktop only — text selection doesn't work reliably on mobile viewports
    const isDesktop = test.info().project.name === 'Desktop Chrome';
    if (!isDesktop) test.skip();
  });

  const TEST_POST = '/posts/claude-is-a-space-to-think';

  async function setupLoggedIn(page: import('@playwright/test').Page) {
    await page.goto(TEST_POST);
    await page.evaluate(() => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(
        JSON.stringify({ email: 'test@example.com', exp: 9999999999 }),
      );
      const token = header + '.' + payload + '.fake-signature';
      localStorage.setItem('gu-log-jwt', token);
    });
    await page.reload();
  }

  async function selectAndShowPopup(page: import('@playwright/test').Page) {
    const content = page.locator('.post-content p').first();
    await expect(content).toBeVisible();
    const box = await content.boundingBox();
    if (!box) throw new Error('No bounding box');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.up();

    const popup = page.locator('#ai-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    return popup;
  }

  test('GIVEN a post page WHEN Edit with AI sends request THEN filePath must NOT contain .mdx.mdx', async ({
    page,
  }) => {
    await setupLoggedIn(page);

    let capturedFilePath = '';
    await page.route('**/ai/edit', async (route) => {
      const body = route.request().postDataJSON();
      capturedFilePath = body.filePath || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: '--- a/test.mdx\n+++ b/test.mdx\n- old\n+ new',
          editId: 'filepath-test',
        }),
      });
    });

    const popup = await selectAndShowPopup(page);
    await popup.locator('[data-action="edit"]').click();

    const input = popup.locator('.ai-popup-edit-input');
    await expect(input).toBeVisible();
    await input.fill('fix typo');
    await popup.locator('[data-action="submit-edit"]').click();

    // Wait for the request to complete
    await expect(popup.locator('.ai-popup-diff')).toBeVisible({ timeout: 10000 });

    // THE ACTUAL ASSERTION: no double .mdx
    expect(capturedFilePath).toBeTruthy();
    expect(capturedFilePath).toMatch(/\.mdx$/);
    expect(capturedFilePath).not.toMatch(/\.mdx\.mdx/);
    // Should look like: src/content/posts/claude-is-a-space-to-think.mdx
    expect(capturedFilePath).toMatch(/^src\/content\/posts\/[a-z0-9-]+\.mdx$/);
  });

  test('GIVEN a post page WHEN AiPopup renders THEN data-file-path attribute should have exactly one .mdx extension', async ({
    page,
  }) => {
    await page.goto(TEST_POST);

    const root = page.locator('#ai-popup-root');
    const filePath = await root.getAttribute('data-file-path');

    expect(filePath).toBeTruthy();
    expect(filePath).toMatch(/\.mdx$/);
    expect(filePath).not.toMatch(/\.mdx\.mdx/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findAstroFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAstroFilesRecursively(fullPath));
    } else if (entry.name.endsWith('.astro')) {
      results.push(fullPath);
    }
  }

  return results;
}
