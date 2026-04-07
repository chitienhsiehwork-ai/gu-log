import type { CollectionEntry } from 'astro:content';

type PostEntry = CollectionEntry<'posts'>;
type PostLang = PostEntry['data']['lang'];
export type PostStatus = 'published' | 'deprecated' | 'retired';

export interface ResolvedPostStatus {
  status: PostStatus;
  sourcePost?: PostEntry;
  replacementPost?: PostEntry;
  replacementTicketId?: string;
  reason?: string;
  retiredAt?: string;
}

function normalizeStatus(status?: string): PostStatus {
  return status === 'deprecated' || status === 'retired' ? status : 'published';
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
 * Resolve a post's effective publication status.
 *
 * English posts inherit status from their zh-tw translation pair so the whole
 * pair can be marked deprecated/retired from the canonical zh-tw post.
 */
export function resolvePostStatus(post: PostEntry, posts: PostEntry[]): ResolvedPostStatus {
  const zhSource = post.data.lang === 'en' ? getTranslationPair(post, posts, 'zh-tw') : undefined;

  const sourcePost = [zhSource, post].find(
    (candidate): candidate is PostEntry =>
      candidate !== undefined && normalizeStatus(candidate.data.status) !== 'published'
  );

  if (!sourcePost) {
    return { status: 'published' };
  }

  const status = normalizeStatus(sourcePost.data.status);
  const replacementTicketId = status === 'deprecated' ? sourcePost.data.deprecatedBy : undefined;
  const replacementPost = replacementTicketId
    ? findPostByTicketId(posts, replacementTicketId, post.data.lang) ??
      findPostByTicketId(posts, replacementTicketId, sourcePost.data.lang) ??
      findPostByTicketId(posts, replacementTicketId)
    : undefined;

  return {
    status,
    sourcePost,
    replacementPost,
    replacementTicketId,
    reason: status === 'deprecated' ? sourcePost.data.deprecatedReason : sourcePost.data.retiredReason,
    retiredAt: sourcePost.data.retiredAt,
  };
}

export function getPostStatus(post: PostEntry, posts?: PostEntry[]): PostStatus {
  return posts ? resolvePostStatus(post, posts).status : normalizeStatus(post.data.status);
}

export function isPostNonPublished(post: PostEntry, posts: PostEntry[]): boolean {
  return getPostStatus(post, posts) !== 'published';
}

export function getPublishedPosts(posts: PostEntry[], lang?: PostLang): PostEntry[] {
  return posts.filter(
    (post) => (!lang || post.data.lang === lang) && getPostStatus(post, posts) === 'published'
  );
}

export function getListablePosts(posts: PostEntry[], lang?: PostLang): PostEntry[] {
  return posts.filter(
    (post) =>
      (!lang || post.data.lang === lang) && resolvePostStatus(post, posts).status !== 'deprecated',
  );
}

export function getNavigablePosts(posts: PostEntry[], currentPost: PostEntry): PostEntry[] {
  const publishedPosts = getPublishedPosts(posts, currentPost.data.lang);

  if (publishedPosts.some((post) => post.slug === currentPost.slug)) {
    return publishedPosts;
  }

  return [...publishedPosts, currentPost];
}

export function getLocalizedPostUrl(post: PostEntry): string {
  return post.data.lang === 'en' ? `/en/posts/${post.slug}` : `/posts/${post.slug}`;
}
