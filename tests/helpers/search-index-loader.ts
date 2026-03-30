/**
 * Loads the real search index from MDX frontmatter.
 * This mirrors what search-index.zh-tw.json.ts / search-index.en.json.ts do at build time,
 * but reads directly from the filesystem so tests don't need a running server.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import type { SearchEntry } from '../../src/config/fuse-options';

const POSTS_DIR = join(import.meta.dirname, '../../src/content/posts');

export async function getSearchIndex(): Promise<{
  zhIndex: SearchEntry[];
  enIndex: SearchEntry[];
}> {
  const files = await readdir(POSTS_DIR);
  const mdxFiles = files.filter((f) => f.endsWith('.mdx'));

  const zhIndex: SearchEntry[] = [];
  const enIndex: SearchEntry[] = [];

  for (const file of mdxFiles) {
    const content = await readFile(join(POSTS_DIR, file), 'utf-8');
    const { data } = matter(content);

    const entry: SearchEntry = {
      slug: file.replace(/\.mdx$/, ''),
      ticketId: data.ticketId || null,
      title: data.title || '',
      summary: data.summary || '',
      tags: data.tags || [],
      lang: data.lang || 'zh-tw',
      date: data.originalDate || '',
      source: data.source || '',
    };

    if (entry.lang === 'zh-tw') {
      zhIndex.push(entry);
    } else if (entry.lang === 'en') {
      enIndex.push(entry);
    }
  }

  return { zhIndex, enIndex };
}
