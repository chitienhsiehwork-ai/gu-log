import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * BDD Tests for Content Integrity
 * 
 * Validates content data constraints like unique IDs, required fields, etc.
 * Run with: npx playwright test tests/content-integrity.spec.ts
 * 
 * ticketId Naming Convention:
 * - SP-N: ShroomDog Posts (original articles)
 * - CP-N: Clawd Picks (curated external content)
 * - SD-N: ShroomDog Originals
 * 
 * Translation pairs (zh-tw + en-) MUST share the same ticketId.
 * Different posts (non-translation-pairs) MUST NOT share the same ticketId.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

interface PostFrontmatter {
  ticketId: string;
  title: string;
  date: string;
  originalDate: string;
  lang: string;
  filename: string;
}

function extractFrontmatter(filePath: string): PostFrontmatter | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  
  if (!match) return null;
  
  const frontmatter = match[1];
  const getValue = (key: string): string => {
    const lineMatch = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'));
    return lineMatch ? lineMatch[1].trim() : '';
  };
  
  return {
    ticketId: getValue('ticketId'),
    title: getValue('title'),
    date: getValue('date') || getValue('originalDate'),
    originalDate: getValue('originalDate'),
    lang: getValue('lang'),
    filename: path.basename(filePath),
  };
}

function getAllPosts(): PostFrontmatter[] {
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
  return files
    .map(f => extractFrontmatter(path.join(POSTS_DIR, f)))
    .filter((p): p is PostFrontmatter => p !== null);
}

/**
 * Get the base filename for matching translation pairs.
 * en-foo.mdx → foo.mdx
 * foo.mdx → foo.mdx
 */
function getBaseFilename(filename: string): string {
  return filename.startsWith('en-') ? filename.slice(3) : filename;
}

/**
 * Check if two posts are a translation pair (same base filename, different lang).
 */
function areTranslationPair(a: PostFrontmatter, b: PostFrontmatter): boolean {
  return getBaseFilename(a.filename) === getBaseFilename(b.filename) && a.lang !== b.lang;
}

test.describe('Content Integrity: ticketId', () => {
  
  test('GIVEN all posts WHEN checking ticketIds THEN each ticketId should be unique across non-translation-pair posts (PK constraint)', async () => {
    const posts = getAllPosts();
    const ticketIdMap = new Map<string, PostFrontmatter[]>();
    
    // Group posts by ticketId
    for (const post of posts) {
      if (!post.ticketId) continue;
      
      const existing = ticketIdMap.get(post.ticketId) || [];
      existing.push(post);
      ticketIdMap.set(post.ticketId, existing);
    }
    
    // Find REAL duplicates (not translation pairs)
    const realDuplicates: { ticketId: string; files: string[] }[] = [];
    
    for (const [ticketId, postsWithId] of ticketIdMap) {
      if (postsWithId.length <= 2) {
        // Could be a valid translation pair
        if (postsWithId.length === 2) {
          const [a, b] = postsWithId;
          if (!areTranslationPair(a, b)) {
            // Same ticketId but NOT a translation pair = real duplicate
            realDuplicates.push({ ticketId, files: postsWithId.map(p => p.filename) });
          }
        }
        // Single post with this ID = fine
      } else {
        // More than 2 posts = definitely duplicates
        // Group by base filename to find which ones are extra
        const byBase = new Map<string, PostFrontmatter[]>();
        for (const post of postsWithId) {
          const base = getBaseFilename(post.filename);
          const arr = byBase.get(base) || [];
          arr.push(post);
          byBase.set(base, arr);
        }
        
        // If more than 1 unique base filename, we have a conflict
        if (byBase.size > 1) {
          realDuplicates.push({ ticketId, files: postsWithId.map(p => p.filename) });
        }
      }
    }
    
    // Report duplicates clearly
    if (realDuplicates.length > 0) {
      const report = realDuplicates
        .map(d => `  ${d.ticketId}: [${d.files.join(', ')}]`)
        .join('\n');
      
      expect(realDuplicates, `Duplicate ticketIds found (non-translation-pairs):\n${report}`).toHaveLength(0);
    }
  });

  test('GIVEN all posts WHEN checking ticketIds THEN every post should have a ticketId', async () => {
    const posts = getAllPosts();
    const missingTicketId = posts.filter(p => !p.ticketId);
    
    if (missingTicketId.length > 0) {
      const report = missingTicketId.map(p => `  - ${p.filename}`).join('\n');
      expect(missingTicketId, `Posts missing ticketId:\n${report}`).toHaveLength(0);
    }
  });

  test('GIVEN all posts WHEN checking ticketId format THEN ticketIds should follow PREFIX-N pattern (SP/CP/SD)', async () => {
    const posts = getAllPosts();
    // Valid prefixes: SP (ShroomDog Posts), CP (Clawd Picks), SD (ShroomDog Originals)
    const validPattern = /^(SP|CP|SD)-\d+$/;
    const invalidFormat = posts.filter(p => p.ticketId && !p.ticketId.match(validPattern));
    
    if (invalidFormat.length > 0) {
      const report = invalidFormat
        .map(p => `  - ${p.filename}: "${p.ticketId}"`)
        .join('\n');
      
      expect(invalidFormat, `Invalid ticketId format (expected SP-N, CP-N, or SD-N):\n${report}`).toHaveLength(0);
    }
  });

  test('GIVEN all posts WHEN checking ticketIds THEN zh-tw and en versions MUST share the same ticketId', async () => {
    const posts = getAllPosts();
    
    // Group by base filename (without en- prefix)
    const pairs = new Map<string, { zhTw?: PostFrontmatter; en?: PostFrontmatter }>();
    
    for (const post of posts) {
      const isEnglish = post.filename.startsWith('en-');
      const baseFilename = getBaseFilename(post.filename);
      
      const existing = pairs.get(baseFilename) || {};
      if (isEnglish) {
        existing.en = post;
      } else {
        existing.zhTw = post;
      }
      pairs.set(baseFilename, existing);
    }
    
    // Check mismatched ticketIds in translation pairs
    const mismatched: { base: string; zhTw: string; en: string }[] = [];
    for (const [baseFilename, pair] of pairs) {
      if (pair.zhTw && pair.en && pair.zhTw.ticketId !== pair.en.ticketId) {
        mismatched.push({
          base: baseFilename,
          zhTw: pair.zhTw.ticketId,
          en: pair.en.ticketId,
        });
      }
    }
    
    if (mismatched.length > 0) {
      const report = mismatched
        .map(m => `  - ${m.base}: zh-tw=${m.zhTw}, en=${m.en}`)
        .join('\n');
      
      expect(mismatched, `Translation pairs have mismatched ticketIds:\n${report}`).toHaveLength(0);
    }
  });
});

test.describe('Content Integrity: ClawdNote', () => {
  
  test('GIVEN all posts WHEN checking ClawdNote content THEN should NOT contain redundant Clawd prefix (component adds it automatically)', async () => {
    const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
    const violations: { filename: string; pattern: string; context: string }[] = [];
    
    // Patterns that indicate redundant prefix inside ClawdNote
    const redundantPatterns = [
      { regex: /<ClawdNote>\s*\n?\s*\*\*Clawd[：:]\*\*/i, name: '**Clawd：** (bold)' },
      { regex: /<ClawdNote>\s*\n?\s*Clawd[：:]\s/i, name: 'Clawd： (plain)' },
      { regex: /<ClawdNote>\s*\n?\s*Clawd\s+[忍偷歪畫碎插溫真吐認補murmurOS]/i, name: 'Clawd prefix (e.g., Clawd 忍不住說)' },
    ];
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
      
      for (const { regex, name } of redundantPatterns) {
        const match = content.match(regex);
        if (match) {
          // Extract some context around the match
          const matchIndex = content.indexOf(match[0]);
          const contextStart = Math.max(0, matchIndex - 20);
          const contextEnd = Math.min(content.length, matchIndex + match[0].length + 30);
          const context = content.slice(contextStart, contextEnd).replace(/\n/g, '\\n');
          
          violations.push({ filename: file, pattern: name, context });
        }
      }
    }
    
    if (violations.length > 0) {
      const report = violations
        .map(v => `  - ${v.filename}: found "${v.pattern}"\n    Context: ...${v.context}...`)
        .join('\n');
      
      expect(violations, `ClawdNote contains redundant Clawd prefix (component auto-adds it):\n${report}`).toHaveLength(0);
    }
  });
});

test.describe('Content Integrity: Required Fields', () => {
  
  test('GIVEN all posts WHEN checking required fields THEN every post should have title, date, and lang', async () => {
    const posts = getAllPosts();
    const missingFields: { filename: string; missing: string[] }[] = [];
    
    for (const post of posts) {
      const missing: string[] = [];
      if (!post.title) missing.push('title');
      if (!post.date) missing.push('date');
      if (!post.lang) missing.push('lang');
      
      if (missing.length > 0) {
        missingFields.push({ filename: post.filename, missing });
      }
    }
    
    if (missingFields.length > 0) {
      const report = missingFields
        .map(p => `  - ${p.filename}: missing [${p.missing.join(', ')}]`)
        .join('\n');
      
      expect(missingFields, `Posts with missing required fields:\n${report}`).toHaveLength(0);
    }
  });
});
