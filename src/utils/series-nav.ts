/**
 * SeriesNav 的位置算法（#1164）。
 *
 * `series.order` 是原本的系列順序，文章下架後會斷號，所以只拿來排序；第幾篇、上下篇都看
 * 目前這篇在 `posts`（呼叫端傳入的可見清單）裡的位置。
 */
export interface SeriesMember {
  id: string;
  data: { series?: { name: string; order: number } };
}

export interface SeriesPosition<T extends SeriesMember> {
  name: string;
  /** 同系列的可見文章，依 `series.order` 排序 */
  posts: T[];
  /** 目前這篇在 `posts` 的位置，從 0 開始 */
  index: number;
  prev: T | null;
  next: T | null;
}

/** 目前這篇不在 `posts` 裡、或沒有 `series` 時回 null。 */
export function getSeriesPosition<T extends SeriesMember>(
  posts: readonly T[],
  currentId: string
): SeriesPosition<T> | null {
  const series = posts.find((post) => post.id === currentId)?.data.series;
  if (!series) return null;

  const seriesPosts = posts
    .filter((post) => post.data.series?.name === series.name)
    .sort((a, b) => (a.data.series?.order ?? 0) - (b.data.series?.order ?? 0));
  const index = seriesPosts.findIndex((post) => post.id === currentId);

  return {
    name: series.name,
    posts: seriesPosts,
    index,
    prev: seriesPosts[index - 1] ?? null,
    next: seriesPosts[index + 1] ?? null,
  };
}
