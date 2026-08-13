import { describe, expect, it } from 'vitest';
import { groupPostsByTag } from '../src/utils/tag-groups';

interface FakePost {
  id: string;
  data: {
    originalDate: string;
    translatedDate?: string;
    tags?: string[];
  };
}

function post(
  id: string,
  originalDate: string,
  tags?: string[],
  translatedDate?: string
): FakePost {
  return {
    id,
    data: {
      originalDate,
      translatedDate,
      tags,
    },
  };
}

describe('groupPostsByTag', () => {
  it('keeps first-seen tag order while grouping posts in one pass', () => {
    const groups = groupPostsByTag([
      post('first', '2026-01-01', ['beta', 'alpha']),
      post('second', '2026-01-02', ['gamma', 'beta']),
    ]);

    expect(groups.map(({ tag }) => tag)).toEqual(['beta', 'alpha', 'gamma']);
    expect(groups.map(({ posts }) => posts.map(({ id }) => id))).toEqual([
      ['second', 'first'],
      ['first'],
      ['second'],
    ]);
  });

  it('adds a post once per tag even when its frontmatter repeats that tag', () => {
    const groups = groupPostsByTag([post('duplicate', '2026-01-01', ['ai', 'ai'])]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ tag: 'ai' });
    expect(groups[0]?.posts.map(({ id }) => id)).toEqual(['duplicate']);
  });

  it('ignores posts without tags', () => {
    const groups = groupPostsByTag([
      post('missing', '2026-01-03'),
      post('empty', '2026-01-02', []),
      post('tagged', '2026-01-01', ['ai']),
    ]);

    expect(groups.map(({ tag, posts }) => [tag, posts.map(({ id }) => id)])).toEqual([
      ['ai', ['tagged']],
    ]);
  });

  it('preserves raw tag identity without trimming or case folding', () => {
    const groups = groupPostsByTag([
      post('upper', '2026-01-03', ['AI']),
      post('lower', '2026-01-02', ['ai']),
      post('spaced', '2026-01-01', [' ai ']),
    ]);

    expect(groups.map(({ tag }) => tag)).toEqual(['AI', 'ai', ' ai ']);
    expect(groups.map(({ posts }) => posts.map(({ id }) => id))).toEqual([
      ['upper'],
      ['lower'],
      ['spaced'],
    ]);
  });

  it('sorts by translatedDate first and falls back to originalDate', () => {
    const groups = groupPostsByTag([
      post('new-original', '2026-03-01', ['ai']),
      post('new-translated', '2025-01-01', ['ai'], '2026-04-01'),
      post('old', '2026-02-01', ['ai']),
    ]);

    expect(groups[0]?.posts.map(({ id }) => id)).toEqual(['new-translated', 'new-original', 'old']);
  });

  it('preserves input order when effective dates are equal without mutating the input', () => {
    const posts = [
      post('first', '2026-01-01', ['ai']),
      post('second', '2025-01-01', ['ai'], '2026-01-01'),
      post('third', '2026-01-01', ['ai']),
    ];
    const originalOrder = posts.map(({ id }) => id);

    const groups = groupPostsByTag(posts);

    expect(groups[0]?.posts.map(({ id }) => id)).toEqual(['first', 'second', 'third']);
    expect(posts.map(({ id }) => id)).toEqual(originalOrder);
  });

  it('reads each post tag list once instead of rescanning every post for every tag', () => {
    let tagReads = 0;
    const posts = Array.from({ length: 20 }, (_, index) => ({
      id: `post-${index}`,
      data: {
        originalDate: `2026-01-${String(index + 1).padStart(2, '0')}`,
        get tags() {
          tagReads += 1;
          return ['shared', `tag-${index}`];
        },
      },
    }));

    groupPostsByTag(posts);

    expect(tagReads).toBe(posts.length);
  });
});
