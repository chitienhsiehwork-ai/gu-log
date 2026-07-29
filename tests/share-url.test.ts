import { describe, expect, it } from 'vitest';

import { getShareUrl } from '../src/components/share-url';

describe('getShareUrl', () => {
  it.each([
    {
      name: 'zh-tw preview',
      canonical:
        'https://gu-log.vercel.app/posts/gp-24-20260204-claude-is-a-space-to-think?token=secret#access-token',
      current:
        'https://preview.example/posts/gp-24-20260204-claude-is-a-space-to-think?token=secret#access-token',
      expected: 'https://gu-log.vercel.app/posts/gp-24-20260204-claude-is-a-space-to-think',
    },
    {
      name: 'English preview',
      canonical: 'https://gu-log.vercel.app/en/posts/gp-24-example/',
      current: 'https://preview.example/en/posts/gp-24-example?utm_source=private#section',
      expected: 'https://gu-log.vercel.app/en/posts/gp-24-example',
    },
    {
      name: 'site root',
      canonical: 'https://gu-log.vercel.app/?utm_source=private#section',
      current: 'https://preview.example/?token=secret#access-token',
      expected: 'https://gu-log.vercel.app/',
    },
  ])('uses the clean production canonical for $name', ({ canonical, current, expected }) => {
    expect(getShareUrl(canonical, current)).toBe(expected);
  });

  it.each([
    null,
    '',
    'javascript:alert(1)',
    'data:text/plain,secret',
    '//evil.example/posts/gp-24',
    'https://user:password@gu-log.vercel.app/posts/gp-24',
    ' https://gu-log.vercel.app/posts/gp-24',
    'https://gu-log.vercel.app\\@evil.example/posts/gp-24',
    'https://[',
  ])('falls back to the clean current page for unsafe canonical %s', (canonical) => {
    expect(
      getShareUrl(
        canonical,
        'https://preview.example/en/posts/gp-24-example/?token=secret#access-token'
      )
    ).toBe('https://preview.example/en/posts/gp-24-example');
  });

  it('throws instead of emitting a non-HTTP fallback URL', () => {
    expect(() => getShareUrl(null, 'file:///tmp/private?token=secret#access-token')).toThrow(
      'Share URL requires an absolute HTTP(S) page URL'
    );
  });
});
