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
