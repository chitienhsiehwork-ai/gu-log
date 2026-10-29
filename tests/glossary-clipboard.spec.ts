// 詞彙表的複製連結在剪貼簿被拒時不能謊報成功（從 component-smoke 拆出來）。
import { test, expect } from './fixtures';
import { attachConsoleErrorWatcher } from './helpers/console-errors';

test.describe('Glossary copy link — clipboard fallbacks', () => {
  for (const route of ['/glossary', '/en/glossary']) {
    test(`${route} does not claim copy success when Clipboard rejects`, async ({ page }) => {
      const errs = attachConsoleErrorWatcher(page);
      await page.addInitScript(() => {
        let writeCalls = 0;
        Object.defineProperty(window, '__clipboardWriteCalls', {
          get: () => writeCalls,
        });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () => {
              writeCalls += 1;
              return Promise.reject(new DOMException('clipboard denied', 'NotAllowedError'));
            },
          },
        });
      });

      await page.goto(route);

      await page.locator('#agent .entry-toggle').click();
      const copyButton = page.locator('#agent .entry-copy');
      await copyButton.click();
      await page.waitForTimeout(100);

      await expect(page).toHaveURL(/#.+$/);
      await expect(copyButton).not.toHaveClass(/copied/);
      expect(
        await page.evaluate(
          () => (window as Window & { __clipboardWriteCalls?: number }).__clipboardWriteCalls
        )
      ).toBe(1);
      expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
    });
  }

  test('glossary ignores stale Clipboard success after a newer rejection', async ({ page }) => {
    const errs = attachConsoleErrorWatcher(page);
    await page.addInitScript(() => {
      let writeCalls = 0;
      let resolveFirstWrite: (() => void) | undefined;
      const firstWrite = new Promise<void>((resolve) => {
        resolveFirstWrite = resolve;
      });

      Object.defineProperty(window, '__resolveFirstClipboardWrite', {
        value: () => resolveFirstWrite?.(),
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => {
            writeCalls += 1;
            return writeCalls === 1
              ? firstWrite
              : Promise.reject(new DOMException('clipboard denied', 'NotAllowedError'));
          },
        },
      });
    });

    await page.goto('/glossary');

    await page.locator('#agent .entry-toggle').click();
    const copyButton = page.locator('#agent .entry-copy');
    await copyButton.click();
    await copyButton.click();
    await page.waitForTimeout(100);
    await expect(copyButton).not.toHaveClass(/copied/);

    await page.evaluate(() => {
      (
        window as Window & {
          __resolveFirstClipboardWrite?: () => void;
        }
      ).__resolveFirstClipboardWrite?.();
    });
    await page.waitForTimeout(100);

    await expect(copyButton).not.toHaveClass(/copied/);
    expect(errs, `console errors: ${errs.join('\n')}`).toEqual([]);
  });
});
