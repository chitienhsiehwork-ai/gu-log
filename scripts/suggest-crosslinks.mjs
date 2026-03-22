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
 *   node scripts/suggest-crosslinks.mjs --verbose        # include scores
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

const VERBOSE = process.argv.includes('--verbose');
const TOP_N = 3;

// ─── Frontmatter parser (reused from validate-posts.mjs) ───────────
function parseFrontmatter(content) {
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

function getBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
  return match ? match[1] : '';
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
function loadPosts() {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
  const posts = [];

  for (const filename of files) {
    const filepath = path.join(POSTS_DIR, filename);
    const content = fs.readFileSync(filepath, 'utf-8');
    const fm = parseFrontmatter(content);

    if (!fm) continue;

    const slug = filename.replace(/\.mdx$/, '');
    const lang = fm.lang || (filename.startsWith('en-') ? 'en' : 'zh-tw');

    posts.push({
      file: filename,
      slug,
      ticketId: fm.ticketId || null,
      title: fm.title || slug,
      lang,
      tags: fm.tags || [],
    });
  }

  return posts;
}

// ─── Main ───────────────────────────────────────────────────────────
const posts = loadPosts();
process.stderr.write(`Loaded ${posts.length} posts\n`);

// Group by lang for efficient lookup
const byLang = {};
for (const post of posts) {
  if (!byLang[post.lang]) byLang[post.lang] = [];
  byLang[post.lang].push(post);
}

const suggestions = [];

for (const post of posts) {
  const candidates = (byLang[post.lang] || []).filter((p) => p.slug !== post.slug);

  // Score all candidates
  const scored = candidates.map((candidate) => {
    const score = relevance(post, candidate);
    return {
      ticketId: candidate.ticketId,
      title: candidate.title,
      slug: candidate.slug,
      ...(VERBOSE
        ? { relevance: Math.round(score * 1000) / 1000 }
        : { relevance: Math.round(score * 1000) / 1000 }),
    };
  });

  // Sort descending, take top N with score > 0
  scored.sort((a, b) => b.relevance - a.relevance);
  const top = scored.filter((s) => s.relevance > 0).slice(0, TOP_N);

  suggestions.push({
    file: post.file,
    slug: post.slug,
    lang: post.lang,
    suggestedLinks: top,
  });
}

process.stdout.write(JSON.stringify(suggestions, null, 2) + '\n');
process.stderr.write(
  `Done. ${suggestions.filter((s) => s.suggestedLinks.length > 0).length} posts have suggestions.\n`
);
