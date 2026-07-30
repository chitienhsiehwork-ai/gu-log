import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const zhLegacyRoute = new URL('../src/pages/tags/[tag].astro', import.meta.url);
const zhPaginatedRoute = new URL('../src/pages/tags/[tag]/[...page].astro', import.meta.url);
const enLegacyRoute = new URL('../src/pages/en/tags/[tag].astro', import.meta.url);
const enPaginatedRoute = new URL('../src/pages/en/tags/[tag]/[...page].astro', import.meta.url);

describe('tag pagination budget', () => {
  it('uses nested optional-page routes instead of unbounded legacy routes', () => {
    expect(existsSync(zhLegacyRoute)).toBe(false);
    expect(existsSync(zhPaginatedRoute)).toBe(true);
    expect(existsSync(enLegacyRoute)).toBe(false);
    expect(existsSync(enPaginatedRoute)).toBe(true);
  });

  it('keeps Chinese tag pages bounded and locale-isolated', () => {
    const source = readFileSync(zhPaginatedRoute, 'utf8');

    expect(source).toContain("getListablePosts(allPostsFull, 'zh-tw')");
    expect(source).toContain('groupPostsByTag(allPosts)');
    expect(source).toMatch(/paginate\(tagPosts,\s*\{[\s\S]*?pageSize:\s*20/);
    expect(source).toMatch(/params:\s*\{\s*tag\s*\}/);
    expect(source).toMatch(/props:\s*\{\s*tag\s*\}/);
    expect(source).toContain('page.data.map');
    expect(source).toContain('page.total');
    expect(source).toContain('getPostStatus(post)');
    expect(source).toContain('<Pagination page={page} lang="zh-tw" />');
    expect(source).not.toContain('allPostsFull } = Astro.props');
    expect(source).not.toContain('posts.map');
  });

  it('keeps English tag pages bounded while preserving status inheritance', () => {
    const source = readFileSync(enPaginatedRoute, 'utf8');

    expect(source).toContain("getListablePosts(allPostsFull, 'en')");
    expect(source).toContain('groupPostsByTag(allPosts)');
    expect(source).toMatch(/paginate\(tagPosts,\s*\{[\s\S]*?pageSize:\s*20/);
    expect(source).toMatch(/params:\s*\{\s*tag\s*\}/);
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
