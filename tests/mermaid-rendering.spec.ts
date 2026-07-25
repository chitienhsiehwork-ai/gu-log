import { test, expect } from './fixtures';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const SAFE_CHROME_RESERVE = 96;

const cases = [
  {
    path: '/posts/levelup-20260608-12-llm-internals/',
    labels: [
      '文字',
      '詞元編號',
      '嵌入向量',
      '位置資訊',
      'RoPE',
      'Transformer',
      '區塊',
      '注意力機制',
      '前饋網路',
      '殘差流',
      '原始分數',
      '下一個 Token',
    ],
  },
  {
    path: '/en/posts/en-levelup-20260608-12-llm-internals/',
    labels: [
      'Text',
      'Token IDs',
      'Embeddings',
      'Position / RoPE',
      'Transformer Blocks',
      'Attention',
      'Feed-Forward Network',
      'Residual Stream',
      'Logits',
      'Next Token',
    ],
  },
];

test.describe('Mermaid rendering', () => {
  test('GIVEN localized post routes WHEN Mermaid controls render THEN reader-facing labels match the route language', async ({
    page,
  }) => {
    for (const { path, labels } of [
      {
        path: '/posts/levelup-20260608-12-llm-internals/',
        labels: {
          expand: '展開圖表',
          title: '點擊放大',
          close: '關閉圖表',
          loading: '載入圖表中...',
        },
      },
      {
        path: '/en/posts/en-levelup-20260608-12-llm-internals/',
        labels: {
          expand: 'Expand diagram',
          title: 'Click to enlarge',
          close: 'Close diagram',
          loading: 'Loading diagram...',
        },
      },
    ]) {
      await page.goto(path);

      const diagram = page.locator('.mermaid-wrapper').first();
      await expect(diagram.locator('.mermaid-expand-btn')).toHaveAttribute(
        'aria-label',
        labels.expand
      );
      await expect(diagram.locator('.mermaid-expand-btn')).toHaveAttribute('title', labels.title);
      await expect(diagram.locator('.mermaid-render')).toHaveAttribute(
        'data-loading-label',
        labels.loading
      );

      const overlay = diagram.locator('xpath=following-sibling::*[1]');
      await expect(overlay).toHaveClass(/mermaid-overlay/);
      await expect(overlay.locator('.mermaid-close-btn')).toHaveAttribute(
        'aria-label',
        labels.close
      );
    }
  });

  for (const { path, labels } of cases) {
    test(`GIVEN the Lv-12 overview diagram WHEN rendered on mobile THEN every graph label is visible: ${path}`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto(path);

      const diagram = page.locator('.mermaid-wrapper').first();
      await expect(diagram.locator('svg.flowchart')).toBeVisible({ timeout: 60_000 });

      const svg = diagram.locator('svg.flowchart');
      const svgBox = await svg.boundingBox();
      expect(svgBox, 'Mermaid SVG should have a rendered box').not.toBeNull();

      for (const label of labels) {
        const labelLocator = svg
          .locator('foreignObject')
          .getByText(label, { exact: false })
          .first();
        await expect(labelLocator, `graph label should be visible: ${label}`).toBeVisible();

        const labelBox = await labelLocator.boundingBox();
        expect(labelBox, `graph label should have a rendered box: ${label}`).not.toBeNull();

        const margin = 2;
        expect(
          labelBox!.x,
          `graph label should not extend left of SVG: ${label}`
        ).toBeGreaterThanOrEqual(svgBox!.x - margin);
        expect(
          labelBox!.y,
          `graph label should not extend above SVG: ${label}`
        ).toBeGreaterThanOrEqual(svgBox!.y - margin);
        expect(
          labelBox!.x + labelBox!.width,
          `graph label should not extend right of SVG: ${label}`
        ).toBeLessThanOrEqual(svgBox!.x + svgBox!.width + margin);
        expect(
          labelBox!.y + labelBox!.height,
          `graph label should not extend below SVG: ${label}`
        ).toBeLessThanOrEqual(svgBox!.y + svgBox!.height + margin);
      }

      expect(
        svgBox!.height,
        'overview diagram should fit inside a mobile viewport with room for browser chrome'
      ).toBeLessThanOrEqual(MOBILE_VIEWPORT.height - SAFE_CHROME_RESERVE);
    });
  }

  test('GIVEN a rendered diagram WHEN the reader changes theme THEN the diagram and overlay use the active theme tokens', async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/posts/levelup-20260608-12-llm-internals/');

    const diagram = page.locator('.mermaid-wrapper').first();
    const nodeOutline = diagram.locator('.rough-node path').first();
    await expect(nodeOutline).toBeVisible({ timeout: 60_000 });

    const resolveColorVariable = (name: string) =>
      page.evaluate((variableName) => {
        const raw = getComputedStyle(document.documentElement)
          .getPropertyValue(variableName)
          .trim();
        const probe = document.createElement('span');
        probe.style.color = raw;
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      }, name);

    const darkSurface = await resolveColorVariable('--color-surface');
    await expect
      .poll(() => nodeOutline.evaluate((element) => getComputedStyle(element).stroke))
      .toBe(darkSurface);
    await expect(diagram).toHaveCSS(
      'background-color',
      await resolveColorVariable('--color-bg-muted')
    );

    await page.locator('.theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const lightSurface = await resolveColorVariable('--color-surface');
    await expect
      .poll(() => nodeOutline.evaluate((element) => getComputedStyle(element).stroke))
      .toBe(lightSurface);
    expect(lightSurface).not.toBe(darkSurface);
    await expect(diagram).toHaveCSS(
      'background-color',
      await resolveColorVariable('--color-bg-muted')
    );

    await diagram.locator('.mermaid-expand-btn').click();
    const overlay = diagram.locator('xpath=following-sibling::*[1]');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('background-color', await resolveColorVariable('--color-bg'));
  });
});
