import type { APIContext } from 'astro';
import { getCollection, render, type CollectionEntry } from 'astro:content';
import { getPostAuthorshipNote } from '../../../utils/post-authorship-notes';

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
    params: { slug: post.id },
    props: { post },
  }));
}

export async function GET(_context: APIContext) {
  const { post } = _context.props as { post: CollectionEntry<'posts'> };
  const { Content: _Content, headings } = await render(post);

  // We can't easily serialize the Content component to HTML in a static endpoint,
  // so we provide the raw MDX body + headings. The app can render markdown natively.
  return new Response(
    JSON.stringify({
      slug: post.id,
      ticketId: post.data.ticketId || null,
      title: post.data.title,
      summary: post.data.summary,
      tags: post.data.tags || [],
      lang: post.data.lang,
      originalDate: post.data.originalDate,
      translatedDate: post.data.translatedDate || null,
      source: post.data.source,
      sourceUrl: post.data.sourceUrl,
      authorshipNote: getPostAuthorshipNote(post.id, post.data.lang),
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
    }
  );
}
