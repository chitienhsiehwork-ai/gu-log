import { describe, expect, it } from 'vitest';
import { getTagPageGroups, getTagPageNames } from '../src/utils/tag-pages';

type Posts = Parameters<typeof getTagPageNames>[0];

function post(
  id: string,
  ticketId: string,
  lang: 'zh-tw' | 'en',
  tags: string[],
  status?: 'deprecated' | 'taken-down'
) {
  return { id, data: { ticketId, lang, tags, status, originalDate: '2026-01-01' } };
}

describe('tag pages', () => {
  const posts = [
    post('mp-1-a', 'MP-1', 'zh-tw', ['shared', 'zh-only']),
    post('en-mp-1-a', 'MP-1', 'en', ['shared', 'en-only']),
    post('mp-2-b', 'MP-2', 'zh-tw', ['shared', 'deprecated-only'], 'deprecated'),
    post('en-mp-2-b', 'MP-2', 'en', ['deprecated-only']),
    post('gp-3-c', 'GP-3', 'zh-tw', ['taken-down-only'], 'taken-down'),
  ] as unknown as Posts;

  it('only builds tag pages from listable posts of one language', () => {
    expect([...getTagPageNames(posts, 'zh-tw')].sort()).toEqual(['shared', 'zh-only']);
    expect([...getTagPageNames(posts, 'en')].sort()).toEqual(['en-only', 'shared']);
  });

  it('keeps unlisted posts out of the tag page that does exist', () => {
    const shared = getTagPageGroups(posts, 'zh-tw').find(({ tag }) => tag === 'shared');
    expect(shared?.posts.map(({ id }) => id)).toEqual(['mp-1-a']);
  });
});
