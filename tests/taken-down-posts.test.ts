import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  listTakenDownPosts,
  normalizeSitePath,
  postIdFromFilename,
  postPathFor,
  readPostIndex,
  splitPostSource,
} from '../scripts/lib/taken-down-posts.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });

describe('taken-down post index (post-takedown)', () => {
  it('uses the lowercase canonical id even when the filename has capitals (GP-63)', () => {
    expect(postIdFromFilename('gp-63-20260214-GP63-benson-proxy-opus.mdx')).toBe(
      'gp-63-20260214-gp63-benson-proxy-opus'
    );
    expect(postPathFor({ id: 'gp-63-20260214-gp63-benson-proxy-opus', lang: 'zh-tw' })).toBe(
      '/posts/gp-63-20260214-gp63-benson-proxy-opus'
    );
    expect(postPathFor({ id: 'en-gp-63-20260214-gp63-benson-proxy-opus', lang: 'en' })).toBe(
      '/en/posts/en-gp-63-20260214-gp63-benson-proxy-opus'
    );
  });

  it('normalizes sitemap URLs and paths to comparable site paths', () => {
    expect(normalizeSitePath('https://gu-log.vercel.app/posts/gp-2-x/')).toBe('/posts/gp-2-x');
    expect(normalizeSitePath('/en/posts/en-gp-2-x?ref=feed#top')).toBe('/en/posts/en-gp-2-x');
    expect(normalizeSitePath('https://gu-log.vercel.app/')).toBe('/');
  });

  it('lists only posts whose frontmatter status is taken-down', () => {
    const dir = makeTempDirectory('gu-log-taken-down-');
    const write = (name: string, fm: string[], body = '') =>
      fs.writeFileSync(path.join(dir, name), `---\n${fm.join('\n')}\n---\n${body}`);
    write('gp-63-20260214-GP63-x.mdx', ['ticketId: "GP-63"', 'status: "taken-down"']);
    write('en-gp-63-20260214-GP63-x.mdx', ['ticketId: "GP-63"', 'lang: en', 'status: taken-down']);
    write('mp-5-20260101-y.mdx', ['ticketId: "MP-5"', 'status: "retired"'], 'body\n');
    write('gp-1-20260101-demo.mdx', ['ticketId: "GP-1"'], 'body\n');

    expect(readPostIndex(dir)).toHaveLength(4);
    expect(listTakenDownPosts(dir).map((post: { path: string }) => post.path)).toEqual([
      '/en/posts/en-gp-63-20260214-gp63-x',
      '/posts/gp-63-20260214-gp63-x',
    ]);
  });

  it('fails loudly on a post without frontmatter', () => {
    expect(() => splitPostSource('no frontmatter', 'x.mdx')).toThrow(/x\.mdx: frontmatter/);
  });
});
