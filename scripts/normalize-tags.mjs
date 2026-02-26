#!/usr/bin/env node
/**
 * Tag normalization script for gu-log
 * Normalizes tags across all MDX posts:
 * - Lowercase
 * - Trim whitespace
 * - Strip surrounding quotes
 * - Replace spaces with dashes
 * - Merge known duplicates
 * - Remove exact duplicates within same post
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const POSTS_DIR = join(__dirname, '../src/content/posts');

// Known merge rules
const TAG_MERGES = {
  'ai agents': 'ai-agents',
  'ai-agent': 'ai-agents',
  'agent': 'ai-agents',
  'agents': 'ai-agents',
  'simon willison': 'simon-willison',
  'agentic coding': 'agentic-coding',
  'ai': 'ai',
  'claude': 'claude',
  'coding': 'coding',
  'vibe-coding': 'vibe-coding',
  'agent-loop': 'agent-loop',
  'multi-agent': 'multi-agent',
  'personal-agent': 'personal-agent',
  'agent-workflow': 'agent-workflow',
  'ai-assistant': 'ai-assistant',
};

/**
 * Normalize a single tag
 */
function normalizeTag(tag) {
  // Strip surrounding quotes
  let normalized = tag.trim().replace(/^['"]|['"]$/g, '');

  // Lowercase
  normalized = normalized.toLowerCase();

  // Replace spaces with dashes
  normalized = normalized.replace(/\s+/g, '-');

  // Apply known merges
  if (TAG_MERGES[normalized]) {
    normalized = TAG_MERGES[normalized];
  }

  return normalized;
}

/**
 * Extract frontmatter tags from MDX content
 */
function extractTags(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];

  // Match tags array - handle both inline and multiline formats
  const tagsMatch = frontmatter.match(/tags:\s*\[([\s\S]*?)\]/);
  if (!tagsMatch) return null;

  const tagsContent = tagsMatch[1];

  // Extract individual tags (handles quoted strings)
  const tags = [];
  const regex = /["']([^"']+)["']|(\S+)/g;
  let match;
  while ((match = regex.exec(tagsContent)) !== null) {
    const tag = (match[1] || match[2]).trim();
    if (tag && tag !== ',') {
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Replace tags in frontmatter
 */
function replaceTags(content, newTags) {
  // Format tags as YAML array with proper indentation
  const tagsString = newTags.map(tag => `"${tag}"`).join(', ');
  const tagsLine = `tags: [${tagsString}]`;

  // Replace tags line in frontmatter
  return content.replace(/tags:\s*\[[\s\S]*?\]/, tagsLine);
}

/**
 * Process all MDX files
 */
function processAllFiles() {
  const files = readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));

  let totalFiles = 0;
  let modifiedFiles = 0;
  let totalTags = 0;
  let normalizedCount = 0;
  let duplicatesRemoved = 0;

  const changes = [];

  for (const file of files) {
    const filePath = join(POSTS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');

    totalFiles++;

    const tags = extractTags(content);
    if (!tags || tags.length === 0) continue;

    totalTags += tags.length;

    // Normalize tags
    const normalizedTags = tags.map(normalizeTag);

    // Remove duplicates (keep first occurrence)
    const uniqueTags = [...new Set(normalizedTags)];

    // Check if anything changed
    const tagsChanged = tags.length !== uniqueTags.length ||
                       tags.some((tag, i) => tag !== normalizedTags[i]);

    if (tagsChanged) {
      modifiedFiles++;
      duplicatesRemoved += tags.length - uniqueTags.length;

      // Count normalized tags
      const normalizedInFile = tags.filter((tag, i) => tag !== normalizedTags[i]).length;
      normalizedCount += normalizedInFile;

      // Replace tags in content
      const newContent = replaceTags(content, uniqueTags);
      writeFileSync(filePath, newContent, 'utf-8');

      changes.push({
        file,
        before: tags,
        after: uniqueTags,
      });
    }
  }

  // Print summary
  console.log('\n📊 Tag Normalization Summary\n');
  console.log(`Total files processed: ${totalFiles}`);
  console.log(`Files modified: ${modifiedFiles}`);
  console.log(`Total tags: ${totalTags}`);
  console.log(`Tags normalized: ${normalizedCount}`);
  console.log(`Duplicate tags removed: ${duplicatesRemoved}`);

  if (changes.length > 0) {
    console.log('\n📝 Changes:\n');
    changes.forEach(({ file, before, after }) => {
      console.log(`\n${file}:`);
      console.log(`  Before: [${before.join(', ')}]`);
      console.log(`  After:  [${after.join(', ')}]`);
    });
  } else {
    console.log('\n✅ No changes needed - all tags are already normalized!');
  }
}

// Run the script
processAllFiles();
