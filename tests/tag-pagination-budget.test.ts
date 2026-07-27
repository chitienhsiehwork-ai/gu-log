import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const legacyRoute = new URL('../src/pages/en/tags/[tag].astro', import.meta.url);
const paginatedRoute = new URL('../src/pages/en/tags/[tag]/[...page].astro', import.meta.url);

describe('English tag pagination budget', () => {
  it('uses the nested optional-page route instead of the unbounded legacy route', () => {
    expect(existsSync(legacyRoute)).toBe(false);
    expect(existsSync(paginatedRoute)).toBe(true);
  });

  it('keeps each static page bounded while preserving English status inheritance', () => {
    const source = readFileSync(paginatedRoute, 'utf8');

    expect(source).toMatch(/paginate\(tagPosts,\s*\{[\s\S]*?pageSize:\s*20/);
    expect(source).toMatch(/props:\s*\{\s*tag,\s*allPostsFull\s*\}/);
    expect(source).toMatch(/const \{\s*page,\s*tag,\s*allPostsFull\s*\} = Astro\.props/);
    expect(source).toContain('page.data.map');
    expect(source).toContain('page.total');
    expect(source).toContain('getPostStatus(post, allPostsFull)');
    expect(source).toContain('<Pagination page={page} lang="en" />');
    expect(source).not.toContain('posts.map');
    expect(source).not.toMatch(/props:\s*\{\s*tag,\s*posts:/);
  });
});
