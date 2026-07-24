import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import Stage0WarnBanner from '../../src/components/Stage0WarnBanner.astro';
import Stage4DegradedBanner from '../../src/components/Stage4DegradedBanner.astro';

describe('Tribunal warning banner rendering', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  it('renders the Stage 0 reason as escaped text with the comments anchor', async () => {
    const html = await container.renderToString(Stage0WarnBanner, {
      props: {
        reason: '<script>globalThis.pwned = true</script>',
        judgeModel: 'Opus',
        lang: 'zh-tw',
      },
    });

    expect(html).toContain('Mogu 的 AI judge 對這篇沒把握');
    expect(html).toContain('&lt;script&gt;globalThis.pwned = true&lt;/script&gt;');
    expect(html).not.toContain('<script>globalThis.pwned = true</script>');
    expect(html).toContain('href="#giscus-comments"');
    expect(html).not.toContain('ShroomDog 的說明');
  });

  it('renders optional Stage 0 override copy in English', async () => {
    const html = await container.renderToString(Stage0WarnBanner, {
      props: {
        reason: 'The evidence boundary needs review.',
        judgeModel: 'Opus',
        overrideComment: 'Published for discussion.',
        lang: 'en',
      },
    });

    expect(html).toContain('Mogu&#39;s AI judge wasn&#39;t sure about this one');
    expect(html).toContain('ShroomDog&#39;s note:');
    expect(html).toContain('Published for discussion.');
    expect(html).toContain('Jump to comments');
  });

  it('renders every degraded dimension supplied to the Stage 4 banner', async () => {
    const html = await container.renderToString(Stage4DegradedBanner, {
      props: {
        stage4Scores: {
          isDegraded: true,
          degradedDimensions: ['persona', 'narrative'],
        },
        lang: 'zh-tw',
      },
    });

    expect(html).toContain('Final Vibe: 部分維度在後期修改後退步了');
    expect(html).toMatch(/<li class="dim-item"[^>]*>persona<\/li>/);
    expect(html).toMatch(/<li class="dim-item"[^>]*>narrative<\/li>/);
    expect(html).not.toContain('（詳細分數未記錄）');
  });

  it('renders a defensive no-details message when degraded dimensions are absent', async () => {
    const html = await container.renderToString(Stage4DegradedBanner, {
      props: {
        stage4Scores: {
          isDegraded: true,
        },
        lang: 'en',
      },
    });

    expect(html).toContain('Some dimensions regressed after late-stage edits');
    expect(html).toContain('(detailed scores not recorded)');
  });
});
