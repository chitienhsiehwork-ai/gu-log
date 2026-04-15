/**
 * Tribunal v2 — Pipeline orchestrator tests.
 *
 * Deterministic mock-runner tests that cover the writer-constraint
 * enforcement paths added in commit 6e9b5ee9 / f520ffaa and the Stage 4
 * parity fix. Uses a real IO adapter against a tmp .mdx file so the
 * `scripts/check-pronoun-clarity.mjs` subprocess has something to read;
 * the git adapter is a mock that records commit messages only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPipeline, type PipelineConfig } from '../../src/lib/tribunal-v2/pipeline';
import { buildIoAdapter } from '../../src/lib/tribunal-v2/adapters/io';
import type {
  WorthinessJudgeOutput,
  VibeJudgeOutput,
  FinalVibeJudgeOutput,
  FreshEyesJudgeOutput,
  FactLibJudgeOutput,
  FactCorrectorOutput,
  LibrarianOutput,
} from '../../src/lib/tribunal-v2/types';

// ---------------------------------------------------------------------------
// Fixture article — valid frontmatter, no 你/我 in body, one URL, two headings
// ---------------------------------------------------------------------------

const MINIMAL_ARTICLE = `---
title: "Test Article"
ticketId: CP-999
slug: test-article
lang: "zh-tw"
date: 2026-04-16
source:
  url: "https://example.com/source"
tags:
  - test
---

# 測試文章

ShroomDog 想分享這段內容。Clawd 覺得 [documentation](https://example.com/docs) 是起點。

## 結論

Clawd 覺得結束了。
`;

// ---------------------------------------------------------------------------
// Judge output factories (deterministic, minimal v2 shape)
// ---------------------------------------------------------------------------

function vibe(pass: boolean, scores: VibeJudgeOutput['scores']): VibeJudgeOutput {
  const composite = Math.floor(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
  return {
    pass,
    scores,
    composite,
    ...(pass ? {} : { improvements: { persona: 'needs work' }, critical_issues: ['flat'] }),
    judge_model: 'mock',
    judge_version: '2.0.0',
    timestamp: '2026-04-16T00:00:00Z',
  };
}

function stage0Pass(): WorthinessJudgeOutput {
  return {
    pass: true,
    scores: { coreInsight: 9, expandability: 9, audienceRelevance: 9 },
    composite: 9,
    warned: false,
    internal_reason: 'strong',
    reader_friendly_reason: '好題材',
    judge_model: 'mock',
    judge_version: '2.0.0',
    timestamp: '2026-04-16T00:00:00Z',
  };
}

const PASSING_SCORES: VibeJudgeOutput['scores'] = {
  persona: 9,
  clawdNote: 8,
  vibe: 8,
  clarity: 8,
  narrative: 8,
};

const FAILING_SCORES: VibeJudgeOutput['scores'] = {
  persona: 7,
  clawdNote: 7,
  vibe: 7,
  clarity: 7,
  narrative: 7,
};

function freshEyesPass(): FreshEyesJudgeOutput {
  return {
    pass: true,
    scores: { readability: 8, firstImpression: 8 },
    composite: 8,
    judge_model: 'mock',
    judge_version: '2.0.0',
    timestamp: '2026-04-16T00:00:00Z',
  };
}

function factLibPass(): FactLibJudgeOutput {
  return {
    pass: true,
    scores: { factAccuracy: 8, sourceFidelity: 8, linkCoverage: 8, linkRelevance: 8 },
    composite: 8,
    fact_pass: true,
    library_pass: true,
    judge_model: 'mock',
    judge_version: '2.0.0',
    timestamp: '2026-04-16T00:00:00Z',
  };
}

function finalVibe(
  pass: boolean,
  scores: VibeJudgeOutput['scores'],
  stage1Scores: VibeJudgeOutput['scores']
): FinalVibeJudgeOutput {
  const composite = Math.floor(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
  const degraded_dimensions = (Object.keys(stage1Scores) as Array<keyof typeof stage1Scores>)
    .filter((k) => stage1Scores[k] - scores[k] > 1)
    .map(String);
  return {
    pass,
    scores,
    composite,
    ...(pass ? {} : { improvements: { persona: 'regressed' }, critical_issues: ['dropped'] }),
    stage_1_scores: stage1Scores,
    degraded_dimensions,
    is_degraded: degraded_dimensions.length > 0,
    judge_model: 'mock',
    judge_version: '2.0.0',
    timestamp: '2026-04-16T00:00:00Z',
  };
}

const emptyFactCorrector = (): FactCorrectorOutput => ({
  changes_made: [],
  flagged_but_not_changed: [],
  source_urls_fetched: [],
  scope_violations_detected: [],
});

const emptyLibrarian = (): LibrarianOutput => ({
  glossary_links_added: [],
  cross_references_added: [],
});

// ---------------------------------------------------------------------------
// Mock git adapter — no filesystem side effects, just records messages
// ---------------------------------------------------------------------------

function mockGit() {
  const commits: string[] = [];
  const branches: string[] = [];
  return {
    commits,
    branches,
    adapter: {
      createBranch: async (name: string) => {
        branches.push(name);
      },
      commit: async (msg: string) => {
        commits.push(msg);
        return `sha-${commits.length}`;
      },
      squashMerge: async () => undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Pass-everywhere config — each test overrides only the runners it cares about
// ---------------------------------------------------------------------------

function passThroughConfig(): PipelineConfig {
  return {
    runners: {
      stage0Judge: { run: async () => stage0Pass() },
      stage1Judge: { run: async () => vibe(true, PASSING_SCORES) },
      stage1Writer: { run: async ({ articleContent }) => ({ content: articleContent }) },
      stage2Judge: { run: async () => freshEyesPass() },
      stage2Writer: { run: async ({ articleContent }) => ({ content: articleContent }) },
      stage3FactCorrector: { run: async () => emptyFactCorrector() },
      stage3Librarian: { run: async () => emptyLibrarian() },
      stage3Judge: { run: async () => factLibPass() },
      stage4Judge: {
        run: async ({ stage1Scores }) => finalVibe(true, stage1Scores, stage1Scores),
      },
      stage4Writer: { run: async ({ articleContent }) => ({ content: articleContent }) },
    },
    git: mockGit().adapter,
    io: buildIoAdapter(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pipeline — writer-constraint enforcement', () => {
  let tmpDir: string;
  let articlePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tribunal-v2-pipeline-test-'));
    articlePath = join(tmpDir, 'cp-999-test.mdx');
    await writeFile(articlePath, MINIMAL_ARTICLE, 'utf-8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Finding #6a — Stage 1 constraint-revert: writer mutates URL, gets
  // reverted, next writer call receives STRUCTURAL CONSTRAINTS feedback.
  // -------------------------------------------------------------------------
  it('Stage 1: reverts writer output on URL mutation and injects constraint feedback on retry', async () => {
    const writerFeedbacks: string[] = [];
    let writerCalls = 0;
    let judgeCalls = 0;

    const git = mockGit();
    const config: PipelineConfig = {
      ...passThroughConfig(),
      git: git.adapter,
      runners: {
        ...passThroughConfig().runners,
        stage1Judge: {
          run: async () => {
            judgeCalls++;
            // Loop 1/2: FAIL so writer runs. Loop 3: PASS.
            return judgeCalls >= 3 ? vibe(true, PASSING_SCORES) : vibe(false, FAILING_SCORES);
          },
        },
        stage1Writer: {
          run: async ({ articleContent, feedback }) => {
            writerCalls++;
            writerFeedbacks.push(feedback);
            if (writerCalls === 1) {
              // Mutate URL → rejected
              return {
                content: articleContent.replace(
                  'https://example.com/docs',
                  'https://evil.example.com/docs'
                ),
              };
            }
            // Second call — preserve URL, tweak body only
            return {
              content: articleContent.replace(
                'ShroomDog 想分享這段內容。',
                'ShroomDog 想分享這段已修訂的內容。'
              ),
            };
          },
        },
      },
    };

    const final = await runPipeline(articlePath, config);

    expect(final.status).toBe('passed');
    expect(final.stages.stage1.status).toBe('passed');
    expect(writerCalls).toBeGreaterThanOrEqual(2);

    // Second writer call saw STRUCTURAL CONSTRAINTS feedback pointing at URL change
    expect(writerFeedbacks[1]).toContain('STRUCTURAL CONSTRAINTS');
    expect(writerFeedbacks[1]).toContain('URLs changed');
    expect(writerFeedbacks[1]).toContain('https://evil.example.com/docs');

    // File on disk: loop-1 mutation was reverted; loop-2's clean edit survived
    const finalContent = await readFile(articlePath, 'utf-8');
    expect(finalContent).toContain('https://example.com/docs');
    expect(finalContent).not.toContain('evil.example.com');
    expect(finalContent).toContain('已修訂的內容');

    // Commit trail includes one 'rejected' marker
    expect(git.commits.some((m) => m.includes('stage1') && m.includes('rejected'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Finding #6b — Stage 3 both-workers-rejected: FactCorrector and Librarian
  // both mutate URLs, both get reverted, Judge sees the original content.
  // -------------------------------------------------------------------------
  it('Stage 3: reverts both FactCorrector and Librarian on URL mutation; Judge sees original', async () => {
    let factCalls = 0;
    let libCalls = 0;
    const judgeContents: string[] = [];

    const git = mockGit();
    const config: PipelineConfig = {
      ...passThroughConfig(),
      git: git.adapter,
      runners: {
        ...passThroughConfig().runners,
        stage3FactCorrector: {
          run: async () => {
            factCalls++;
            const raw = await readFile(articlePath, 'utf-8');
            // Worker mutates URL → constraint rejects it
            await writeFile(
              articlePath,
              raw.replace('https://example.com/docs', 'https://bogus.example.com/docs'),
              'utf-8'
            );
            return emptyFactCorrector();
          },
        },
        stage3Librarian: {
          run: async () => {
            libCalls++;
            const raw = await readFile(articlePath, 'utf-8');
            // Worker mutates URL → constraint rejects it
            await writeFile(
              articlePath,
              raw.replace('https://example.com/source', 'https://wrong.example.com/source'),
              'utf-8'
            );
            return emptyLibrarian();
          },
        },
        stage3Judge: {
          run: async ({ articleContent }) => {
            judgeContents.push(articleContent);
            return factLibPass();
          },
        },
      },
    };

    const final = await runPipeline(articlePath, config);

    expect(final.status).toBe('passed');
    expect(final.stages.stage3.status).toBe('passed');
    expect(factCalls).toBe(1);
    expect(libCalls).toBe(1);

    // Judge input content must contain the original URLs (both reverts succeeded)
    expect(judgeContents[0]).toContain('https://example.com/docs');
    expect(judgeContents[0]).toContain('https://example.com/source');
    expect(judgeContents[0]).not.toContain('bogus.example.com');
    expect(judgeContents[0]).not.toContain('wrong.example.com');

    // Commit trail shows both workers rejected
    expect(
      git.commits.some((m) => m.includes('FactCorrector rejected'))
    ).toBe(true);
    expect(git.commits.some((m) => m.includes('Librarian rejected'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Finding #6c / Finding #5 — Stage 4 writer must also go through
  // constraint enforcement. Without the fix, a Stage 4 writer mutating URLs
  // would land the mutation on the tribunal branch.
  // -------------------------------------------------------------------------
  it('Stage 4: reverts writer output on URL mutation (parity with Stages 1/2)', async () => {
    let writerCalls = 0;
    let judgeCalls = 0;
    const git = mockGit();

    const config: PipelineConfig = {
      ...passThroughConfig(),
      git: git.adapter,
      runners: {
        ...passThroughConfig().runners,
        stage4Judge: {
          run: async ({ stage1Scores }) => {
            judgeCalls++;
            // Always FAIL → triggers writer (and degraded marker at end).
            return finalVibe(false, FAILING_SCORES, stage1Scores);
          },
        },
        stage4Writer: {
          run: async ({ articleContent }) => {
            writerCalls++;
            // Mutate URL — constraint MUST catch and revert
            return {
              content: articleContent.replace(
                'https://example.com/docs',
                'https://malicious.example.com/docs'
              ),
            };
          },
        },
      },
    };

    const final = await runPipeline(articlePath, config);

    // Stage 4 fail is non-blocking → pipeline still reports passed overall
    expect(final.status).toBe('passed');
    expect(final.stages.stage4.status).toBe('failed');
    expect(writerCalls).toBeGreaterThanOrEqual(1);
    expect(judgeCalls).toBeGreaterThanOrEqual(1);

    // The critical assertion: malicious URL must NOT have landed on disk
    const finalContent = await readFile(articlePath, 'utf-8');
    expect(finalContent).toContain('https://example.com/docs');
    expect(finalContent).not.toContain('malicious.example.com');

    // Commit trail shows a Stage 4 rejected marker (proves constraint ran)
    expect(
      git.commits.some((m) => m.includes('stage4') && m.includes('rejected'))
    ).toBe(true);
  });
});
