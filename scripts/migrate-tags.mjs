#!/usr/bin/env node
/**
 * migrate-tags.mjs — Apply tag taxonomy to all posts
 * 
 * Usage:
 *   node scripts/migrate-tags.mjs --dry-run    # Preview changes
 *   node scripts/migrate-tags.mjs              # Apply changes
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const POSTS_DIR = 'src/content/posts';
const taxonomy = JSON.parse(fs.readFileSync('scripts/tag-taxonomy.json', 'utf8'));

const mergeMap = taxonomy.merge || {};
const removeSet = new Set(taxonomy.remove || []);

let totalFiles = 0;
let changedFiles = 0;
let totalTagsBefore = 0;
let totalTagsAfter = 0;
const allTagsAfter = {};

const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));

for (const file of files) {
  const filePath = path.join(POSTS_DIR, file);
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Match tags array in frontmatter
  const tagMatch = content.match(/^(tags:\s*\[)(.*?)(\])/ms);
  if (!tagMatch) continue;
  
  totalFiles++;
  
  const prefix = tagMatch[1];
  const tagString = tagMatch[2];
  const suffix = tagMatch[3];
  
  // Parse tags — handle multiline and single-line
  const oldTags = tagString.match(/"([^"]+)"/g)?.map(t => t.replace(/"/g, '')) || [];
  totalTagsBefore += oldTags.length;
  
  // Apply transformations
  let newTags = oldTags
    .map(tag => mergeMap[tag] || tag)  // merge
    .filter(tag => !removeSet.has(tag))  // remove
    .map(tag => tag.toLowerCase().replace(/\s+/g, '-'));  // normalize
  
  // Deduplicate while preserving order
  newTags = [...new Set(newTags)];
  totalTagsAfter += newTags.length;
  
  // Track global tag counts
  for (const tag of newTags) {
    allTagsAfter[tag] = (allTagsAfter[tag] || 0) + 1;
  }
  
  // Check if changed
  const oldSorted = [...oldTags].sort().join(',');
  const newSorted = [...newTags].sort().join(',');
  
  if (oldSorted === newSorted) continue;
  
  changedFiles++;
  
  if (DRY_RUN) {
    const removed = oldTags.filter(t => !newTags.includes(mergeMap[t] || t));
    const merged = oldTags.filter(t => mergeMap[t] && mergeMap[t] !== t);
    if (removed.length || merged.length) {
      console.log(`\n${file}:`);
      if (merged.length) console.log(`  merged: ${merged.map(t => `${t} → ${mergeMap[t]}`).join(', ')}`);
      if (removed.length) console.log(`  removed: ${removed.join(', ')}`);
    }
  } else {
    // Rebuild the tags line
    const newTagString = newTags.map(t => `"${t}"`).join(', ');
    const newLine = `${prefix}${newTagString}${suffix}`;
    const newContent = content.replace(tagMatch[0], newLine);
    fs.writeFileSync(filePath, newContent);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Files scanned: ${totalFiles}`);
console.log(`Files changed: ${changedFiles}`);
console.log(`Tags before: ${totalTagsBefore} (across all files)`);
console.log(`Tags after: ${totalTagsAfter}`);
console.log(`Unique tags before: 732`);

const uniqueAfter = Object.keys(allTagsAfter).length;
console.log(`Unique tags after: ${uniqueAfter}`);
console.log(`Tags eliminated: ${732 - uniqueAfter}`);

if (DRY_RUN) {
  console.log(`\n⚠️  DRY RUN — no files were modified. Run without --dry-run to apply.`);
}
