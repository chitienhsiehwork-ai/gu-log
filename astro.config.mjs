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
  // Astro 6's HTML-aware whitespace handling preserved inline reader spacing.
  // Keep that behavior explicit across the Astro 7 default change to JSX rules.
  compressHTML: true,
  integrations: [sitemap(), mdx()],
  markdown: {
    // Astro 7 switched the default processor to Sätteri. Keep the existing
    // remark/rehype plugins on the supported unified processor so MD and MDX
    // rendering retains the kaomoji no-wrap and post-link transforms.
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
