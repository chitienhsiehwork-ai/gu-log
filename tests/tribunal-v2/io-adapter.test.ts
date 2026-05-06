/**
 * Tribunal v2 — IO adapter contract tests.
 *
 * Locks the deep-merge contract on `updateFrontmatter`. Level E shipped this
 * behaviour to make `dedup: { tribunalVerdict }` coexist with a previously
 * written `dedup: { independentDiff }`. Without these tests, a well-meaning
 * refactor could silently go back to wholesale replacement and we'd only
 * notice when Level F starts reading both.
 *
 * Five cases (aligned with reviewer round-3 audit):
 *   1. No existing object under key → incoming object written as-is.
 *   2. Existing dedup.independentDiff + incoming dedup.tribunalVerdict → both
 *      keys coexist after merge (THE key case).
 *   3. Array value on both sides → incoming replaces, no concatenation.
 *   4. Primitive flip (false → true) → incoming wins.
 *   5. Two-level nested object → ONLY top-level deep-merges; the nested
 *      child is replaced wholesale, per the documented one-level contract.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { buildIoAdapter } from '../../src/lib/tribunal-v2/adapters/io';

const io = buildIoAdapter();

async function tmpArticle(frontmatter: Record<string, unknown>, body = 'Body.'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tribunal-v2-io-'));
  const path = join(dir, 'article.mdx');
  await writeFile(path, matter.stringify(body, frontmatter), 'utf-8');
  return path;
}

async function readFrontmatter(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf-8');
  return matter(raw).data as Record<string, unknown>;
}

describe('updateFrontmatter — deep-merge contract (one level)', () => {
  let path: string;
  afterEach(async () => {
    if (path) await rm(join(path, '..'), { recursive: true, force: true });
  });

  it('case 1: adds new nested object when key absent', async () => {
    path = await tmpArticle({ title: 'hello' });

    await io.updateFrontmatter(path, {
      dedup: { tribunalVerdict: { class: 'hard-dup' } },
    });

    const fm = await readFrontmatter(path);
    expect(fm.title).toBe('hello');
    expect(fm.dedup).toEqual({ tribunalVerdict: { class: 'hard-dup' } });
    // Sanity: no literal dotted key at top level.
    expect('dedup.tribunalVerdict' in fm).toBe(false);
  });

  it('case 2: preserves existing dedup.independentDiff when writing dedup.tribunalVerdict', async () => {
    path = await tmpArticle({
      title: 'hello',
      dedup: {
        independentDiff: 'structural divergence: translation-pair',
        humanOverride: null,
      },
    });

    await io.updateFrontmatter(path, {
      dedup: {
        tribunalVerdict: {
          class: 'soft-dup',
          action: 'WARN',
          score: 7,
        },
      },
    });

    const fm = await readFrontmatter(path);
    const dedup = fm.dedup as Record<string, unknown>;
    // All three fields must coexist — THIS is the bug the merge was introduced for.
    expect(dedup.independentDiff).toBe('structural divergence: translation-pair');
    expect(dedup.humanOverride).toBeNull();
    expect(dedup.tribunalVerdict).toEqual({
      class: 'soft-dup',
      action: 'WARN',
      score: 7,
    });
  });

  it('case 3: arrays overwrite, not concatenate', async () => {
    path = await tmpArticle({
      stage4DegradedDimensions: ['persona'],
    });

    await io.updateFrontmatter(path, {
      stage4DegradedDimensions: ['clarity', 'narrative'],
    });

    const fm = await readFrontmatter(path);
    expect(fm.stage4DegradedDimensions).toEqual(['clarity', 'narrative']);
    // Must NOT be ['persona', 'clarity', 'narrative'].
    expect((fm.stage4DegradedDimensions as string[]).length).toBe(2);
  });

  it('case 4: primitive values are replaced', async () => {
    path = await tmpArticle({ warnedByStage0: false });

    await io.updateFrontmatter(path, { warnedByStage0: true });

    const fm = await readFrontmatter(path);
    expect(fm.warnedByStage0).toBe(true);
  });

  it('case 5: deep-merge only reaches one level — nested child is replaced wholesale', async () => {
    path = await tmpArticle({
      dedup: {
        tribunalVerdict: {
          class: 'soft-dup',
          matchedSlugs: ['old-a', 'old-b'],
          score: 6,
        },
      },
    });

    await io.updateFrontmatter(path, {
      dedup: {
        tribunalVerdict: {
          class: 'hard-dup',
          matchedSlugs: ['new-a'],
        },
      },
    });

    const fm = await readFrontmatter(path);
    const verdict = (fm.dedup as Record<string, unknown>).tribunalVerdict as Record<string, unknown>;
    // class replaced.
    expect(verdict.class).toBe('hard-dup');
    // matchedSlugs replaced (no concat with ['old-a', 'old-b']).
    expect(verdict.matchedSlugs).toEqual(['new-a']);
    // score NOT preserved from old verdict — child object replaced wholesale.
    expect(verdict.score).toBeUndefined();
  });

  it('case 6: type mismatch (array vs object) — incoming wins, no merge', async () => {
    // Guards against a future refactor that naively spreads objects into arrays.
    path = await tmpArticle({ dedup: ['legacy-array-form'] });

    await io.updateFrontmatter(path, {
      dedup: { tribunalVerdict: { class: 'hard-dup' } },
    });

    const fm = await readFrontmatter(path);
    expect(fm.dedup).toEqual({ tribunalVerdict: { class: 'hard-dup' } });
  });
});
