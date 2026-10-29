/**
 * Tribunal v2 pipeline 測試共用的 fixture：最小文章、各 judge 的輸出工廠、
 * 只記 commit 訊息的 git mock，以及全部通過的 runner 設定。
 */

import { type PipelineConfig } from '../../src/lib/tribunal-v2/pipeline';
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

export const MINIMAL_ARTICLE = `---
title: "Test Article"
ticketId: MP-999
slug: test-article
lang: "zh-tw"
date: 2026-04-16
source:
  url: "https://example.com/source"
tags:
  - test
---

# 測試文章

ShroomDog 想分享這段內容。Mogu 覺得 [documentation](https://example.com/docs) 是起點。

## 結論

Mogu 覺得結束了。
`;

// ---------------------------------------------------------------------------
// Judge output factories (deterministic, minimal v2 shape)
// ---------------------------------------------------------------------------

export function vibe(pass: boolean, scores: VibeJudgeOutput['scores']): VibeJudgeOutput {
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

export function stage0Pass(): WorthinessJudgeOutput {
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

export const PASSING_SCORES: VibeJudgeOutput['scores'] = {
  persona: 9,
  moguNote: 8,
  vibe: 8,
  clarity: 8,
  narrative: 8,
};

export const FAILING_SCORES: VibeJudgeOutput['scores'] = {
  persona: 7,
  moguNote: 7,
  vibe: 7,
  clarity: 7,
  narrative: 7,
};

export function freshEyesOutput(
  pass: boolean,
  scores: FreshEyesJudgeOutput['scores'],
  extras: Partial<FreshEyesJudgeOutput> = {}
): FreshEyesJudgeOutput {
  const composite = Math.floor(Object.values(scores).reduce((a, b) => a + b, 0) / 4);
  return {
    pass,
    scores,
    composite,
    judge_model: 'mock',
    judge_version: '2.0.0',
    timestamp: '2026-04-16T00:00:00Z',
    ...extras,
  };
}

export function freshEyesPass(): FreshEyesJudgeOutput {
  return freshEyesOutput(true, {
    readability: 8,
    firstImpression: 8,
    payoffDensity: 8,
    lengthFit: 8,
  });
}

export function factLibPass(): FactLibJudgeOutput {
  return {
    pass: true,
    scores: {
      factAccuracy: 8,
      sourceFidelity: 8,
      linkCoverage: 8,
      linkRelevance: 8,
      dupCheck: 10,
    },
    composite: 8,
    fact_pass: true,
    library_pass: true,
    dupCheck_pass: true,
    judge_model: 'mock',
    judge_version: '2.1.0',
    timestamp: '2026-04-16T00:00:00Z',
  };
}

export function finalVibe(
  pass: boolean,
  scores: VibeJudgeOutput['scores'],
  stage1Scores: VibeJudgeOutput['scores']
): FinalVibeJudgeOutput {
  const composite = Math.floor(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
  const degraded_dimensions = (Object.keys(stage1Scores) as Array<keyof typeof stage1Scores>)
    // clarity is optional on VibeJudgeOutput['scores'] (v9 moved it to freshEyes),
    // so coalesce to 0 for the test factory's regression math.
    .filter((k) => (stage1Scores[k] ?? 0) - (scores[k] ?? 0) > 1)
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

export const emptyFactCorrector = (): FactCorrectorOutput => ({
  changes_made: [],
  flagged_but_not_changed: [],
  source_urls_fetched: [],
  scope_violations_detected: [],
});

export const emptyLibrarian = (): LibrarianOutput => ({
  glossary_links_added: [],
  cross_references_added: [],
});

// ---------------------------------------------------------------------------
// Mock git adapter — no filesystem side effects, just records messages
// ---------------------------------------------------------------------------

export function mockGit() {
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

export function passThroughConfig(): PipelineConfig {
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
