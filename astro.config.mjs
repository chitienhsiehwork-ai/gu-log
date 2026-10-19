// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import remarkKaomojiNowrap from './src/plugins/remark-kaomoji-nowrap.mjs';
import rehypePostLinks from './src/plugins/rehype-post-links.mjs';
import { listTakenDownPosts, normalizeSitePath } from './scripts/lib/taken-down-posts.mjs';

// 下架文章（openspec: post-takedown）保留網址、回 200 墓碑頁加 noindex，並從
// sitemap 移除；判斷只看 frontmatter 的 status。
const takenDownPaths = new Set(listTakenDownPosts().map((post) => post.path));

// https://astro.build/config
export default defineConfig({
  site: 'https://gu-log.vercel.app',
  // Astro 7 預設改成 'jsx'（會吃掉 inline 元素之間的空白）；維持 v6 的 HTML-aware 壓縮行為。
  compressHTML: true,
  integrations: [
    sitemap({ filter: (page) => !takenDownPaths.has(normalizeSitePath(page)) }),
    mdx(),
  ],
  markdown: {
    // Astro 7 預設改用 Sätteri；我們的 remark/rehype plugin 仍走 unified pipeline。
    processor: unified({
      remarkPlugins: [remarkKaomojiNowrap],
      rehypePlugins: [rehypePostLinks],
    }),
    shikiConfig: {
      themes: {
        light: 'solarized-light',
        dark: 'dracula-soft',
      },
      defaultColor: false,
    },
  },
});
