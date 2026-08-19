import { test, expect } from './fixtures';

const TEST_URL = '/posts/gp-275-20260817-article-qwen-3-8-27b/';

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
});
