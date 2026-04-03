import type { CollectionEntry } from 'astro:content';

type PostEntry = CollectionEntry<'posts'>;
type PostLang = PostEntry['data']['lang'];

export interface ResolvedPostDeprecation {
  deprecated: boolean;
  sourcePost?: PostEntry;
  replacementPost?: PostEntry;
  replacementTicketId?: string;
  reason?: string;
}

function findPostByTicketId(posts: PostEntry[], ticketId?: string, lang?: PostLang): PostEntry | undefined {
  if (!ticketId) {
    return undefined;
  }

  return posts.find(
    (post) => post.data.ticketId === ticketId && (!lang || post.data.lang === lang)
  );
}

export function getTranslationPair(
  post: PostEntry,
  posts: PostEntry[],
  targetLang?: PostLang
): PostEntry | undefined {
  if (!post.data.ticketId) {
    return undefined;
  }

  const desiredLang = targetLang ?? (post.data.lang === 'en' ? 'zh-tw' : 'en');

  return posts.find(
    (candidate) =>
      candidate.slug !== post.slug &&
      candidate.data.ticketId === post.data.ticketId &&
      candidate.data.lang === desiredLang
  );
}

/**
 * Resolve whether a post should be treated as deprecated.
 *
 * English posts inherit deprecation from their zh-tw translation pair so we can
 * retire the whole pair by marking the canonical zh-tw post once.
 */
export function resolvePostDeprecation(
  post: PostEntry,
  posts: PostEntry[]
): ResolvedPostDeprecation {
  const zhSource = post.data.lang === 'en' ? getTranslationPair(post, posts, 'zh-tw') : undefined;

  const sourcePost = zhSource?.data.deprecated ? zhSource : post.data.deprecated ? post : undefined;

  if (!sourcePost) {
    return { deprecated: false };
  }

  const replacementTicketId = sourcePost.data.deprecatedBy;
  const replacementPost = replacementTicketId
    ? findPostByTicketId(posts, replacementTicketId, post.data.lang) ??
      findPostByTicketId(posts, replacementTicketId, sourcePost.data.lang) ??
      findPostByTicketId(posts, replacementTicketId)
    : undefined;

  return {
    deprecated: true,
    sourcePost,
    replacementPost,
    replacementTicketId,
    reason: sourcePost.data.deprecatedReason,
  };
}

export function isPostDeprecated(post: PostEntry, posts: PostEntry[]): boolean {
  return resolvePostDeprecation(post, posts).deprecated;
}

export function getVisiblePosts(posts: PostEntry[], lang?: PostLang): PostEntry[] {
  return posts.filter(
    (post) => (!lang || post.data.lang === lang) && !isPostDeprecated(post, posts)
  );
}

export function getNavigablePosts(posts: PostEntry[], currentPost: PostEntry): PostEntry[] {
  const visiblePosts = getVisiblePosts(posts, currentPost.data.lang);

  if (visiblePosts.some((post) => post.slug === currentPost.slug)) {
    return visiblePosts;
  }

  return [...visiblePosts, currentPost];
}

export function getLocalizedPostUrl(post: PostEntry): string {
  return post.data.lang === 'en' ? `/en/posts/${post.slug}` : `/posts/${post.slug}`;
}
