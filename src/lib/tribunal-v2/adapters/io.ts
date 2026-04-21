/**
 * Tribunal v2 — IO Adapter
 *
 * Implements PipelineConfig['io'] — filesystem reads/writes for article
 * content + frontmatter updates via gray-matter.
 */

import { readFile, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';

export interface IoAdapter {
  readArticle(path: string): Promise<string>;
  writeArticle(path: string, content: string): Promise<void>;
  updateFrontmatter(path: string, updates: Record<string, unknown>): Promise<void>;
  extractSourceUrl(path: string): Promise<string>;
}

export function buildIoAdapter(): IoAdapter {
  return {
    async readArticle(path) {
      return readFile(path, 'utf-8');
    },

    async writeArticle(path, content) {
      await writeFile(path, content, 'utf-8');
    },

    async updateFrontmatter(path, updates) {
      const raw = await readFile(path, 'utf-8');
      const parsed = matter(raw);
      // Deep-merge object-valued keys so nested frontmatter sections (e.g.
      // `dedup: { tribunalVerdict }`) don't clobber sibling fields that were
      // already set by a previous stage (e.g. `dedup: { independentDiff }`).
      // Primitive-valued keys and arrays are overwritten (same as before).
      const merged: Record<string, unknown> = { ...parsed.data };
      for (const [k, v] of Object.entries(updates)) {
        const existing = merged[k];
        if (
          v !== null &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          existing !== null &&
          typeof existing === 'object' &&
          !Array.isArray(existing)
        ) {
          // Both existing and incoming are plain objects — deep merge one level.
          merged[k] = { ...(existing as Record<string, unknown>), ...(v as Record<string, unknown>) };
        } else {
          merged[k] = v;
        }
      }
      // gray-matter's stringify preserves excerpt/delimiters
      const next = matter.stringify(parsed.content, merged);
      await writeFile(path, next, 'utf-8');
    },

    async extractSourceUrl(path) {
      const raw = await readFile(path, 'utf-8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;

      // gu-log frontmatter has two possible source URL locations
      const srcObj = data.source as { url?: string } | undefined;
      if (srcObj?.url) return srcObj.url;

      const flat = data.sourceUrl;
      if (typeof flat === 'string' && flat) return flat;

      throw new Error(
        `No source URL found in frontmatter of ${path}. Expected either \`source.url\` or \`sourceUrl\`.`,
      );
    },
  };
}
