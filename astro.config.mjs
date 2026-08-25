// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import remarkKaomojiNowrap from './src/plugins/remark-kaomoji-nowrap.mjs';
import rehypePostLinks from './src/plugins/rehype-post-links.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://gu-log.vercel.app',
  integrations: [sitemap(), mdx()],
  markdown: {
    remarkPlugins: [remarkKaomojiNowrap],
    rehypePlugins: [rehypePostLinks],
    shikiConfig: {
      themes: {
        light: 'solarized-light',
        dark: 'dracula-soft',
      },
      defaultColor: false,
    },
  },
});
