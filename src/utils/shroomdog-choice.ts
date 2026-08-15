import type { CollectionEntry } from 'astro:content';
import {
  SHROOMDOG_CHOICE_TICKET_IDS,
  assertUniqueShroomDogChoiceTicketIds,
} from '../config/shroomdog-choice';
import { getIndexPosts, getPostStatus } from './post-status';

type PostEntry = CollectionEntry<'posts'>;
export type ShroomDogChoiceLocale = PostEntry['data']['lang'];

export function resolveShroomDogChoicePosts(
  posts: PostEntry[],
  locale: ShroomDogChoiceLocale,
  ticketIds: readonly string[] = SHROOMDOG_CHOICE_TICKET_IDS
): PostEntry[] {
  assertUniqueShroomDogChoiceTicketIds(ticketIds);

  const indexEligibleIds = new Set(getIndexPosts(posts, locale).map((post) => post.id));

  return ticketIds.flatMap((ticketId) => {
    const canonical = posts.find(
      (post) => post.data.ticketId === ticketId && post.data.lang === 'zh-tw'
    );
    const current = posts.find(
      (post) => post.data.ticketId === ticketId && post.data.lang === locale
    );

    if (
      !canonical ||
      !current ||
      !indexEligibleIds.has(current.id) ||
      getPostStatus(current, posts) !== 'published' ||
      canonical.data.unlisted ||
      current.data.unlisted
    ) {
      return [];
    }

    return [current];
  });
}
