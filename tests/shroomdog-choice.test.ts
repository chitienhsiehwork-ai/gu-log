/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SHROOMDOG_CHOICE_TICKET_IDS,
  assertUniqueShroomDogChoiceTicketIds,
} from '../src/config/shroomdog-choice';
import { resolveShroomDogChoicePosts } from '../src/utils/shroomdog-choice';

type Lang = 'zh-tw' | 'en';
type Status = 'published' | 'deprecated' | 'retired';

type FakePost = {
  id: string;
  data: {
    ticketId: string;
    lang: Lang;
    originalDate: string;
    status?: Status;
    deprecatedBy?: string;
    unlisted?: boolean;
    scores?: any;
  };
};

const passingScores = {
  tribunalVersion: 9,
  vibe: { persona: 9, moguNote: 8, vibe: 8, narrative: 8, score: 8, date: '2026-08-16' },
  factCheck: {
    accuracy: 8,
    fidelity: 8,
    consistency: 8,
    sourceBoundary: 8,
    commentarySeparation: 8,
    score: 8,
    date: '2026-08-16',
  },
  librarian: {
    glossary: 8,
    crossRef: 8,
    sourceAlign: 8,
    attribution: 8,
    score: 8,
    date: '2026-08-16',
  },
  freshEyes: {
    readability: 8,
    firstImpression: 8,
    payoffDensity: 8,
    lengthFit: 8,
    clarity: 8,
    score: 8,
    date: '2026-08-16',
  },
};

const belowBarScores = {
  tribunalVersion: 9,
  vibe: { persona: 7, moguNote: 7, vibe: 7, narrative: 7, score: 7, date: '2026-08-16' },
};

function post(ticketId: string, lang: Lang, extra: Partial<FakePost['data']> = {}): FakePost {
  const slug = ticketId.toLowerCase();
  return {
    id: `${lang === 'en' ? 'en-' : ''}${slug}`,
    data: {
      ticketId,
      lang,
      originalDate: '2026-01-01',
      ...extra,
    },
  };
}

const cast = (posts: FakePost[]) =>
  posts as unknown as Parameters<typeof resolveShroomDogChoicePosts>[0];

describe('ShroomDog’s Choice menu config', () => {
  it('keeps one explicit initial menu in editorial order', () => {
    expect(SHROOMDOG_CHOICE_TICKET_IDS).toEqual(['GP-127', 'GP-101', 'GP-110']);
  });

  it('fails fast and names a duplicate ticketId', () => {
    expect(() => assertUniqueShroomDogChoiceTicketIds(['GP-127', 'GP-101', 'GP-127'])).toThrow(
      /duplicate.*GP-127/i
    );
  });
});

describe('resolveShroomDogChoicePosts', () => {
  it('resolves both locales from the same menu without changing its order', () => {
    const menu = ['GP-127', 'GP-101', 'GP-110'] as const;
    const posts = menu.flatMap((ticketId) => [
      post(ticketId, 'zh-tw', { scores: passingScores }),
      post(ticketId, 'en', { scores: passingScores }),
    ]);

    expect(
      resolveShroomDogChoicePosts(cast(posts), 'zh-tw', menu).map((p) => p.data.ticketId)
    ).toEqual(menu);
    expect(
      resolveShroomDogChoicePosts(cast(posts), 'en', menu).map((p) => p.data.ticketId)
    ).toEqual(menu);
  });

  it('keeps grandfathered posts with no tribunal scores', () => {
    const posts = [post('GP-1', 'zh-tw'), post('GP-1', 'en')];

    expect(resolveShroomDogChoicePosts(cast(posts), 'zh-tw', ['GP-1'])).toHaveLength(1);
    expect(resolveShroomDogChoicePosts(cast(posts), 'en', ['GP-1'])).toHaveLength(1);
  });

  it.each(['retired', 'deprecated'] as const)(
    'excludes an effectively %s pair without filling the vacancy',
    (status) => {
      const posts = [
        post('GP-1', 'zh-tw', {
          status,
          deprecatedBy: status === 'deprecated' ? 'GP-9' : undefined,
          scores: passingScores,
        }),
        post('GP-1', 'en', { scores: passingScores }),
        post('GP-2', 'zh-tw', { scores: passingScores }),
        post('GP-2', 'en', { scores: passingScores }),
        post('GP-9', 'zh-tw', { scores: passingScores }),
        post('GP-9', 'en', { scores: passingScores }),
      ];

      expect(
        resolveShroomDogChoicePosts(cast(posts), 'en', ['GP-1', 'GP-2']).map((p) => p.data.ticketId)
      ).toEqual(['GP-2']);
    }
  );

  it('excludes unlisted posts from either the canonical or current-language entry', () => {
    const posts = [
      post('GP-1', 'zh-tw', { unlisted: true, scores: passingScores }),
      post('GP-1', 'en', { scores: passingScores }),
      post('GP-2', 'zh-tw', { scores: passingScores }),
      post('GP-2', 'en', { unlisted: true, scores: passingScores }),
    ];

    expect(resolveShroomDogChoicePosts(cast(posts), 'zh-tw', ['GP-1'])).toEqual([]);
    expect(resolveShroomDogChoicePosts(cast(posts), 'en', ['GP-1', 'GP-2'])).toEqual([]);
  });

  it('excludes below-bar posts while retaining a passing neighbor', () => {
    const posts = [
      post('GP-1', 'zh-tw', { scores: belowBarScores }),
      post('GP-2', 'zh-tw', { scores: passingScores }),
    ];

    expect(
      resolveShroomDogChoicePosts(cast(posts), 'zh-tw', ['GP-1', 'GP-2']).map(
        (p) => p.data.ticketId
      )
    ).toEqual(['GP-2']);
  });

  it('safe-skips a missing locale entry, preserves relative order, and never fills from outside the menu', () => {
    const posts = [
      post('GP-1', 'zh-tw'),
      post('GP-1', 'en'),
      post('GP-2', 'zh-tw'),
      post('GP-3', 'zh-tw'),
      post('GP-3', 'en'),
      post('GP-9', 'zh-tw'),
      post('GP-9', 'en'),
    ];

    expect(
      resolveShroomDogChoicePosts(cast(posts), 'en', ['GP-1', 'GP-2', 'GP-3']).map(
        (p) => p.data.ticketId
      )
    ).toEqual(['GP-1', 'GP-3']);
  });

  it('rejects duplicate runtime menus before resolving any posts', () => {
    expect(() =>
      resolveShroomDogChoicePosts(cast([post('GP-1', 'zh-tw')]), 'zh-tw', ['GP-1', 'GP-1'])
    ).toThrow(/duplicate.*GP-1/i);
  });
});

describe('ShroomDogChoice homepage component contract', () => {
  it('keeps the exact bilingual promise and first-pick labels without an SD seal', () => {
    const source = readFileSync('src/components/ShroomDogChoice.astro', 'utf8');

    expect(source).toContain('ShroomDog’s Choice');
    expect(source).toContain('ShroomDog 本人讀過、排過，喜歡或有用的精選文章');
    expect(source).toContain(
      'Articles ShroomDog has read and ranked because he liked them or found them useful.'
    );
    expect(source).toContain('01 · 首選');
    expect(source).toContain('01 · Top Pick');
    expect(source).not.toContain('TicketBadge');
    expect(source).not.toMatch(/>\s*SD\s*</);
  });

  it('renders before Gu-log Picks on both localized homepages', () => {
    for (const path of ['src/pages/index.astro', 'src/pages/en/index.astro']) {
      const source = readFileSync(path, 'utf8');
      const choiceIndex = source.indexOf('<ShroomDogChoice');
      const guLogPicksIndex = source.indexOf('{/* GP: Gu-log Picks');

      expect(choiceIndex, path).toBeGreaterThan(-1);
      expect(guLogPicksIndex, path).toBeGreaterThan(choiceIndex);
    }
  });
});
