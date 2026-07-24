#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  serializeMarkdownArtifact,
  writeMarkdownArtifactAtomically,
} from './lib/post-markdown-exporter.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const DIST_DIR = path.join(ROOT, 'dist');
const JSON_DIR = path.join(DIST_DIR, 'api/posts');
const SITE_ORIGIN = 'https://gu-log.vercel.app';

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function describeSetDifference(label, expected, actual) {
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  const extra = [...actual].filter((value) => !expected.has(value)).sort();
  return `${label}: missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`;
}

async function fileSlugs(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name.slice(0, -extension.length))
  );
}

async function sourceFilesBySlug(postsDir) {
  const entries = await fs.readdir(postsDir, { withFileTypes: true });
  const files = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
    const slug = entry.name.slice(0, -'.mdx'.length).toLowerCase();
    if (files.has(slug)) {
      throw new Error(
        `case-insensitive source slug collision: ${files.get(slug)} and ${entry.name}`
      );
    }
    files.set(slug, entry.name);
  }
  return files;
}

async function htmlSlugs(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const slugs = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const stat = await fs.stat(path.join(directory, entry.name, 'index.html'));
      if (stat.isFile()) slugs.add(entry.name);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return slugs;
}

export async function assertInputSlugSets({
  postsDir = POSTS_DIR,
  distDir = DIST_DIR,
  jsonDir = JSON_DIR,
} = {}) {
  const sourceFiles = await sourceFilesBySlug(postsDir);
  const source = new Set(sourceFiles.keys());
  const json = await fileSlugs(jsonDir, '.json');
  const zhHtml = await htmlSlugs(path.join(distDir, 'posts'));
  const enHtml = await htmlSlugs(path.join(distDir, 'en/posts'));
  const html = new Set([...zhHtml, ...enHtml]);

  const errors = [];
  if (!sameSet(source, json)) {
    errors.push(describeSetDifference('source/json slug mismatch', source, json));
  }
  if (!sameSet(source, html)) {
    errors.push(describeSetDifference('source/html slug mismatch', source, html));
  }
  const overlap = [...zhHtml].filter((slug) => enHtml.has(slug));
  if (overlap.length > 0) {
    errors.push(`zh/en HTML slug collision: ${overlap.sort().join(', ')}`);
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { source, sourceFiles, json, html, zhHtml, enHtml };
}

async function markdownSlugs(distDir) {
  const zh = await fileSlugs(path.join(distDir, 'posts'), '.md');
  const en = await fileSlugs(path.join(distDir, 'en/posts'), '.md');
  return { zh, en, all: new Set([...zh, ...en]) };
}

export async function buildPostMarkdown({
  postsDir = POSTS_DIR,
  distDir = DIST_DIR,
  jsonDir = JSON_DIR,
  siteOrigin = SITE_ORIGIN,
} = {}) {
  const inputs = await assertInputSlugSets({ postsDir, distDir, jsonDir });
  const stagingDir = path.join(distDir, `.post-markdown-staging-${process.pid}-${Date.now()}`);
  const inventory = {
    components: new Set(),
    nativeElements: new Set(),
    expressionForms: new Set(),
  };
  const artifacts = [];

  try {
    for (const slug of [...inputs.source].sort()) {
      const sourcePath = path.join(postsDir, inputs.sourceFiles.get(slug));
      const jsonPath = path.join(jsonDir, `${slug}.json`);
      const [rawMdx, jsonText] = await Promise.all([
        fs.readFile(sourcePath, 'utf8'),
        fs.readFile(jsonPath, 'utf8'),
      ]);
      const postJson = JSON.parse(jsonText);
      if (postJson.slug !== slug) {
        throw new Error(
          `${slug}: JSON slug ${JSON.stringify(postJson.slug)} does not match filename`
        );
      }
      if (!['zh-tw', 'en'].includes(postJson.lang)) {
        throw new Error(`${slug}: unsupported JSON lang ${JSON.stringify(postJson.lang)}`);
      }

      const languageRoot = postJson.lang === 'en' ? 'en/posts' : 'posts';
      const htmlPath = path.join(distDir, languageRoot, slug, 'index.html');
      const html = await fs.readFile(htmlPath, 'utf8');
      const result = serializeMarkdownArtifact({
        rawMdx,
        postJson,
        html,
        siteOrigin,
        sourceName: path.relative(ROOT, sourcePath),
      });
      if (result.markdown.trim().length === 0) {
        throw new Error(`${slug}: generated Markdown is empty`);
      }
      for (const name of result.inventory.components) inventory.components.add(name);
      for (const name of result.inventory.nativeElements) inventory.nativeElements.add(name);
      for (const name of result.inventory.expressionForms) inventory.expressionForms.add(name);

      const stagedPath = path.join(stagingDir, languageRoot, `${slug}.md`);
      await writeMarkdownArtifactAtomically(stagedPath, result.markdown);
      artifacts.push({
        slug,
        stagedPath,
        outputPath: path.join(distDir, languageRoot, `${slug}.md`),
      });
    }

    for (const artifact of artifacts) {
      await writeMarkdownArtifactAtomically(
        artifact.outputPath,
        await fs.readFile(artifact.stagedPath, 'utf8')
      );
    }

    const markdown = await markdownSlugs(distDir);
    if (!sameSet(inputs.source, markdown.all)) {
      throw new Error(
        describeSetDifference('source/Markdown slug mismatch', inputs.source, markdown.all)
      );
    }
    if (!sameSet(inputs.zhHtml, markdown.zh) || !sameSet(inputs.enHtml, markdown.en)) {
      throw new Error('Markdown language path sets do not match their canonical HTML path sets');
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  const summary = {
    artifacts: artifacts.length,
    components: [...inventory.components].sort(),
    nativeElements: [...inventory.nativeElements].sort(),
    expressionForms: [...inventory.expressionForms].sort(),
  };
  console.log(`Markdown artifacts: ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildPostMarkdown().catch((error) => {
    console.error(`Markdown artifact build failed: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
