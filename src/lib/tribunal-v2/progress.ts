/**
 * Tribunal v2 — Progress Persistence
 *
 * Persists pipeline state to JSON files for crash recovery.
 * Path: `.score-loop/progress/<article-slug>.json`
 *
 * Uses Node fs directly — no external dependencies.
 */

import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { PipelineState } from './pipeline';

const PROGRESS_DIR = '.score-loop/progress';
const COMPLETED_DIR = '.score-loop/progress/completed';

/** Derive a stable slug from articlePath for the progress filename */
function slugFromPath(articlePath: string): string {
  // "src/content/posts/cp-280-2026-04-10-slug.mdx" → "cp-280-2026-04-10-slug"
  return basename(articlePath, '.mdx');
}

function progressFilePath(articlePath: string): string {
  return join(PROGRESS_DIR, `${slugFromPath(articlePath)}.json`);
}

/** Ensure the progress directories exist */
async function ensureDirs(): Promise<void> {
  await mkdir(PROGRESS_DIR, { recursive: true });
  await mkdir(COMPLETED_DIR, { recursive: true });
}

/**
 * Save pipeline state to a JSON file for crash recovery.
 */
export async function saveProgress(state: PipelineState): Promise<void> {
  await ensureDirs();
  const filePath = progressFilePath(state.articlePath);
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Load pipeline state from disk. Returns null if no progress file exists.
 */
export async function loadProgress(articlePath: string): Promise<PipelineState | null> {
  const filePath = progressFilePath(articlePath);
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

/**
 * List all in-progress pipeline states (not yet completed/moved).
 */
export async function listInProgress(): Promise<PipelineState[]> {
  await ensureDirs();
  const files = await readdir(PROGRESS_DIR);
  const states: PipelineState[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(PROGRESS_DIR, file), 'utf-8');
      const state = JSON.parse(raw) as PipelineState;
      if (state.status === 'running') {
        states.push(state);
      }
    } catch {
      // Skip corrupt files
    }
  }

  return states;
}

/**
 * Move a completed article's progress file to the completed/ subdirectory.
 * Keeps the file for analytics — just moves it out of the active directory.
 */
export async function markCompleted(articlePath: string): Promise<void> {
  await ensureDirs();
  const slug = slugFromPath(articlePath);
  const src = join(PROGRESS_DIR, `${slug}.json`);
  const dest = join(COMPLETED_DIR, `${slug}.json`);

  try {
    await rename(src, dest);
  } catch {
    // File may not exist if progress was never saved — that's OK
  }
}
