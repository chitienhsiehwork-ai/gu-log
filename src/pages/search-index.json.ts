import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

function extractPlainText(body: string): string {
  return body
    .replace(/^---[\s\S]*?---/, '') // strip frontmatter (safety)
    .replace(/<[^>]+>/g, ' ') // strip HTML/JSX tags
    .replace(/import\s+.*?from\s+['"][^'"]+['"]/g, '') // strip MDX imports
    .replace(/export\s+.*?;/g, '') // strip MDX exports
    .replace(/[#*`~[\]|>]/g, '') // strip markdown syntax chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export async function GET(_context: APIContext) {
  const posts = await getCollection('posts');

  const searchIndex = posts.map((post) => ({
    slug: post.slug,
    ticketId: post.data.ticketId || null,
    title: post.data.title,
    summary: post.data.summary,
    tags: post.data.tags || [],
    lang: post.data.lang,
    date: post.data.originalDate,
    source: post.data.source,
    body: extractPlainText(post.body ?? ''),
  }));

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
