import { test, expect } from './fixtures';

const TEST_URL = '/posts/gp-275-20260817-article-qwen-3-8-27b/';

function parseRgb(color: string): [number, number, number] {
  const match = color.match(
    /^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, /]+\s*[\d.]+)?\s*\)$/
  );
  if (!match) throw new Error(`Expected an rgb/rgba color, received ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance(color: string): number {
  return parseRgb(color).reduce((sum, channel, index) => {
    const linear =
      channel / 255 <= 0.03928 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe('Article code block reading contract', () => {
  test('GIVEN a long CLI command WHEN it renders THEN every line is numbered and wraps without horizontal scrolling', async ({
    page,
  }) => {
    const response = await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    const cli = page
      .locator('.post-content pre[data-language="bash"] > code')
      .filter({ hasText: 'static.inaturalist.org/photos/714731804/large.jpg' });
    await expect(cli).toHaveCount(1);

    const lines = cli.locator(':scope > .line');
    await expect(lines).toHaveCount(3);

    const layout = await cli.evaluate((code) => {
      const pre = code.closest('pre');
      const renderedLines = Array.from(code.querySelectorAll(':scope > .line'));

      if (!pre) throw new Error('Expected code block to be inside a pre element');

      return {
        codeText: code.textContent,
        lineNumberStyles: renderedLines.map((line) => {
          const style = getComputedStyle(line, '::before');
          return {
            content: style.content,
            counterIncrement: style.counterIncrement,
          };
        }),
        lineWhiteSpace: getComputedStyle(renderedLines[0]).whiteSpace,
        linePaddingInlineStart: getComputedStyle(renderedLines[0]).paddingInlineStart,
        codeDisplay: getComputedStyle(code).display,
        codeFontSize: getComputedStyle(code).fontSize,
        overflowWrap: getComputedStyle(code).overflowWrap,
        preOverflowX: getComputedStyle(pre).overflowX,
        prePaddingInlineStart: getComputedStyle(pre).paddingInlineStart,
        preScrollWidth: pre.scrollWidth,
        preClientWidth: pre.clientWidth,
        bodyFontSize: getComputedStyle(document.body).fontSize,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layout.codeText).toContain('為這張照片裡的鵜鶘回傳 JSON 邊界框，每個維度用 0-1000 尺度');
    expect(layout.codeText).not.toContain('Return JSON bounding boxes');
    expect(layout.lineNumberStyles).toEqual([
      { content: 'counter(code-line)', counterIncrement: 'code-line 1' },
      { content: 'counter(code-line)', counterIncrement: 'code-line 1' },
      { content: 'counter(code-line)', counterIncrement: 'code-line 1' },
    ]);
    expect(layout.lineWhiteSpace).toBe('pre-wrap');
    expect(Number.parseFloat(layout.linePaddingInlineStart)).toBeLessThanOrEqual(32);
    expect(layout.codeDisplay).toBe('flex');
    expect(Number.parseFloat(layout.codeFontSize)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(layout.codeFontSize)).toBeLessThan(
      Number.parseFloat(layout.bodyFontSize)
    );
    expect(layout.overflowWrap).toBe('anywhere');
    expect(layout.preOverflowX).toBe('hidden');
    expect(Number.parseFloat(layout.prePaddingInlineStart)).toBeLessThanOrEqual(8);
    expect(layout.preScrollWidth).toBeLessThanOrEqual(layout.preClientWidth + 1);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  });

  test('GIVEN either theme WHEN code renders THEN line numbers use a distinct semantic color', async ({
    page,
  }) => {
    const response = await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    const cli = page
      .locator('.post-content pre[data-language="bash"] > code')
      .filter({ hasText: 'static.inaturalist.org/photos/714731804/large.jpg' });
    await expect(cli).toHaveCount(1);

    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((activeTheme) => {
        if (activeTheme === 'light') {
          document.documentElement.dataset.theme = 'light';
        } else {
          delete document.documentElement.dataset.theme;
        }
      }, theme);

      const colors = await cli.evaluate((code) => {
        const firstLine = code.querySelector(':scope > .line');
        if (!firstLine) throw new Error('Expected the code block to contain a rendered line');

        return {
          codeColor: getComputedStyle(code).color,
          lineNumberColor: getComputedStyle(firstLine, '::before').color,
          lineNumberToken: getComputedStyle(document.documentElement)
            .getPropertyValue('--color-code-line-number')
            .trim(),
        };
      });

      expect(colors.lineNumberToken).not.toBe('');
      expect(colors.lineNumberColor).not.toBe(colors.codeColor);
    }
  });

  test('GIVEN quoted plaintext code WHEN either theme renders THEN token text passes AA on its own surface', async ({
    page,
  }) => {
    const response = await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    const quotedPlaintext = page.locator(
      '.post-content blockquote .code-block-wrapper > pre.astro-code[data-language="plaintext"]'
    );
    await expect(quotedPlaintext).toHaveCount(1);

    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((activeTheme) => {
        if (activeTheme === 'light') {
          document.documentElement.dataset.theme = 'light';
        } else {
          delete document.documentElement.dataset.theme;
        }
      }, theme);

      const readings = await quotedPlaintext.evaluateAll((pres) =>
        pres.map((pre) => {
          const tokens = Array.from(pre.querySelectorAll('code > .line > span'));
          if (tokens.length === 0) throw new Error('Expected plaintext code tokens');

          const preStyle = getComputedStyle(pre);
          return {
            background: preStyle.backgroundColor,
            preColor: preStyle.color,
            tokenColors: Array.from(new Set(tokens.map((token) => getComputedStyle(token).color))),
            tokenText: tokens.map((token) => token.textContent ?? ''),
          };
        })
      );

      for (const reading of readings) {
        // Plaintext has no syntax palette: every visible token must inherit the
        // pre's foreground, so the assertion measures what readers actually see.
        expect(reading.tokenColors, `${theme} token ownership`).toEqual([reading.preColor]);
        const ratio = contrastRatio(reading.preColor, reading.background);
        expect(
          ratio,
          `${theme} plaintext code contrast (${reading.preColor} on ${reading.background}; ${reading.tokenText.join('')})`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
