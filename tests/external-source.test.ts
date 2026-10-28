import { describe, expect, it } from 'vitest';

import { isExternalSource } from '../scripts/lib/external-source.mjs';

describe('isExternalSource', () => {
  it.each([
    ['https://keeper-notes.test/posts/a', true],
    ['https://example.com/original-article', false],
    ['https://docs.example.org/x', false],
    ['https://gu-log.vercel.app/posts/mp-1', false],
    ['/posts/mp-1', false],
    ['https://chatgpt.com/share/abc', false],
    ['https://chatgpt.com/c/abc', true],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isExternalSource(url)).toBe(expected);
  });
});
