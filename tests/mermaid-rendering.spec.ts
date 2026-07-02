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
});
