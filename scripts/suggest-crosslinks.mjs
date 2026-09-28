#!/usr/bin/env node
/**
 * suggest-crosslinks.mjs — Find related posts for cross-linking
 *
 * For each post, finds the top 3 most related posts (same language)
 * by tag overlap + title word similarity.
 *
 * Usage:
 *   node scripts/suggest-crosslinks.mjs                  # stdout JSON
 *   node scripts/suggest-crosslinks.mjs > suggestions.json
 *
 * inject-related-posts.mjs 直接 import 這裡的函式，替 posts/ 以外的檔案找相關文章。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const POSTS_DIR = path.join(__dirname, '../src/content/posts');

const TOP_N = 3;

// ─── Frontmatter parser (reused from validate-posts.mjs) ───────────
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const raw = match[1];

  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w[\w.]*?):\s*(.+)/);
    if (kv) {
      let val = kv[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      fm[kv[1]] = val;
    }
  }

  // Parse inline tags array: tags: ['a', 'b'] or tags: ["a", "b"]
  const tagsMatch = raw.match(/^tags:\s*\[(.*?)\]/ms);
  if (tagsMatch) {
    fm.tags = tagsMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/["']/g, ''))
      .filter(Boolean);
  } else {
    // Multi-line YAML list
    //   tags:
    //     - foo
    //     - bar
    const multiTagMatch = raw.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (multiTagMatch) {
      fm.tags = multiTagMatch[1]
        .split('\n')
        .map((l) =>
          l
            .replace(/^\s+-\s+/, '')
            .trim()
            .replace(/["']/g, '')
        )
        .filter(Boolean);
    }
  }

  return fm;
}

// ─── Similarity helpers ─────────────────────────────────────────────

/**
 * Tag overlap score: |intersection| / |union| (Jaccard)
 * Returns 0 if either post has no tags.
 */
function tagScore(tagsA, tagsB) {
  if (!tagsA?.length || !tagsB?.length) return 0;
  const setA = new Set(tagsA);
  const setB = new Set(tagsB);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Title word overlap (case-insensitive, handles EN and ZH).
 * Splits on spaces, punctuation, and CJK word boundaries.
 */
function titleScore(titleA, titleB) {
  const tokenize = (t) =>
    t
      .toLowerCase()
      .split(/[\s\p{P}\p{Z}：、，。！？「」【】]/u)
      .filter((w) => w.length > 1);

  const wordsA = new Set(tokenize(titleA));
  const wordsB = new Set(tokenize(titleB));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Combined relevance: 70% tag overlap, 30% title similarity.
 */
function relevance(postA, postB) {
  return 0.7 * tagScore(postA.tags, postB.tags) + 0.3 * titleScore(postA.title, postB.title);
}

// ─── Load all posts ─────────────────────────────────────────────────
/** 把一篇文章的 frontmatter 整理成比對用的資料；檔名決定 slug。 */
export function postInfo(filename, content) {
  const fm = parseFrontmatter(content);
  if (!fm) return null;

  const slug = filename.replace(/\.mdx$/, '');
  const lang = fm.lang || (filename.startsWith('en-') ? 'en' : 'zh-tw');

  return {
    file: filename,
    slug,
    ticketId: fm.ticketId || null,
    title: fm.title || slug,
    lang,
    tags: fm.tags || [],
  };
}

export function loadPosts(postsDir = POSTS_DIR) {
  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.mdx'));
  const posts = [];

  for (const filename of files) {
    const post = postInfo(filename, fs.readFileSync(path.join(postsDir, filename), 'utf-8'));
    if (post) posts.push(post);
  }

  return posts;
}

/**
 * 一篇文章的前 N 篇相關文章（同語言）。文章本身不算候選：同 slug，或在 posts/ 以外
 * （例如 pipeline 工作目錄裡的草稿）但 ticket 已配號、跟語料裡的某篇是同一篇。
 */
export function suggestFor(post, posts) {
  const allocated = post.ticketId && !/-PENDING$/.test(post.ticketId) ? post.ticketId : null;
  const candidates = posts.filter(
    (p) => p.lang === post.lang && p.slug !== post.slug && !(allocated && p.ticketId === allocated)
  );

  // Score all candidates
  const scored = candidates.map((candidate) => ({
    ticketId: candidate.ticketId,
    title: candidate.title,
    slug: candidate.slug,
    relevance: Math.round(relevance(post, candidate) * 1000) / 1000,
  }));

  // Sort descending, take top N with score > 0
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.filter((s) => s.relevance > 0).slice(0, TOP_N);
}

// ─── Main ───────────────────────────────────────────────────────────
function main() {
  const posts = loadPosts();
  process.stderr.write(`Loaded ${posts.length} posts\n`);

  const suggestions = posts.map((post) => ({
    file: post.file,
    slug: post.slug,
    lang: post.lang,
    suggestedLinks: suggestFor(post, posts),
  }));

  process.stdout.write(JSON.stringify(suggestions, null, 2) + '\n');
  process.stderr.write(
    `Done. ${suggestions.filter((s) => s.suggestedLinks.length > 0).length} posts have suggestions.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
