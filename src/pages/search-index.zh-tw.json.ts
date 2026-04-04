import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { getPublishedPosts } from '../utils/post-status';

export async function GET(_context: APIContext) {
  const searchIndex = getPublishedPosts(await getCollection('posts'), 'zh-tw').map((post) => ({
    slug: post.slug,
    ticketId: post.data.ticketId || null,
    title: post.data.title,
    summary: post.data.summary,
    tags: post.data.tags || [],
    lang: post.data.lang,
    date: post.data.originalDate,
    source: post.data.source,
  }));

  return new Response(JSON.stringify(searchIndex), {
    headers: { 'Content-Type': 'application/json' },
  });
}
