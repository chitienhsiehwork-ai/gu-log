import type { CollectionEntry } from 'astro:content';
import { getListablePosts } from './post-status';
import { groupPostsByTag } from './tag-groups';

type PostEntry = CollectionEntry<'posts'>;
type PostLang = PostEntry['data']['lang'];

/**
 * 某個語言會產生哪些標籤頁：只算可列出的文章（deprecated、taken-down 不進列表）。
 * 標籤頁本身、語言切換、文章的標籤連結都從這裡判斷，才不會連到沒產生的標籤頁。
 */
export function getTagPageGroups(posts: PostEntry[], lang: PostLang) {
  return groupPostsByTag(getListablePosts(posts, lang));
}

export function getTagPageNames(posts: PostEntry[], lang: PostLang): Set<string> {
  return new Set(getTagPageGroups(posts, lang).map(({ tag }) => tag));
}
