import { expect, test } from '@playwright/test';

// Dedicated fixture: no public post embeds PostVideo after the GP takedown
// (openspec: post-takedown), so the component contract is pinned here.
const ARTICLE = '/artifacts/post-video-fixture/';

test.describe('PostVideo', () => {
  test('GIVEN source videos WHEN the page renders on mobile THEN both stay inline, lazy, and overflow-safe', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('https://media.example.com/**', (route) => route.abort());
    await page.goto(ARTICLE);

    const videos = page.locator('[data-post-video] video');
    await expect(videos).toHaveCount(2);

    const expected = [
      {
        src: 'https://media.example.com/fixtures/landscape-demo.mp4',
        poster: 'https://media.example.com/fixtures/landscape-demo-first-frame.jpg',
        width: '720',
        height: '548',
      },
      {
        src: 'https://media.example.com/fixtures/square-demo.mp4',
        poster: 'https://media.example.com/fixtures/square-demo-first-frame.jpg',
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
