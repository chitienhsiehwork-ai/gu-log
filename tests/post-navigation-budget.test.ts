import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = ['src/pages/posts/[...slug].astro', 'src/pages/en/posts/[...slug].astro'] as const;

describe('post route navigation budget', () => {
  it.each(routes)(
    '%s computes one route-level baseline instead of recalculating per page',
    (route) => {
      const source = readFileSync(route, 'utf8');

      expect(source).toContain('const navigationBaseline = createPostNavigationBaseline(allPosts,');
      expect(source).toContain(
        'navigablePosts: getNavigablePostsFromBaseline(navigationBaseline, post)'
      );
      expect(source).not.toContain('const navigablePosts = getNavigablePosts(allPosts, post);');
    }
  );
});
