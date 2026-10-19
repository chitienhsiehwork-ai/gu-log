import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import PrevNextNav from '../src/components/PrevNextNav.astro';

describe('PrevNextNav', () => {
  it('preserves authored English calendar dates west of UTC', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';

    try {
      const container = await AstroContainer.create();
      const html = await container.renderToString(PrevNextNav, {
        props: {
          currentSlug: 'current',
          lang: 'en',
          allPosts: [
            {
              id: 'current',
              data: {
                title: 'Current post',
                originalDate: '2026-01-02',
                lang: 'en',
              },
            },
            {
              id: 'older',
              data: {
                title: 'Older post',
                originalDate: '2025-12-31',
                lang: 'en',
              },
            },
          ],
        },
      });

      expect(html).toContain('Dec 31, 2025');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
