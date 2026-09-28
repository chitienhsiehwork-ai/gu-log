import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertInputSlugSets, buildPostMarkdown } from '../scripts/build-post-markdown.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gu-log-post-markdown-build-'));
  const postsDir = path.join(root, 'src/content/posts');
  const distDir = path.join(root, 'dist');
  const jsonDir = path.join(distDir, 'api/posts');
  await Promise.all([
    fs.mkdir(postsDir, { recursive: true }),
    fs.mkdir(jsonDir, { recursive: true }),
    fs.mkdir(path.join(distDir, 'posts'), { recursive: true }),
    fs.mkdir(path.join(distDir, 'en/posts'), { recursive: true }),
  ]);
  return {
    root,
    postsDir,
    distDir,
    jsonDir,
    async addPost({ filename, slug, lang }) {
      const languageRoot = lang === 'en' ? 'en/posts' : 'posts';
      await Promise.all([
        fs.writeFile(path.join(postsDir, filename), '---\ntitle: fixture\n---\n\nBody\n'),
        fs.writeFile(path.join(jsonDir, `${slug}.json`), '{}'),
        fs
          .mkdir(path.join(distDir, languageRoot, slug), { recursive: true })
          .then(() =>
            fs.writeFile(path.join(distDir, languageRoot, slug, 'index.html'), '<html></html>')
          ),
      ]);
    },
  };
}

test('input completeness uses Astro-compatible lowercase source slugs', async (t) => {
  const env = await fixture();
  t.after(() => fs.rm(env.root, { recursive: true, force: true }));
  await env.addPost({
    filename: 'GP-63-Mixed-Case.mdx',
    slug: 'gp-63-mixed-case',
    lang: 'zh-tw',
  });
  await env.addPost({
    filename: 'en-gp-63-Mixed-Case.mdx',
    slug: 'en-gp-63-mixed-case',
    lang: 'en',
  });

  const result = await assertInputSlugSets(env);
  assert.deepEqual([...result.source].sort(), ['en-gp-63-mixed-case', 'gp-63-mixed-case']);
  assert.equal(result.sourceFiles.get('gp-63-mixed-case'), 'GP-63-Mixed-Case.mdx');
});

test('input completeness fails closed on a missing JSON representation', async (t) => {
  const env = await fixture();
  t.after(() => fs.rm(env.root, { recursive: true, force: true }));
  await env.addPost({ filename: 'gp-1.mdx', slug: 'gp-1', lang: 'zh-tw' });
  await fs.rm(path.join(env.jsonDir, 'gp-1.json'));

  await assert.rejects(() => assertInputSlugSets(env), /source\/json slug mismatch/);
});

test('a taken-down post still gets a tombstone Markdown artifact in the same slug set', async (t) => {
  const env = await fixture();
  t.after(() => fs.rm(env.root, { recursive: true, force: true }));
  const slug = 'gp-63-20260214-gp63-fixture';
  const raw = `---
ticketId: GP-63
title: Fixture title
summary: "這篇翻譯已下架。"
originalDate: "2026-02-10"
translatedDate: "2026-02-14"
source: Fixture source
sourceUrl: https://example.com/source
lang: zh-tw
status: taken-down
takenDownAt: "2026-09-27"
sourceTitle: Original fixture title
---
`;
  const json = {
    schemaVersion: 2,
    slug,
    ticketId: 'GP-63',
    url: `/posts/${slug}`,
    title: 'Fixture title',
    summary: '這篇翻譯已下架。',
    tags: [],
    lang: 'zh-tw',
    originalDate: '2026-02-10',
    translatedDate: '2026-02-14',
    source: 'Fixture source',
    sourceUrl: 'https://example.com/source',
    authorshipNote: null,
    translatedBy: null,
    headings: [],
    body: '',
  };
  const html = `<!doctype html><html><head>
<meta name="robots" content="noindex">
<link rel="alternate" type="text/markdown" href="https://gu-log.vercel.app/posts/${slug}.md" data-post-markdown-alternate>
</head><body>
<article data-post-representation data-post-slug="${slug}" data-post-lang="zh-tw" data-post-status="taken-down" data-replacement-ticket-id="" data-replacement-url="">
<div data-post-tombstone data-tombstone-series="GP"><span>Original fixture title</span></div>
</article></body></html>`;
  await fs.writeFile(path.join(env.postsDir, 'gp-63-20260214-GP63-fixture.mdx'), raw);
  await fs.writeFile(path.join(env.jsonDir, `${slug}.json`), JSON.stringify(json));
  await fs.mkdir(path.join(env.distDir, 'posts', slug), { recursive: true });
  await fs.writeFile(path.join(env.distDir, 'posts', slug, 'index.html'), html);

  const summary = await buildPostMarkdown(env);
  assert.equal(summary.artifacts, 1);
  const markdown = await fs.readFile(path.join(env.distDir, 'posts', `${slug}.md`), 'utf8');
  assert.match(markdown, /^status: taken-down$/m);
  assert.match(markdown, /^\[去讀原文 →\]\(https:\/\/example\.com\/source\)$/m);
  assert.match(markdown, /^Original fixture title$/m);
  assert.match(markdown, /^example\.com$/m);
});
