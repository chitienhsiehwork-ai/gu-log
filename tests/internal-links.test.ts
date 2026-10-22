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
  it('keeps only internal <a href> values', () => {
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

  it('decodes numeric and named character references before reading the path', () => {
    const html = `<a href="/tags/R&#x26;D">hex</a><a href="/tags/R&#38;D/">dec</a>
      <a href="/q?a=&quot;b&quot;">quot</a><a href="/x&#x110000;">bad</a>`;
    expect(extractInternalAnchorHrefs(html)).toEqual([
      '/tags/R&D',
      '/tags/R&D/',
      '/q?a="b"',
      '/x&#x110000;',
    ]);
  });

  it('ignores markup that scripts build as strings', () => {
    const html = `<script>el.innerHTML = '<a href="/posts/' + slug + '">';</script><a href="/ok">`;
    expect(extractInternalAnchorHrefs(html)).toEqual(['/ok']);
  });

  it('skips scripts whatever the end tag looks like', () => {
    const html = [
      `<SCRIPT type="module">x('<a href="/a">')</SCRIPT ><a href="/b">`,
      `<script>y('<a href="/c">')</script foo="1"><a href="/d">`,
      `<scripts><a href="/e"></scripts>`,
      `<script>z('<a href="/f">')`,
    ].join('');
    expect(extractInternalAnchorHrefs(html)).toEqual(['/b', '/d', '/e']);
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

  async function writePage(page: string, html: string) {
    await mkdir(join(distDir, page, '..'), { recursive: true });
    await writeFile(join(distDir, page), html);
  }

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

  it('needs a file: a directory without index.html does not count', async () => {
    await mkdir(join(distDir, 'en', 'posts', 'en-a'), { recursive: true });
    await writeFile(join(distDir, 'en', 'posts', 'en-a', 'index.html'), '');
    expect(checkInternalLink('/', distDir)).toBe(true);
    expect(checkInternalLink('/en/posts/en-a', distDir)).toBe(true);
    expect(checkInternalLink('/en/posts', distDir)).toBe(false);
    expect(checkInternalLink('/en/posts/', distDir)).toBe(false);
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

  it('scans the nofollow 404 page but skips test fixture pages', async () => {
    const nofollow = '<meta name="robots" content="noindex, nofollow">';
    await writePage('404.html', `${nofollow}<a href="/en/404/">en</a>`);
    await writePage('artifacts/fake-fixture/index.html', `${nofollow}<a href="/posts/fake">x</a>`);
    const { pageCount, links } = await collectDistAnchorLinks(distDir);
    expect(pageCount).toBe(5);
    const urls = links.map((link) => link.url);
    expect(urls).toContain('/en/404/');
    expect(urls).not.toContain('/posts/fake');
  });
});
