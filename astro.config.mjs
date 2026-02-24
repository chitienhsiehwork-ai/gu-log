// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://gu-log.vercel.app',
  integrations: [
    sitemap(),
    mdx(),
    AstroPWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: '香菇大狗狗 — gu-log',
        short_name: 'gu-log',
        description: '香菇大狗狗的翻譯閱讀筆記 — ShroomDog & Clawd',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache: fonts, icons, offline page, manifest only
        // CSS/JS deliberately EXCLUDED — handled by runtime CacheFirst (assets-cache)
        // Reason: precacheAndRoute intercepts but doesn't fallback on cache eviction (iOS Safari)
        globPatterns: ['**/*.{svg,woff,woff2}', 'offline/index.html', 'manifest.webmanifest'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Disable auto-generated NavigationRoute — NetworkFirst runtimeCaching handles navigations
        navigateFallback: null,
        runtimeCaching: [
          {
            // Cache HTML pages as user browses (NetworkFirst = fresh when online, cached when offline)
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
              networkTimeoutSeconds: 3,
              plugins: [{
                // Serve /offline when both network and cache miss
                handlerDidError: async () => {
                  const cache = await caches.match('/offline', { ignoreSearch: true });
                  if (cache) return cache;
                  // Try precache key format
                  const keys = await caches.keys();
                  for (const name of keys) {
                    if (name.includes('precache')) {
                      const c = await caches.open(name);
                      const all = await c.keys();
                      const match = all.find(r => r.url.includes('/offline'));
                      if (match) return c.match(match);
                    }
                  }
                  return Response.error();
                },
              }],
            },
          },
          {
            // Fallback runtime cache for CSS/JS (belt-and-suspenders if precache fails on iOS)
            urlPattern: /\/_astro\/.*\.(?:css|js)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Cache images encountered while browsing
            urlPattern: /\.(?:png|jpg|jpeg|gif|webp|svg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'solarized-light',
        dark: 'solarized-dark',
      },
      defaultColor: false,
    },
  },
});
