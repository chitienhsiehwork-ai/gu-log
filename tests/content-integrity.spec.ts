import { test, expect } from './fixtures';
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
  hasTranslatedBy: boolean;
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
    hasTranslatedBy: /^translatedBy:\s*$/m.test(frontmatter) || /^translatedBy:/m.test(frontmatter),
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

  test('GIVEN all posts WHEN checking ticketId format THEN ticketIds should follow PREFIX-N pattern (SP/CP/SD/Lv)', async () => {
    const posts = getAllPosts();
    // Valid prefixes: SP (ShroomDog Picks), CP (Clawd Picks), SD (ShroomDog Originals), Lv (Level-Up)
    const validPattern = /^(SP|CP|SD|Lv)-\d+$/;
    const invalidFormat = posts.filter(p => p.ticketId && !p.ticketId.match(validPattern));
    
    if (invalidFormat.length > 0) {
      const report = invalidFormat
        .map(p => `  - ${p.filename}: "${p.ticketId}"`)
        .join('\n');
      
      expect(invalidFormat, `Invalid ticketId format (expected SP-N, CP-N, SD-N, or Lv-N):\n${report}`).toHaveLength(0);
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

test.describe('Content Integrity: Model Signature', () => {

  test('GIVEN all SP/CP posts WHEN checking frontmatter THEN every translation post should have translatedBy (model + harness)', async () => {
    const posts = getAllPosts();
    // SP and CP posts are translations — they MUST have translatedBy
    // SD and Lv posts are originals — they don't need it
    const translationPrefixes = /^(SP|CP)-/;
    const missing = posts.filter(p =>
      p.ticketId &&
      translationPrefixes.test(p.ticketId) &&
      !p.hasTranslatedBy
    );

    if (missing.length > 0) {
      const report = missing
        .map(p => `  - ${p.filename} (${p.ticketId})`)
        .join('\n');

      expect(missing, `SP/CP posts missing translatedBy (model signature):\n${report}`).toHaveLength(0);
    }
  });
});

test.describe('Content Integrity: Model Signature Visibility', () => {

  test('GIVEN all posts with translatedBy WHEN checking frontmatter THEN translatedDate must also be present (otherwise UI won\'t render the signature)', async () => {
    const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
    const broken: { filename: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      const fm = match[1];

      const hasTranslatedBy = /^translatedBy:\s*$/m.test(fm) || /^translatedBy:/m.test(fm);
      const hasTranslatedDate = /^translatedDate:/m.test(fm);

      if (hasTranslatedBy && !hasTranslatedDate) {
        broken.push({ filename: file });
      }
    }

    if (broken.length > 0) {
      const report = broken.map(b => `  - ${b.filename}`).join('\n');
      expect(broken, `Posts have translatedBy but missing translatedDate (model signature won't render):\n${report}`).toHaveLength(0);
    }
  });
});

test.describe('Content Integrity: Internal Links', () => {

  /**
   * Collect all internal links from MDX files.
   * Matches both markdown links [text](/posts/slug) and HTML <a href="/posts/slug">.
   * Returns { filename, line, href }[].
   */
  function getAllInternalLinks(): { filename: string; line: number; href: string }[] {
    const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
    const links: { filename: string; line: number; href: string }[] = [];

    // Match markdown [text](/path) and html href="/path"
    const mdLinkRe = /\]\((\/(posts|en\/posts|level-up|clawd-picks|shroomdog-picks)\/[^)\s#"]+)\)/g;
    const htmlLinkRe = /href="(\/(posts|en\/posts|level-up|clawd-picks|shroomdog-picks)\/[^"#]+)"/g;

    for (const file of files) {
      const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];

        for (const re of [mdLinkRe, htmlLinkRe]) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(lineText)) !== null) {
            links.push({ filename: file, line: i + 1, href: m[1] });
          }
        }
      }
    }

    return links;
  }

  /**
   * Build a set of valid slugs from actual MDX files.
   * e.g. "clawd-picks-20260204-simonw-lethal-trifecta"
   */
  function getValidSlugs(): Set<string> {
    const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mdx'));
    return new Set(files.map(f => f.replace(/\.mdx$/, '')));
  }

  /**
   * Extract the expected slug from an internal href.
   * "/posts/some-slug" → "some-slug"
   * "/posts/some-slug/" → "some-slug"
   * "/en/posts/en-some-slug" → "en-some-slug"
   */
  function hrefToSlug(href: string): string {
    // Strip trailing slash
    const clean = href.replace(/\/$/, '');
    // /posts/slug → slug, /en/posts/slug → slug
    const match = clean.match(/\/(?:en\/)?posts\/(.+)/);
    return match ? match[1] : clean;
  }

  test('GIVEN all posts WHEN checking internal links THEN every /posts/ link should resolve to an existing post', async () => {
    const links = getAllInternalLinks();
    const slugs = getValidSlugs();
    const broken: { filename: string; line: number; href: string; expectedSlug: string }[] = [];

    for (const link of links) {
      const slug = hrefToSlug(link.href);
      if (!slugs.has(slug)) {
        broken.push({ ...link, expectedSlug: slug });
      }
    }

    if (broken.length > 0) {
      const report = broken
        .map(b => `  - ${b.filename}:${b.line} → ${b.href}\n    slug "${b.expectedSlug}" does not match any .mdx file`)
        .join('\n');

      expect(broken, `Broken internal links found:\n${report}`).toHaveLength(0);
    }
  });
});
