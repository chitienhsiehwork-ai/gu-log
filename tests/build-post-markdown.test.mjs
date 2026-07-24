import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertInputSlugSets } from '../scripts/build-post-markdown.mjs';

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
