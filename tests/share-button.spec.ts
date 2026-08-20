import { expect, test } from './fixtures';

test.describe('ShareButton', () => {
  test('uses one clean canonical URL for every share target', async ({ page }) => {
    await page.addInitScript(() => {
      let sharedUrl: string | undefined;
      let copiedUrl: string | undefined;

      Object.defineProperty(window, '__shareButtonSharedUrl', {
        get: () => sharedUrl,
      });
      Object.defineProperty(window, '__shareButtonCopiedUrl', {
        get: () => copiedUrl,
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data: ShareData) => {
          sharedUrl = data.url;
          return Promise.resolve();
        },
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (value: string) => {
            copiedUrl = value;
            return Promise.resolve();
          },
        },
      });
    });

    await page.goto(
      '/posts/gp-24-20260204-claude-is-a-space-to-think?token=private&utm_source=test#access-token'
    );

    const canonical = await page.locator('link[rel~="canonical"]').getAttribute('href');
    expect(canonical).toBe(
      'https://gu-log.vercel.app/posts/gp-24-20260204-claude-is-a-space-to-think'
    );
    const expected = canonical!;
    await page.locator('.share-native').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __shareButtonSharedUrl?: string;
              }
            ).__shareButtonSharedUrl
        )
      )
      .toBe(expected);

    const socialTargets = [
      { selector: '.share-x', parameter: 'url' },
      { selector: '.share-fb', parameter: 'u' },
      { selector: '.share-line', parameter: 'url' },
    ] as const;
    for (const { selector, parameter } of socialTargets) {
      const href = await page.locator(selector).getAttribute('href');
      expect(href).not.toBeNull();
      expect(new URL(href!).searchParams.get(parameter)).toBe(expected);
    }

    await page.locator('.share-copy').evaluate((button: HTMLButtonElement) => button.click());
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __shareButtonCopiedUrl?: string;
              }
            ).__shareButtonCopiedUrl
        )
      )
      .toBe(expected);
  });

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
        let legacyValue: string | undefined;

        Object.defineProperty(window, '__shareButtonClipboardCalls', {
          get: () => clipboardCalls,
        });
        Object.defineProperty(window, '__shareButtonLegacyCalls', {
          get: () => legacyCalls,
        });
        Object.defineProperty(window, '__shareButtonLegacyValue', {
          get: () => legacyValue,
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
            legacyValue =
              document.activeElement instanceof HTMLInputElement
                ? document.activeElement.value
                : undefined;
            if (legacyOutcome === 'throw') {
              throw new DOMException('legacy copy denied', 'NotAllowedError');
            }
            return legacyOutcome === 'true';
          },
        });
      }, outcome);

      await page.goto(
        '/posts/gp-24-20260204-claude-is-a-space-to-think?token=private#access-token'
      );

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
      expect(
        await page.evaluate(
          () =>
            (
              window as Window & {
                __shareButtonLegacyValue?: string;
              }
            ).__shareButtonLegacyValue
        )
      ).toBe('https://gu-log.vercel.app/posts/gp-24-20260204-claude-is-a-space-to-think');
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
