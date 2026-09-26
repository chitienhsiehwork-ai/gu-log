// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import remarkKaomojiNowrap from './src/plugins/remark-kaomoji-nowrap.mjs';
import rehypePostLinks from './src/plugins/rehype-post-links.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://gu-log.vercel.app',
  // Astro 7 預設改成 'jsx'（會吃掉 inline 元素之間的空白）；維持 v6 的 HTML-aware 壓縮行為。
  compressHTML: true,
  integrations: [sitemap(), mdx()],
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
