import { describe, expect, it } from 'vitest';

import middleware, { config } from '../middleware';
import {
  isCanonicalPostPath,
  negotiatePostRepresentation,
} from '../src/lib/post-content-negotiation';

describe('post content negotiation', () => {
  it.each([
    [null, 'html'],
    ['', 'html'],
    ['text/html', 'html'],
    ['*/*', 'html'],
    ['text/*', 'html'],
    ['application/markdown', 'html'],
    ['text/markdown', 'markdown'],
    ['text/markdown, text/html;q=0.9', 'markdown'],
    ['text/html;q=0.9, text/markdown;q=0.8', 'html'],
    ['text/html;q=0.8, text/markdown;q=0.8', 'html'],
    ['text/markdown;q=0', 'html'],
    ['*/*;q=1, text/markdown;q=0', 'html'],
    ['text/*;q=0.9, text/markdown;q=0.8', 'html'],
    ['text/html;q=0, text/markdown;q=0.8, */*;q=1', 'markdown'],
    ['TEXT/MARKDOWN;Q=1, TEXT/HTML;Q=0.5', 'markdown'],
    ['text/markdown;q=0.4, text/markdown;q=0.7, text/html;q=0.6', 'markdown'],
    ['text/markdown;q=1.001', 'html'],
    ['text/markdown;q=.5', 'html'],
    ['text/markdown;version=1', 'html'],
    ['text/markdown,', 'html'],
    ['*/markdown', 'html'],
  ] as const)('maps Accept %j to %s', (accept, expected) => {
    expect(negotiatePostRepresentation(accept)).toBe(expected);
  });

  it('bounds pathological Accept input', () => {
    expect(negotiatePostRepresentation('text/markdown,'.repeat(65))).toBe('html');
    expect(negotiatePostRepresentation(`text/markdown,${'x'.repeat(8192)}`)).toBe('html');
  });
});

describe('canonical post path scope', () => {
  it.each(['/posts/gp-1-fixture', '/en/posts/en-gp-1-fixture', '/posts/A1-valid'])(
    'accepts %s',
    (pathname) => {
      expect(isCanonicalPostPath(pathname)).toBe(true);
    }
  );

  it.each([
    '/posts/gp-1-fixture/',
    '/posts/gp-1-fixture.md',
    '/api/posts/gp-1-fixture.json',
    '/posts/nested/gp-1-fixture',
    '/posts/',
    '/en/posts',
    '/posts/gp_1',
    '/assets/post.png',
  ])('rejects %s', (pathname) => {
    expect(isCanonicalPostPath(pathname)).toBe(false);
  });
});

describe('Vercel Routing Middleware boundary', () => {
  it('keeps the matcher bounded to the two post namespaces', () => {
    expect(config.matcher).toEqual(['/posts/:path*', '/en/posts/:path*']);
  });

  it.each(['GET', 'HEAD'])('rewrites a Markdown-preferred %s and preserves query', (method) => {
    const response = middleware(
      new Request('https://gu-log.vercel.app/posts/gp-1-fixture?source=agent', {
        method,
        headers: { Accept: 'text/markdown, text/html;q=0.9' },
      })
    );

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://gu-log.vercel.app/posts/gp-1-fixture.md?source=agent'
    );
    expect(response.headers.get('vary')).toBe('Accept');
  });

  it('continues to HTML with Vary when Markdown does not win', () => {
    const response = middleware(
      new Request('https://gu-log.vercel.app/en/posts/en-gp-1-fixture', {
        headers: { Accept: 'text/html, text/markdown;q=0.5' },
      })
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('vary')).toBe('Accept');
  });

  it.each([
    ['POST', '/posts/gp-1-fixture'],
    ['GET', '/posts/gp-1-fixture/'],
    ['GET', '/posts/gp-1-fixture.md'],
    ['GET', '/api/posts/gp-1-fixture.json'],
  ])('does not alter an excluded %s %s request', (method, pathname) => {
    const response = middleware(
      new Request(`https://gu-log.vercel.app${pathname}`, {
        method,
        headers: { Accept: 'text/markdown' },
      })
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('vary')).toBeNull();
  });
});
