import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

export async function GET(context: APIContext) {
  // Get all zh-tw posts from content collections
  const posts = await getCollection('posts', ({ data }) => data.lang === 'zh-tw');

  // Sort by translatedDate descending (when article was added to the blog)
  const sortedPosts = posts.sort((a, b) => {
    const dateA = a.data.translatedDate || a.data.originalDate;
    const dateB = b.data.translatedDate || b.data.originalDate;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  return rss({
    title: '香菇大狗狗 - ShroomDog',
    description: '精選外文好文，翻譯成繁體中文。每篇都附原文連結。',
    site: context.site!,
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      link: `/posts/${post.slug}`,
      pubDate: new Date(post.data.translatedDate || post.data.originalDate),
      description: post.data.summary,
    })),
    customData: '<language>zh-TW</language>',
  });
}
