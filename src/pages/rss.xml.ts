import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

export async function GET(context: APIContext) {
  // Get all zh-tw posts from content collections
  const posts = await getCollection('posts', ({ data }) => data.lang === 'zh-tw');

  // Sort by originalDate descending
  const sortedPosts = posts.sort((a, b) => {
    return new Date(b.data.originalDate).getTime() - new Date(a.data.originalDate).getTime();
  });

  return rss({
    title: '香菇大狗狗 - ShroomDog',
    description: '精選外文好文，翻譯成繁體中文。每篇都附原文連結。',
    site: context.site!,
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      link: `/posts/${post.slug}`,
      pubDate: new Date(post.data.originalDate),
      description: post.data.summary,
    })),
    customData: '<language>zh-TW</language>',
  });
}
