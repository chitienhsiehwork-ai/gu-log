import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = [
  'src/pages/gu-log-picks/[...page].astro',
  'src/pages/mogu-picks/[...page].astro',
  'src/pages/shroomdog-originals/[...page].astro',
  'src/pages/level-up/[...page].astro',
  'src/pages/en/gu-log-picks/[...page].astro',
  'src/pages/en/mogu-picks/[...page].astro',
  'src/pages/en/shroomdog-originals/[...page].astro',
  'src/pages/en/level-up/[...page].astro',
] as const;

describe('series pagination collection budget', () => {
  it.each(routes)(
    '%s enumerates the posts collection once and reuses it through props',
    (route) => {
      const source = readFileSync(route, 'utf8');
      const collectionCalls = source.match(/getCollection\(['"]posts['"]\)/g) ?? [];

      expect(collectionCalls).toHaveLength(1);
      expect(source).toMatch(/pageSize:\s*20/);
      expect(source).toMatch(/props:\s*\{[^}]*\ballPostsFull\b[^}]*\}/);
      expect(source).toMatch(/const \{\s*page,\s*allPostsFull\s*\} = Astro\.props/);
      expect(source).toMatch(/getPostStatus\([^,]+,\s*allPostsFull\)/);
    }
  );
});

describe('series listing locale isolation', () => {
  // 英文頁照中文頁複製時最容易忘了換語言：列出中文文章、連到 /en/posts/<中文 id>，
  // 點下去就 404。每個列表頁都要只列自己語言的文章、連到自己語言的文章頁。
  it.each(routes)('%s lists and links posts in its own locale', (route) => {
    const source = readFileSync(route, 'utf8');
    const isEnglish = route.startsWith('src/pages/en/');
    const lang = isEnglish ? 'en' : 'zh-tw';

    expect(source).toContain(`getListablePosts(allPostsFull, '${lang}')`);
    expect(source).toContain(`<Pagination page={page} lang="${lang}" />`);

    const postLinks = source.match(/href=\{`\/(?:en\/)?posts\//g) ?? [];
    expect(postLinks.length).toBeGreaterThan(0);
    for (const link of postLinks) {
      expect(link).toBe(isEnglish ? 'href={`/en/posts/' : 'href={`/posts/');
    }
  });
});
