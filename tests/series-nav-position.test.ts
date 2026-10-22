/**
 * SeriesNav 的位置算法（src/utils/series-nav.ts，#1164）。
 *
 * 用固定的 fixture 模擬系列中間幾篇下架後的斷號，讓 PR 的 unit-tests 就能擋住回歸；
 * tests/series-nav.spec.ts 是對真實內容跑的 Playwright，只在 nightly 跑。
 */
import { describe, expect, it } from 'vitest';
import { getSeriesPosition, type SeriesMember } from '../src/utils/series-nav';

const SERIES = "Simon Willison's Agentic Engineering";
const member = (id: string, order: number, name = SERIES): SeriesMember => ({
  id,
  data: { series: { name, order } },
});

// order 2～9 都下架了，可見清單只剩 1、10、11、12、13，而且順序是亂的。
const VISIBLE: SeriesMember[] = [
  member('mp-171', 13),
  member('mp-8', 1),
  member('mp-146', 11),
  member('mp-145', 10),
  member('mp-169', 12),
  member('other-2', 2, 'Another series'),
  { id: 'no-series', data: {} },
];
const ids = (posts: SeriesMember[]) => posts.map((post) => post.id);
const idOf = (post: SeriesMember | null) => post?.id ?? null;

describe('getSeriesPosition', () => {
  it('counts the visible position across a gap, not series.order', () => {
    const position = getSeriesPosition(VISIBLE, 'mp-145');

    expect(position?.name).toBe(SERIES);
    expect(ids(position?.posts ?? [])).toEqual(['mp-8', 'mp-145', 'mp-146', 'mp-169', 'mp-171']);
    expect(position?.index).toBe(1);
    expect(idOf(position?.prev ?? null)).toBe('mp-8');
    expect(idOf(position?.next ?? null)).toBe('mp-146');
  });

  it('links the first visible post forward across the gap', () => {
    const position = getSeriesPosition(VISIBLE, 'mp-8');

    expect(position?.index).toBe(0);
    expect(position?.prev).toBeNull();
    expect(idOf(position?.next ?? null)).toBe('mp-145');
  });

  it('has no next for the last visible post', () => {
    const position = getSeriesPosition(VISIBLE, 'mp-171');

    expect(position?.index).toBe(4);
    expect(idOf(position?.prev ?? null)).toBe('mp-169');
    expect(position?.next).toBeNull();
  });

  it('returns null without a series or when the post is not in the list', () => {
    expect(getSeriesPosition(VISIBLE, 'no-series')).toBeNull();
    expect(getSeriesPosition(VISIBLE, 'missing')).toBeNull();
  });

  it('leaves the caller list untouched', () => {
    const before = ids(VISIBLE);
    getSeriesPosition(VISIBLE, 'mp-145');
    expect(ids(VISIBLE)).toEqual(before);
  });
});
