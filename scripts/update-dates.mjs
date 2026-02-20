#!/usr/bin/env node
// Script to update posts from `date` to `originalDate`/`translatedDate`/`translatedBy`

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const POSTS_DIR = './src/content/posts';

// Twitter snowflake epoch (2010-11-04 01:42:54.657 UTC)
const TWITTER_EPOCH = 1288834974657n;

function extractDateFromTwitterId(tweetId) {
  try {
    const id = BigInt(tweetId);
    const timestamp = Number((id >> 22n) + TWITTER_EPOCH);
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch (e) {
    return null;
  }
}

function extractDateFromUrl(url) {
  // Pattern: /YYYY/MM/DD/ or /YYYY-MM-DD/
  const datePattern1 = /\/(\d{4})\/(\d{2})\/(\d{2})\//;
  const match1 = url.match(datePattern1);
  if (match1) {
    return `${match1[1]}-${match1[2]}-${match1[3]}`;
  }

  // Pattern: /YYYY/Mon/DD/ (simonwillison.net style)
  const datePattern2 = /\/(\d{4})\/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\/(\d{1,2})\//i;
  const match2 = url.match(datePattern2);
  if (match2) {
    const months = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    const month = months[match2[2].toLowerCase()];
    const day = match2[3].padStart(2, '0');
    return `${match2[1]}-${month}-${day}`;
  }

  // Pattern for arxiv: /abs/YYMM.NNNNN
  const arxivPattern = /arxiv\.org\/(?:abs|html)\/(\d{2})(\d{2})\./;
  const arxivMatch = url.match(arxivPattern);
  if (arxivMatch) {
    const year = parseInt(arxivMatch[1]) < 50 ? `20${arxivMatch[1]}` : `19${arxivMatch[1]}`;
    return `${year}-${arxivMatch[2]}-15`; // Approximate to middle of month
  }

  return null;
}

function extractTweetId(url) {
  // Pattern: x.com/.../status/ID or twitter.com/.../status/ID
  const match = url.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
}

async function processFile(filename) {
  const filepath = join(POSTS_DIR, filename);
  const content = await readFile(filepath, 'utf-8');

  // Check if file has frontmatter
  if (!content.startsWith('---')) {
    console.log(`  Skipping ${filename}: no frontmatter`);
    return;
  }

  // Find end of frontmatter
  const endIdx = content.indexOf('\n---', 4);
  if (endIdx === -1) {
    console.log(`  Skipping ${filename}: malformed frontmatter`);
    return;
  }

  const frontmatterRaw = content.slice(4, endIdx);
  const body = content.slice(endIdx + 4);

  // Already has originalDate?
  if (frontmatterRaw.includes('originalDate:')) {
    console.log(`  Skipping ${filename}: already has originalDate`);
    return;
  }

  // Extract sourceUrl
  const sourceUrlMatch = frontmatterRaw.match(/sourceUrl:\s*["']?([^"'\n]+)["']?/);
  const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : '';

  // Extract current date
  const dateMatch = frontmatterRaw.match(/^date:\s*["']?([^"'\n]+)["']?/m);
  if (!dateMatch) {
    console.log(`  Skipping ${filename}: no date field`);
    return;
  }
  const currentDate = dateMatch[1];

  // Try to get original date from source URL
  let originalDate = null;
  const tweetId = extractTweetId(sourceUrl);
  if (tweetId) {
    originalDate = extractDateFromTwitterId(tweetId);
    if (originalDate) {
      console.log(`  ${filename}: Tweet ID → ${originalDate}`);
    }
  }

  if (!originalDate) {
    originalDate = extractDateFromUrl(sourceUrl);
    if (originalDate) {
      console.log(`  ${filename}: URL pattern → ${originalDate}`);
    }
  }

  // Fallback: use "2026-01-15" as default
  if (!originalDate) {
    originalDate = '2026-01-15';
    console.log(`  ${filename}: Using default ${originalDate}`);
  }

  // Replace date: with originalDate:, translatedDate:, translatedBy:
  let newFrontmatter = frontmatterRaw.replace(
    /^date:\s*["']?([^"'\n]+)["']?/m,
    `originalDate: "${originalDate}"
translatedDate: "${currentDate}"
translatedBy:
  model: "Opus 4.5"
  harness: "OpenClaw"`
  );

  const newContent = `---\n${newFrontmatter}\n---${body}`;
  await writeFile(filepath, newContent, 'utf-8');
  console.log(`  ✓ Updated ${filename}`);
}

async function main() {
  console.log('Updating post frontmatter...\n');

  const files = await readdir(POSTS_DIR);
  const mdxFiles = files.filter((f) => f.endsWith('.mdx')).sort();

  console.log(`Found ${mdxFiles.length} MDX files\n`);

  for (const file of mdxFiles) {
    await processFile(file);
  }

  console.log('\nDone!');
}

main().catch(console.error);
