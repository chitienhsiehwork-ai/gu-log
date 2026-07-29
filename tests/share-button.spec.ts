import { expect, test } from './fixtures';

test.describe('ShareButton fallback', () => {
  test('resets copied feedback two seconds after the latest successful copy', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.resolve(),
        },
      });
    });
    await page.clock.install();

    await page.goto('/posts/gp-24-20260204-claude-is-a-space-to-think');

    const copyButton = page.locator('.share-copy');
    const copyText = copyButton.locator('.copy-text');
    await copyButton.click();
    await expect(copyText).toHaveText('已複製！');

    await page.clock.fastForward(1000);
    await copyButton.click();
    await expect(copyText).toHaveText('已複製！');

    await page.clock.fastForward(1001);
    await expect(copyText).toHaveText('已複製！');

    await page.clock.fastForward(999);
    await expect(copyText).toHaveText('複製連結');
  });

  const legacyCases = [
    {
      name: 'records failure when legacy copy throws',
      outcome: 'throw',
      expectedResult: 'failed',
    },
    {
      name: 'records failure when legacy copy returns false',
      outcome: 'false',
      expectedResult: 'failed',
    },
    {
      name: 'keeps legacy copy success conservative',
      outcome: 'true',
      expectedResult: 'attempted',
    },
  ] as const;

  for (const { name, outcome, expectedResult } of legacyCases) {
    test(name, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.addInitScript((legacyOutcome) => {
        let clipboardCalls = 0;
        let legacyCalls = 0;

        Object.defineProperty(window, '__shareButtonClipboardCalls', {
          get: () => clipboardCalls,
        });
        Object.defineProperty(window, '__shareButtonLegacyCalls', {
          get: () => legacyCalls,
        });
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: undefined,
        });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () => {
              clipboardCalls += 1;
              return Promise.reject(new DOMException('clipboard denied', 'NotAllowedError'));
            },
          },
        });
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: () => {
            legacyCalls += 1;
            if (legacyOutcome === 'throw') {
              throw new DOMException('legacy copy denied', 'NotAllowedError');
            }
            return legacyOutcome === 'true';
          },
        });
      }, outcome);

      await page.goto('/posts/gp-24-20260204-claude-is-a-space-to-think');

      const copyButton = page.locator('.share-copy');
      await expect(copyButton).toBeVisible();
      await copyButton.click();
      await page.waitForTimeout(100);

      expect(
        await page.evaluate(
          () =>
            (
              window as Window & {
                __shareButtonClipboardCalls?: number;
              }
            ).__shareButtonClipboardCalls
        )
      ).toBe(1);
      expect(
        await page.evaluate(
          () =>
            (
              window as Window & {
                __shareButtonLegacyCalls?: number;
              }
            ).__shareButtonLegacyCalls
        )
      ).toBe(1);
      await expect(copyButton.locator('.copy-text')).toHaveText('複製連結');
      await expect(page.locator('body > input')).toHaveCount(0);
      expect(pageErrors).toEqual([]);

      const latestSignal = await page.evaluate(() => {
        const raw = localStorage.getItem('gu-log-human-signals');
        if (!raw) return null;
        const store = JSON.parse(raw) as { events?: unknown[] };
        return store.events?.at(-1) ?? null;
      });
      expect(latestSignal).toMatchObject({
        kind: 'share_intent',
        target: 'copy_link',
        result: expectedResult,
        resultConfidence: expectedResult,
      });
    });
  }
});
