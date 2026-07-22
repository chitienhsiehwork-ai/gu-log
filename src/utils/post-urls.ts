import type { CollectionEntry } from 'astro:content';

type PostEntry = CollectionEntry<'posts'>;

/**
 * Canonical localized URL for a post page — the single URL builder shared by
 * pages, RSS and the JSON feed/detail APIs. zh-tw posts live under /posts/,
 * en posts under /en/posts/ (the en- filename prefix stays in the slug).
 */
export function getLocalizedPostUrl(post: PostEntry): string {
  return post.data.lang === 'en' ? `/en/posts/${post.id}` : `/posts/${post.id}`;
}
