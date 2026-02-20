#!/usr/bin/env node

/**
 * SQAA Level 6: Broken Link Annotation
 *
 * Reads the broken links baseline JSON and generates annotation suggestions.
 * Does NOT auto-apply — outputs a preview of changes for human review.
 *
 * Usage:
 *   node scripts/annotate-broken-links.mjs                    # dry run (default)
 *   node scripts/annotate-broken-links.mjs --apply            # apply changes
 *   node scripts/annotate-broken-links.mjs --input path.json  # custom input
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const DEFAULT_INPUT = join(ROOT, 'quality', 'broken-links-baseline.json');

function parseArgs() {
  const args = process.argv.slice(2);
  let apply = false;
  let inputPath = DEFAULT_INPUT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    if (args[i] === '--input' && args[i + 1]) inputPath = args[++i];
  }

  return { apply, inputPath };
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Annotate a markdown link in content.
 * [text](url) → [text](url) [⚠️ 此連結已於 YYYY-MM-DD 確認失效]
 */
function annotateMarkdownLink(content, url, date) {
  // Already annotated?
  if (content.includes(`${url}) [⚠️ 此連結已於`)) {
    return { content, changed: false };
  }

  // Find markdown link with this URL
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\[[^\\]]*\\]\\(${escaped}\\))`, 'g');

  let changed = false;
  const newContent = content.replace(pattern, (match) => {
    changed = true;
    return `${match} [⚠️ 此連結已於 ${date} 確認失效]`;
  });

  return { content: newContent, changed };
}

/**
 * Annotate an HTML href in content.
 * href="url" → adds broken-link class
 */
function annotateHtmlLink(content, url, date) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Already annotated?
  if (content.includes(`class="broken-link"`) && content.includes(url)) {
    return { content, changed: false };
  }

  const pattern = new RegExp(`(<a\\s+)([^>]*href=["']${escaped}["'])`, 'g');

  let changed = false;
  const newContent = content.replace(pattern, (match, prefix, rest) => {
    changed = true;
    return `${prefix}class="broken-link" ${rest}`;
  });

  return { content: newContent, changed };
}

/**
 * Annotate sourceUrl in frontmatter.
 * Adds sourceBroken: true and sourceBrokenDate: "YYYY-MM-DD"
 */
function annotateSourceUrl(content, url, date) {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) return { content, changed: false };

  const frontmatter = fmMatch[2];

  // Check if sourceUrl matches
  if (!frontmatter.includes(url)) return { content, changed: false };

  // Already annotated?
  if (frontmatter.includes('sourceBroken:')) return { content, changed: false };

  // Add sourceBroken fields after sourceUrl line
  const newFrontmatter = frontmatter.replace(
    /(sourceUrl:\s*['"][^'"]+['"])/,
    `$1\nsourceBroken: true\nsourceBrokenDate: '${date}'`
  );

  return {
    content: fmMatch[1] + newFrontmatter + fmMatch[3] + content.slice(fmMatch[0].length),
    changed: newFrontmatter !== frontmatter,
  };
}

async function main() {
  const { apply, inputPath } = parseArgs();
  const today = getToday();

  console.log('📝 SQAA Level 6: Broken Link Annotation');
  console.log('═'.repeat(50));
  console.log(`  Mode: ${apply ? '🔧 APPLY' : '👀 DRY RUN (use --apply to apply)'}`);
  console.log(`  Input: ${inputPath}`);
  console.log(`  Date: ${today}\n`);

  // Load broken links data
  if (!existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error('   Run "pnpm links:check" first.');
    process.exit(1);
  }

  const data = JSON.parse(await readFile(inputPath, 'utf-8'));
  const brokenLinks = data.external?.broken || [];

  if (brokenLinks.length === 0) {
    console.log('✅ No broken external links to annotate!');
    process.exit(0);
  }

  console.log(`Found ${brokenLinks.length} broken external links to annotate.\n`);

  // Group by file
  const byFile = {};
  for (const link of brokenLinks) {
    if (!byFile[link.file]) byFile[link.file] = [];
    byFile[link.file].push(link);
  }

  const modifiedFiles = [];
  const suggestions = [];

  for (const [file, links] of Object.entries(byFile)) {
    const filePath = join(POSTS_DIR, file);
    if (!existsSync(filePath)) {
      console.log(`  ⚠️  File not found: ${file} (skipped)`);
      continue;
    }

    let content = await readFile(filePath, 'utf-8');
    let fileChanged = false;

    for (const link of links) {
      let result;

      // Handle sourceUrl annotation
      if (link.context === 'frontmatter') {
        result = annotateSourceUrl(content, link.url, today);
        if (result.changed) {
          content = result.content;
          fileChanged = true;
          suggestions.push({
            file,
            url: link.url,
            action: 'Added sourceBroken: true to frontmatter',
          });
        }
      }

      // Handle markdown links
      result = annotateMarkdownLink(content, link.url, today);
      if (result.changed) {
        content = result.content;
        fileChanged = true;
        suggestions.push({
          file,
          url: link.url,
          action: 'Added ⚠️ notice after markdown link',
        });
      }

      // Handle HTML links
      result = annotateHtmlLink(content, link.url, today);
      if (result.changed) {
        content = result.content;
        fileChanged = true;
        suggestions.push({
          file,
          url: link.url,
          action: 'Added broken-link class to HTML link',
        });
      }
    }

    if (fileChanged) {
      if (apply) {
        await writeFile(filePath, content);
        modifiedFiles.push(file);
        console.log(`  ✏️  Modified: ${file}`);
      } else {
        modifiedFiles.push(file);
        console.log(`  📋 Would modify: ${file}`);
      }
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 Summary:');
  console.log(`  Files ${apply ? 'modified' : 'to modify'}: ${modifiedFiles.length}`);
  console.log(`  Annotations: ${suggestions.length}`);

  if (suggestions.length > 0) {
    console.log('\n📝 Changes:');
    for (const s of suggestions) {
      console.log(`  - ${s.file}: ${s.action}`);
      console.log(`    URL: ${s.url}`);
    }
  }

  if (!apply && modifiedFiles.length > 0) {
    console.log('\n💡 To apply these changes, run:');
    console.log('   pnpm links:annotate -- --apply');
  }

  // Write suggestions to file
  const suggestionsPath = join(ROOT, 'quality', 'broken-links-annotations.json');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(ROOT, 'quality'), { recursive: true });
  await writeFile(
    suggestionsPath,
    JSON.stringify(
      {
        date: today,
        applied: apply,
        files: modifiedFiles,
        suggestions,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\n💾 Suggestions saved to quality/broken-links-annotations.json`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
