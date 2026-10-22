import type { CollectionEntry } from 'astro:content';
import { getListablePosts } from './post-status';
import { groupPostsByTag } from './tag-groups';

type PostEntry = CollectionEntry<'posts'>;
type PostLang = PostEntry['data']['lang'];

/** 某個語言會產生哪些標籤頁：只算 getListablePosts 收的文章。 */
export function getTagPageGroups(posts: PostEntry[], lang: PostLang) {
  return groupPostsByTag(getListablePosts(posts, lang));
}

export function getTagPageNames(posts: PostEntry[], lang: PostLang): Set<string> {
  return new Set(getTagPageGroups(posts, lang).map(({ tag }) => tag));
}
