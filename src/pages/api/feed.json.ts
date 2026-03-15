import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

/**
 * Static JSON feed for gu-log iOS app (and any other client).
 *
 * Returns all article metadata sorted by date (newest first).
 * Full article content is NOT included — fetch individual posts
 * via /api/posts/[slug].json for on-demand reading.
 *
 * Fields per article:
 *   slug, ticketId, prefix, title, summary, tags, lang,
 *   originalDate, translatedDate, source, sourceUrl,
 *   translatedBy (model info), url (relative link)
 */
export async function GET(_context: APIContext) {
  const posts = await getCollection('posts');

  // Derive prefix (SP/CP/Lv/SD) from ticketId
  const getPrefix = (ticketId?: string): string | null => {
    if (!ticketId) return null;
    const match = ticketId.match(/^(SP|CP|Lv|SD)-/);
    return match ? match[1] : null;
  };

  const feed = posts
    .map((post) => ({
      slug: post.slug,
      ticketId: post.data.ticketId || null,
      prefix: getPrefix(post.data.ticketId),
      title: post.data.title,
      summary: post.data.summary,
      tags: post.data.tags || [],
      lang: post.data.lang,
      originalDate: post.data.originalDate,
      translatedDate: post.data.translatedDate || null,
      source: post.data.source,
      sourceUrl: post.data.sourceUrl,
      translatedBy: post.data.translatedBy
        ? {
            model: post.data.translatedBy.model,
            harness: post.data.translatedBy.harness,
          }
        : null,
      url: `/posts/${post.slug}`,
    }))
    // Sort by most recent date (translatedDate preferred, fallback originalDate)
    .sort((a, b) => {
      const dateA = new Date(a.translatedDate || a.originalDate).getTime();
      const dateB = new Date(b.translatedDate || b.originalDate).getTime();
      return dateB - dateA;
    });

  return new Response(
    JSON.stringify({
      version: 1,
      generated: new Date().toISOString(),
      count: feed.length,
      articles: feed,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 min CDN cache
      },
    }
  );
}
