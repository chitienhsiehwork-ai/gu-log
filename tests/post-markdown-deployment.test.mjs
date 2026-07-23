import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markdownAlternateUrls,
  parseMarkdownFrontmatter,
} from '../scripts/verify-post-markdown-deployment.mjs';

test('finds only Markdown alternate links regardless of attribute order', () => {
  const html = `
    <link href="/rss.xml" rel="alternate" type="application/rss+xml">
    <link type="text/markdown" href="https://gu-log.vercel.app/posts/gp-1.md" rel="alternate">
    <link rel="canonical" href="https://gu-log.vercel.app/posts/gp-1">
  `;
  assert.deepEqual(markdownAlternateUrls(html), ['https://gu-log.vercel.app/posts/gp-1.md']);
});

test('parses the versioned Markdown YAML frontmatter', () => {
  assert.deepEqual(
    parseMarkdownFrontmatter(`---
schemaVersion: 1
slug: gp-1
author: null
---

# Fixture
`),
    { schemaVersion: 1, slug: 'gp-1', author: null }
  );
});

test('fails closed when Markdown frontmatter is missing', () => {
  assert.throws(() => parseMarkdownFrontmatter('# Fixture\n'), /frontmatter is missing/);
});
