import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

export async function GET(_context: APIContext) {
  const posts = await getCollection('posts');

  const searchIndex = posts.map((post) => ({
    slug: post.slug,
    ticketId: post.data.ticketId || null,
    title: post.data.title,
    summary: post.data.summary,
    tags: post.data.tags || [],
    lang: post.data.lang,
    originalDate: post.data.originalDate,
    source: post.data.source,
  }));

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
