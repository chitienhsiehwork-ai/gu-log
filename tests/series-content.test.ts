import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Vitest Content Validation Tests for Series Feature (Issue #83)
 *
 * Validates that all posts with series field have correct:
 * - Valid series name + order
 * - No duplicate order numbers within same series
 * - Sequential order numbers (no gaps)
 * - Correct article counts for known series
 *
 * Run with: npx vitest run tests/series-content.test.ts
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

interface SeriesData {
  name: string;
  order: number;
}

interface PostData {
  filename: string;
  slug: string;
  lang: string;
  ticketId?: string;
  series?: SeriesData;
}

function extractSeriesFromFrontmatter(filePath: string): PostData | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) return null;

  const frontmatter = match[1];
  const filename = path.basename(filePath, '.mdx');

  const getStringValue = (key: string): string => {
    const lineMatch = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'));
    return lineMatch ? lineMatch[1].trim() : '';
  };

  const lang = getStringValue('lang') || 'zh-tw';
  const ticketId = getStringValue('ticketId') || undefined;

  // Parse series block
  const seriesMatch = frontmatter.match(
    /^series:\s*\n\s+name:\s*["']?(.+?)["']?\s*\n\s+order:\s*(\d+)/m,
  );
  let series: SeriesData | undefined;

  if (seriesMatch) {
    series = {
      name: seriesMatch[1].trim().replace(/^["']|["']$/g, ''),
      order: parseInt(seriesMatch[2], 10),
    };
  }

  return {
    filename,
    slug: filename,
    lang,
    ticketId,
    series,
  };
}

function getAllPosts(): PostData[] {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
  return files
    .map((f) => extractSeriesFromFrontmatter(path.join(POSTS_DIR, f)))
    .filter((p): p is PostData => p !== null);
}

function getPostsWithSeries(): PostData[] {
  return getAllPosts().filter((p) => p.series !== undefined);
}

describe('Series Content Validation', () => {
  it('1. All posts with series field have valid name + order', () => {
    const postsWithSeries = getPostsWithSeries();

    // Should have some series posts
    expect(postsWithSeries.length).toBeGreaterThan(0);

    for (const post of postsWithSeries) {
      expect(
        post.series!.name,
        `Post ${post.filename} has empty series name`,
      ).toBeTruthy();
      expect(
        post.series!.name.length,
        `Post ${post.filename} series name is too short`,
      ).toBeGreaterThan(2);
      expect(
        post.series!.order,
        `Post ${post.filename} has invalid order (${post.series!.order})`,
      ).toBeGreaterThan(0);
    }
  });

  it('2. No duplicate order numbers within same series', () => {
    const postsWithSeries = getPostsWithSeries();

    // Group by series name AND lang (zh-tw and en are separate)
    const seriesGroups = new Map<string, PostData[]>();
    for (const post of postsWithSeries) {
      const key = `${post.series!.name}::${post.lang}`;
      if (!seriesGroups.has(key)) {
        seriesGroups.set(key, []);
      }
      seriesGroups.get(key)!.push(post);
    }

    for (const [key, posts] of seriesGroups) {
      const orders = posts.map((p) => p.series!.order);
      const uniqueOrders = new Set(orders);
      expect(
        uniqueOrders.size,
        `Series "${key}" has duplicate order numbers: ${orders.sort().join(', ')}`,
      ).toBe(orders.length);
    }
  });

  it('3. Series order numbers are sequential (no gaps)', () => {
    const postsWithSeries = getPostsWithSeries();

    // Group by series name AND lang
    const seriesGroups = new Map<string, PostData[]>();
    for (const post of postsWithSeries) {
      const key = `${post.series!.name}::${post.lang}`;
      if (!seriesGroups.has(key)) {
        seriesGroups.set(key, []);
      }
      seriesGroups.get(key)!.push(post);
    }

    for (const [key, posts] of seriesGroups) {
      const orders = posts.map((p) => p.series!.order).sort((a, b) => a - b);
      // Should start at 1
      expect(orders[0], `Series "${key}" does not start at order 1`).toBe(1);
      // Should be sequential
      for (let i = 1; i < orders.length; i++) {
        expect(
          orders[i],
          `Series "${key}" has gap: order ${orders[i - 1]} followed by ${orders[i]}`,
        ).toBe(orders[i - 1] + 1);
      }
    }
  });

  it('4. ECC series (zh-tw) has exactly 8 articles', () => {
    const postsWithSeries = getPostsWithSeries();
    const eccPosts = postsWithSeries.filter(
      (p) => p.series!.name === 'Everything Claude Code 全解析' && p.lang !== 'en',
    );
    expect(
      eccPosts.length,
      `ECC series should have 8 articles, found ${eccPosts.length}`,
    ).toBe(8);
  });

  it('4b. ECC series (en) has exactly 8 articles', () => {
    const postsWithSeries = getPostsWithSeries();
    const eccPosts = postsWithSeries.filter(
      (p) => p.series!.name === 'Everything Claude Code 全解析' && p.lang === 'en',
    );
    expect(
      eccPosts.length,
      `ECC series (en) should have 8 articles, found ${eccPosts.length}`,
    ).toBe(8);
  });

  it('4c. SD Deep Dive series (zh-tw) has exactly 6 articles', () => {
    const postsWithSeries = getPostsWithSeries();
    const sdPosts = postsWithSeries.filter(
      (p) => p.series!.name === 'Claude Code Deep Dive' && p.lang !== 'en',
    );
    expect(
      sdPosts.length,
      `SD Deep Dive series should have 6 articles, found ${sdPosts.length}`,
    ).toBe(6);
  });

  it("4d. Simon Willison's Agentic Engineering series (zh-tw) has exactly 13 articles", () => {
    const postsWithSeries = getPostsWithSeries();
    const simonPosts = postsWithSeries.filter(
      (p) =>
        p.series!.name === "Simon Willison's Agentic Engineering" && p.lang !== 'en',
    );
    expect(
      simonPosts.length,
      `SimonW series should have 13 articles, found ${simonPosts.length}`,
    ).toBe(13);
  });
});
