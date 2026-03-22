#!/usr/bin/env node
/**
 * post-health.mjs — Post health audit: rating, staleness, retire candidates
 *
 * Usage:
 *   node scripts/post-health.mjs                    # Full report
 *   node scripts/post-health.mjs --retire-candidates # Only show retire candidates
 *   node scripts/post-health.mjs --unscored          # Only show unscored posts
 */

import fs from 'fs';
import path from 'path';

const POSTS_DIR = 'src/content/posts';
const PROGRESS_FILE = 'scripts/ralph-progress.json';

const args = process.argv.slice(2);
const RETIRE_ONLY = args.includes('--retire-candidates');
const UNSCORED_ONLY = args.includes('--unscored');

// Load Ralph scores
const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
const scored = progress.posts;

// Parse all zh-tw posts
const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'));

const posts = files.map((file) => {
  const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
  const fm = {};

  const ticketMatch = content.match(/ticketId:\s*"([^"]+)"/);
  const titleMatch = content.match(/title:\s*"([^"]+)"/);
  const dateMatch = content.match(/(?:originalDate|date):\s*"([^"]+)"/);
  const tagsMatch = content.match(/tags:\s*\[(.*?)\]/s);

  fm.ticketId = ticketMatch?.[1] || 'unknown';
  fm.title = titleMatch?.[1] || file;
  fm.date = dateMatch?.[1] || '1970-01-01';
  fm.tags = tagsMatch?.[1]?.match(/"([^"]+)"/g)?.map((t) => t.replace(/"/g, '')) || [];

  const score = scored[file];
  const daysSincePublish = Math.floor((Date.now() - new Date(fm.date).getTime()) / 86400000);

  // Internal links count
  const internalLinks = (content.match(/\/posts\//g) || []).length;

  // Word count (rough)
  const bodyStart = content.indexOf('---', content.indexOf('---') + 3) + 3;
  const body = content.slice(bodyStart);
  const wordCount = body
    .replace(/<[^>]+>/g, '')
    .replace(/import.*\n/g, '')
    .trim()
    .split(/\s+/).length;

  return {
    file,
    ...fm,
    score: score?.scores || null,
    scoreStatus: score?.status || 'UNSCORED',
    attempts: score?.attempts || 0,
    daysSincePublish,
    internalLinks,
    wordCount,
  };
});

// Retire criteria:
// 1. Score 0/0/0 (scorer gave up or couldn't score)
// 2. All dimensions < 7 after max attempts
// 3. Word count < 100 (stub articles)
// 4. Age > 60 days AND score < 7/7/7 AND no internal links
const retireCandidates = posts.filter((p) => {
  if (!p.score) return false;
  const { persona, clawdNote, vibe } = p.score;
  if (persona === 0 && clawdNote === 0 && vibe === 0) return true;
  if (persona < 7 && clawdNote < 7 && vibe < 7) return true;
  if (p.wordCount < 100) return true;
  return false;
});

const unscored = posts.filter((p) => p.scoreStatus === 'UNSCORED');

if (UNSCORED_ONLY) {
  console.log(`=== Unscored Posts (${unscored.length}) ===\n`);
  unscored.forEach((p) => console.log(`  ${p.ticketId.padEnd(8)} ${p.file}`));
  process.exit(0);
}

if (RETIRE_ONLY) {
  console.log(`=== Retire Candidates (${retireCandidates.length}) ===\n`);
  retireCandidates.forEach((p) => {
    const s = p.score;
    console.log(
      `  ${p.ticketId.padEnd(8)} ${s.persona}/${s.clawdNote}/${s.vibe}  ${p.title.slice(0, 60)}`
    );
  });
  process.exit(0);
}

// Full report
console.log('=== gu-log Post Health Report ===\n');
console.log(`Total zh-tw posts: ${posts.length}`);
console.log(`Scored: ${posts.length - unscored.length}`);
console.log(`Unscored: ${unscored.length}`);

const scored9 = posts.filter(
  (p) => p.score && p.score.persona >= 9 && p.score.clawdNote >= 9 && p.score.vibe >= 9
);
const scored8 = posts.filter(
  (p) =>
    p.score &&
    p.score.persona >= 8 &&
    p.score.clawdNote >= 8 &&
    p.score.vibe >= 8 &&
    !(p.score.persona >= 9 && p.score.clawdNote >= 9 && p.score.vibe >= 9)
);
const below8 = posts.filter(
  (p) => p.score && (p.score.persona < 8 || p.score.clawdNote < 8 || p.score.vibe < 8)
);

console.log(`\nScore distribution:`);
console.log(`  ≥ 9/9/9 (excellent): ${scored9.length}`);
console.log(`  ≥ 8/8/8 (good): ${scored8.length}`);
console.log(`  < 8 on any dim: ${below8.length}`);

console.log(`\nRetire candidates: ${retireCandidates.length}`);
retireCandidates.forEach((p) => {
  const s = p.score;
  console.log(
    `  ${p.ticketId.padEnd(8)} ${s.persona}/${s.clawdNote}/${s.vibe}  ${p.title.slice(0, 60)}`
  );
});

console.log(`\nUnscored posts: ${unscored.length}`);
unscored.forEach((p) => console.log(`  ${p.ticketId.padEnd(8)} ${p.file}`));

// Cross-link stats
const withLinks = posts.filter((p) => p.internalLinks > 0);
console.log(
  `\nInternal links: ${withLinks.length}/${posts.length} posts have cross-references (${Math.round((withLinks.length / posts.length) * 100)}%)`
);
