import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkInternalLink,
  collectDistAnchorLinks,
  extractInternalAnchorHrefs,
} from '../scripts/lib/internal-links.mjs';

describe('extractInternalAnchorHrefs', () => {
  it('keeps only internal <a href> values, decoding &amp;', () => {
    const html = `<a class="icon-btn" href="/en/tags/claude-code/">x</a>
      <a href='/posts/a?x=1&amp;y=2#top'>a</a><a href=/glossary>g</a>
      <a href="https://gu-log.vercel.app/about">abs</a>
      <a href="https://example.org/">ext</a><a href="#toc">frag</a>
      <a href="index.html">relative</a><link rel="canonical" href="/missing">`;
    expect(extractInternalAnchorHrefs(html)).toEqual([
      '/en/tags/claude-code/',
      '/posts/a?x=1&y=2#top',
      '/glossary',
      'https://gu-log.vercel.app/about',
    ]);
  });

  it('ignores markup that scripts build as strings', () => {
    const html = `<script>el.innerHTML = '<a href="/posts/' + slug + '">';</script><a href="/ok">`;
    expect(extractInternalAnchorHrefs(html)).toEqual(['/ok']);
  });

  it('skips nofollow pages such as fixtures with fake links', () => {
    const html = `<meta name="robots" content="noindex, nofollow"><a href="/posts/fixture-x">`;
    expect(extractInternalAnchorHrefs(html)).toEqual([]);
  });
});

describe('dist HTML link scan', () => {
  let root: string;
  let distDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gu-log-dist-links-'));
    distDir = join(root, 'dist');
    await mkdir(join(distDir, 'tags', 'Claude Code'), { recursive: true });
    await mkdir(join(distDir, 'tags', '斷詞'), { recursive: true });
    await mkdir(join(distDir, 'en'), { recursive: true });
    await writeFile(join(distDir, 'tags', 'Claude Code', 'index.html'), '<a href="/">home</a>');
    await writeFile(join(distDir, 'tags', '斷詞', 'index.html'), '<a href="/en/tags/斷詞/">en</a>');
    await writeFile(
      join(distDir, 'index.html'),
      '<a href="/tags/Claude Code">a</a><a href="/tags/%E6%96%B7%E8%A9%9E/">b</a>'
    );
    await writeFile(join(distDir, 'en', 'index.html'), '<a href="/">zh</a>');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves percent-encoded and raw non-ASCII paths against dist directories', () => {
    expect(checkInternalLink('/tags/Claude Code', distDir)).toBe(true);
    expect(checkInternalLink('/tags/Claude%20Code/', distDir)).toBe(true);
    expect(checkInternalLink('/tags/%E6%96%B7%E8%A9%9E/', distDir)).toBe(true);
    expect(checkInternalLink('/en/tags/斷詞/', distDir)).toBe(false);
    expect(checkInternalLink('/tags/%E0%A4%A', distDir)).toBe(false);
  });

  it('collects each internal URL once with the first page and a page count', async () => {
    const { pageCount, links } = await collectDistAnchorLinks(distDir);
    expect(pageCount).toBe(4);
    const byUrl = Object.fromEntries(links.map((link) => [link.url, link]));
    expect(byUrl['/']).toMatchObject({
      file: 'dist/en/index.html',
      context: '<a href> on 2 page(s)',
    });
    expect(byUrl['/en/tags/斷詞/']).toMatchObject({ file: 'dist/tags/斷詞/index.html' });
    const broken = links.filter((link) => !checkInternalLink(link.url, distDir));
    expect(broken.map((link) => link.url)).toEqual(['/en/tags/斷詞/']);
  });
});
