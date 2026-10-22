import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import AiJudgeScore from '../src/components/AiJudgeScore.astro';
import { LEGACY_TRIBUNAL_VERSION } from '../src/lib/tribunal-v2/pass-bar';

// Shape of MP-308's frontmatter: a lone pre-v9 Vibe score with no tribunalVersion.
const unstampedVibe = {
  vibe: {
    persona: 8,
    moguNote: 9,
    vibe: 9,
    clarity: 9,
    narrative: 9,
    score: 8,
    date: '2026-06-13',
  },
};

function versionLabel(html: string): string | undefined {
  return html.match(/class="tribunal-version"[^>]*>(v\d+)</)?.[1];
}

describe('AiJudgeScore tribunal version label', () => {
  it('labels unstamped scores with the legacy version, not v3', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AiJudgeScore, {
      props: { scores: unstampedVibe, lang: 'zh-tw' },
    });

    expect(versionLabel(html)).toBe(`v${LEGACY_TRIBUNAL_VERSION}`);
  });

  it('labels stamped scores with their own version', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AiJudgeScore, {
      props: { scores: { ...unstampedVibe, tribunalVersion: 9 }, lang: 'en' },
    });

    expect(versionLabel(html)).toBe('v9');
  });
});
