import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

/**
 * Strip MDX-specific syntax from raw post body so we index plain text only.
 * Astro's post.body already excludes frontmatter.
 */
function stripMdx(raw: string): string {
  return (
    raw
      // Remove import statements
      .replace(/^import\s+[^\n]+\n/gm, '')
      // Remove JSX component blocks (multiline, e.g. <ClawdNote>...</ClawdNote>)
      .replace(/<[A-Z][A-Za-z]*[^>]*>[\s\S]*?<\/[A-Z][A-Za-z]*>/gm, '')
      // Remove self-closing JSX tags (e.g. <Mermaid ... />)
      .replace(/<[A-Z][A-Za-z]*[^/]*\/>/gm, '')
      // Remove fenced code blocks
      .replace(/```[\s\S]*?```/gm, '')
      // Remove inline code
      .replace(/`[^`]*`/g, '')
      // Remove markdown headings marker
      .replace(/^#{1,6}\s+/gm, '')
      // Unwrap bold/italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      // Remove horizontal rules
      .replace(/^---+$/gm, '')
      // Remove link syntax but keep display text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
      // Truncate to keep index lean (~2 000 chars is plenty for Fuse)
      .slice(0, 2000)
  );
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
    body: stripMdx(post.body || ''),
  }));

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
