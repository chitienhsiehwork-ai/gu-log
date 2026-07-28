import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import RelatedArticles from '../src/components/RelatedArticles.astro';

interface TestPost {
  id: string;
  data: {
    title: string;
    tags: string[];
    originalDate: string;
    lang: string;
    series?: { name: string; order: number };
  };
}

function post(
  id: string,
  originalDate: string,
  tags: string[],
  series?: { name: string; order: number }
): TestPost {
  return {
    id,
    data: {
      title: id,
      tags,
      originalDate,
      lang: 'zh-tw',
      series,
    },
  };
}

function extractRelatedSlugs(html: string): string[] {
  return Array.from(
    html.matchAll(/<li\b[^>]*\bdata-related-item\b[^>]*\bdata-slug="([^"]+)"/g),
    (match) => match[1]
  );
}

async function renderWithRelevantSortProbe(
  container: Awaited<ReturnType<typeof AstroContainer.create>>,
  allPosts: TestPost[],
  currentSlug: string,
  currentTags: string[]
): Promise<{ html: string; relevantSortSizes: number[] }> {
  const fixtureIds = new Set(allPosts.map(({ id }) => id));
  const relevantSortSizes: number[] = [];
  const originalSort = Array.prototype.sort;

  Array.prototype.sort = function (
    this: unknown[],
    compareFn?: (a: unknown, b: unknown) => number
  ) {
    const containsFixturePost = this.some((value) => {
      if (!value || typeof value !== 'object') return false;

      const candidate = value as {
        id?: unknown;
        post?: { id?: unknown };
      };
      return (
        (typeof candidate.id === 'string' && fixtureIds.has(candidate.id)) ||
        (typeof candidate.post?.id === 'string' && fixtureIds.has(candidate.post.id))
      );
    });

    if (containsFixturePost) relevantSortSizes.push(this.length);
    return originalSort.call(this, compareFn);
  } as typeof Array.prototype.sort;

  try {
    const html = await container.renderToString(RelatedArticles, {
      props: {
        currentSlug,
        currentTags,
        allPosts,
        lang: 'zh-tw',
      },
    });
    return { html, relevantSortSizes };
  } finally {
    Array.prototype.sort = originalSort;
  }
}

describe('RelatedArticles ranking', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  it('keeps the strongest overlap and stable input order without sorting the full candidate set', async () => {
    const currentSlug = 'current';
    const allPosts = [
      post('tie-first', '2026-06-01', ['alpha']),
      post('strong-duplicate-tags', '2026-01-01', ['alpha', 'alpha']),
      post('tie-second', '2026-06-01', ['alpha']),
      post('tie-third', '2026-06-01', ['alpha']),
      post('tie-fourth', '2026-06-01', ['alpha']),
      post('zero-overlap-newest', '2027-01-01', ['omega']),
      post(currentSlug, '2028-01-01', ['alpha', 'alpha', 'alpha']),
      post('series-excluded', '2029-01-01', ['alpha', 'alpha', 'alpha'], {
        name: 'fixture',
        order: 1,
      }),
    ];

    const { html, relevantSortSizes } = await renderWithRelevantSortProbe(
      container,
      allPosts,
      currentSlug,
      ['alpha']
    );

    expect(extractRelatedSlugs(html)).toEqual(['strong-duplicate-tags', 'tie-first', 'tie-second']);
    expect(relevantSortSizes.some((size) => size > 4)).toBe(false);
  });

  it('keeps the three newest fallback posts with stable date ties and bounded work', async () => {
    const currentSlug = 'current';
    const allPosts = [
      post('older', '2026-01-01', ['omega']),
      post('newest-first', '2026-07-01', ['omega']),
      post('middle', '2026-05-01', ['omega']),
      post('newest-second', '2026-07-01', ['omega']),
      post('third-newest', '2026-06-01', ['omega']),
      post('oldest', '2025-01-01', ['omega']),
      post(currentSlug, '2028-01-01', ['omega']),
      post('series-excluded', '2029-01-01', ['omega'], {
        name: 'fixture',
        order: 1,
      }),
    ];

    const { html, relevantSortSizes } = await renderWithRelevantSortProbe(
      container,
      allPosts,
      currentSlug,
      ['alpha']
    );

    expect(extractRelatedSlugs(html)).toEqual(['newest-first', 'newest-second', 'third-newest']);
    expect(relevantSortSizes.some((size) => size > 4)).toBe(false);
  });

  it('preserves the legacy stable-sort result when an eligible date is invalid', async () => {
    const allPosts = [
      post('march-first', '2026-03-01', ['alpha']),
      post('march-second', '2026-03-01', ['alpha']),
      post('february-first', '2026-02-01', ['alpha']),
      post('february-second', '2026-02-01', ['alpha']),
      post('invalid-date', '2026-99-99', ['alpha']),
      post('march-third', '2026-03-01', ['alpha']),
    ];

    const { html, relevantSortSizes } = await renderWithRelevantSortProbe(
      container,
      allPosts,
      'current',
      ['alpha']
    );

    expect(extractRelatedSlugs(html)).toEqual(['march-first', 'march-second', 'february-first']);
    expect(relevantSortSizes).toContain(6);
  });
});
