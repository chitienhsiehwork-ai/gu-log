import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

/**
 * Individual article endpoint for gu-log iOS app.
 *
 * Returns full rendered HTML content for a single post,
 * along with its metadata. The iOS app can render this
 * in a WKWebView or extract text for native rendering.
 *
 * URL: /api/posts/{slug}.json
 */
export async function getStaticPaths() {
  const posts = await getCollection('posts');

  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

export async function GET(context: APIContext) {
  const { post } = context.props as { post: Awaited<ReturnType<typeof getCollection>>[number] };
  const { Content, headings } = await (post as any).render();

  // We can't easily serialize the Content component to HTML in a static endpoint,
  // so we provide the raw MDX body + headings. The app can render markdown natively.
  return new Response(
    JSON.stringify({
      slug: post.slug,
      ticketId: post.data.ticketId || null,
      title: post.data.title,
      summary: post.data.summary,
      tags: post.data.tags || [],
      lang: post.data.lang,
      originalDate: post.data.originalDate,
      translatedDate: post.data.translatedDate || null,
      source: post.data.source,
      sourceUrl: post.data.sourceUrl,
      translatedBy: post.data.translatedBy || null,
      headings,
      // Raw body: everything after the frontmatter closing ---
      body: post.body,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // 1 hour CDN cache
      },
    },
  );
}
