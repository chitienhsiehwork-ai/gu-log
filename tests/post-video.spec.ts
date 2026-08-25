import { expect, test } from '@playwright/test';

const ARTICLE = '/posts/gp-275-20260817-article-qwen-3-8-27b/';

test.describe('PostVideo', () => {
  test('GIVEN source videos WHEN the GP renders on mobile THEN both stay inline, lazy, and overflow-safe', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('https://static.simonwillison.net/**', (route) => route.abort());
    await page.goto(ARTICLE);

    const videos = page.locator('[data-post-video] video');
    await expect(videos).toHaveCount(2);

    const expected = [
      {
        src: 'https://static.simonwillison.net/static/2026/qwen-animated-small.mp4',
        poster: 'https://static.simonwillison.net/static/2026/qwen-animated-first-frame.jpg',
        width: '720',
        height: '548',
      },
      {
        src: 'https://static.simonwillison.net/static/2026/circle-web.mp4',
        poster: 'https://static.simonwillison.net/static/2026/circle-web-first-frame.jpg',
        width: '1078',
        height: '1080',
      },
    ];

    for (const [index, media] of expected.entries()) {
      const video = videos.nth(index);
      await expect(video).toHaveAttribute('controls', '');
      await expect(video).toHaveAttribute('loop', '');
      await expect(video).toHaveAttribute('playsinline', '');
      await expect(video).toHaveAttribute('preload', 'none');
      await expect(video).toHaveAttribute('poster', media.poster);
      await expect(video).toHaveAttribute('width', media.width);
      await expect(video).toHaveAttribute('height', media.height);
      await expect(video).toHaveAttribute('aria-label', /.+/);
      await expect(video.locator('source')).toHaveAttribute('src', media.src);
      await expect(video.locator('source')).toHaveAttribute('type', 'video/mp4');
      await expect(video.locator('a')).toHaveAttribute('href', media.src);
    }

    const layout = await page.locator('[data-post-video]').evaluateAll((figures) => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      boxes: figures.map((figure) => {
        const box = figure.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }),
    }));

    expect(layout.pageWidth).toBe(layout.viewportWidth);
    for (const box of layout.boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(layout.viewportWidth);
      expect(box.width).toBeGreaterThan(0);
    }
  });
});
