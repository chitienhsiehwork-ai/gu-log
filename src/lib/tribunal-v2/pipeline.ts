/**
 * Tribunal v2 — Pipeline Orchestrator
 *
 * State machine that drives a single article through Stages 0→4.
 * Stage runners are pluggable async interfaces — real LLM calls come later.
 *
 * Design: see `.score-loop/specs/tribunal-v2-mental-model.md`
 */

import type {
  WorthinessJudgeOutput,
  VibeJudgeOutput,
  FinalVibeJudgeOutput,
  FreshEyesJudgeOutput,
  FactLibJudgeOutput,
  FactCorrectorOutput,
  LibrarianOutput,
} from './types';
import { MAX_LOOPS } from './types';

// ---------------------------------------------------------------------------
// Pipeline State Types
// ---------------------------------------------------------------------------

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'needs_review';

export interface StageResult<T> {
  status: StageStatus;
  loops: number;
  maxLoops: number;
  output?: T;          // judge/worker output from final loop
  history: T[];        // all loop outputs for debugging
  startedAt?: string;  // ISO 8601
  completedAt?: string;
}

export interface PipelineState {
  articlePath: string;       // e.g. "src/content/posts/cp-280-slug.mdx"
  articleBranch: string;     // e.g. "tribunal/2026-04-11-cp-280-slug"
  status: 'running' | 'passed' | 'failed' | 'needs_review';
  currentStage: number;      // 0-4 (Stage 5 translation is separate)
  crossRunAttempt: number;   // 1-3, NEEDS_REVIEW at 3

  stages: {
    stage0: StageResult<WorthinessJudgeOutput>;
    stage1: StageResult<VibeJudgeOutput>;
    stage2: StageResult<FreshEyesJudgeOutput>;
    stage3: StageResult<FactLibJudgeOutput> & {
      factCorrectorOutput?: FactCorrectorOutput;
      librarianOutput?: LibrarianOutput;
    };
    stage4: StageResult<FinalVibeJudgeOutput>;
  };

  startedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Stage Runner Interface
// ---------------------------------------------------------------------------

/**
 * A stage runner is a pluggable async function that executes one stage.
 * Real implementations will invoke CC agents; tests can mock these.
 */
export interface StageRunner<TInput, TOutput> {
  run(input: TInput, feedback?: string): Promise<TOutput>;
}

/**
 * Configuration for the pipeline — injectable stage runners.
 * Enables testing with mocks and swapping implementations.
 */
export interface PipelineConfig {
  runners: {
    stage0Judge: StageRunner<{ articleContent: string }, WorthinessJudgeOutput>;
    stage1Judge: StageRunner<{ articleContent: string }, VibeJudgeOutput>;
    stage1Writer: StageRunner<{ articleContent: string; feedback: string }, { content: string }>;
    stage2Judge: StageRunner<{ articleContent: string }, FreshEyesJudgeOutput>;
    stage2Writer: StageRunner<{ articleContent: string; feedback: string }, { content: string }>;
    stage3FactCorrector: StageRunner<{ articleContent: string; sourceUrl: string }, FactCorrectorOutput>;
    stage3Librarian: StageRunner<{ articleContent: string }, LibrarianOutput>;
    stage3Judge: StageRunner<{ articleContent: string }, FactLibJudgeOutput>;
    stage4Judge: StageRunner<{ articleContent: string; stage1Scores: VibeJudgeOutput['scores'] }, FinalVibeJudgeOutput>;
    stage4Writer: StageRunner<{ articleContent: string; feedback: string }, { content: string }>;
  };

  git: {
    createBranch(name: string): Promise<void>;
    commit(message: string): Promise<string>; // returns commit hash
    squashMerge(branch: string, commitMessage: string): Promise<void>;
  };

  io: {
    readArticle(path: string): Promise<string>;
    writeArticle(path: string, content: string): Promise<void>;
    updateFrontmatter(path: string, updates: Record<string, unknown>): Promise<void>;
    extractSourceUrl(path: string): Promise<string>;
  };

  onProgress?: (state: PipelineState) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeStageResult<T>(maxLoops: number): StageResult<T> {
  return { status: 'pending', loops: 0, maxLoops, history: [] };
}

function initPipelineState(articlePath: string, branchName: string): PipelineState {
  return {
    articlePath,
    articleBranch: branchName,
    status: 'running',
    currentStage: 0,
    crossRunAttempt: 1,
    stages: {
      stage0: makeStageResult(MAX_LOOPS.STAGE_0),
      stage1: makeStageResult(MAX_LOOPS.STAGE_1),
      stage2: makeStageResult(MAX_LOOPS.STAGE_2),
      stage3: makeStageResult(MAX_LOOPS.STAGE_3),
      stage4: makeStageResult(MAX_LOOPS.STAGE_4),
    },
    startedAt: now(),
  };
}

/** Format judge feedback string from improvements + critical_issues */
function formatFeedback(output: { improvements?: Record<string, string>; critical_issues?: string[] }): string {
  const parts: string[] = [];

  if (output.critical_issues?.length) {
    parts.push('Critical issues:');
    for (const issue of output.critical_issues) {
      parts.push(`  - ${issue}`);
    }
  }

  if (output.improvements) {
    parts.push('Improvement suggestions:');
    for (const [dim, suggestion] of Object.entries(output.improvements)) {
      parts.push(`  - ${dim}: ${suggestion}`);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Stage Executors
// ---------------------------------------------------------------------------

/**
 * Stage 0: Worthiness Gate
 * All WARN mode — always advances. If scores are low, marks frontmatter.
 */
async function runStage0(
  state: PipelineState,
  config: PipelineConfig,
): Promise<void> {
  const stage = state.stages.stage0;
  if (stage.status === 'passed' || stage.status === 'skipped') return;

  stage.status = 'running';
  stage.startedAt = now();
  await config.onProgress?.(state);

  const articleContent = await config.io.readArticle(state.articlePath);
  const output = await config.runners.stage0Judge.run({ articleContent });

  stage.loops = 1; // Stage 0 is a single evaluation, no loops
  stage.output = output;
  stage.history.push(output);

  // Stage 0 WARN mode: always passes, but may set frontmatter warning
  if (!output.pass) {
    await config.io.updateFrontmatter(state.articlePath, {
      warnedByStage0: true,
      warnReason: output.reader_friendly_reason,
    });
  }

  stage.status = 'passed'; // Always pass — WARN mode
  stage.completedAt = now();

  await config.git.commit(`tribunal(stage0): worthiness gate — ${output.pass ? 'PASS' : 'WARN'}`);
  await config.onProgress?.(state);
}

/**
 * Standard judge→writer loop for Stages 1, 2.
 * Returns true if stage passed, false if max loops exhausted.
 */
async function runJudgeWriterLoop<TJudge extends { pass: boolean; improvements?: Record<string, string>; critical_issues?: string[] }>(
  state: PipelineState,
  stage: StageResult<TJudge>,
  stageNum: number,
  stageLabel: string,
  config: PipelineConfig,
  judge: (content: string) => Promise<TJudge>,
  writer: (content: string, feedback: string) => Promise<{ content: string }>,
): Promise<boolean> {
  if (stage.status === 'passed' || stage.status === 'skipped') return true;

  stage.status = 'running';
  stage.startedAt = now();
  state.currentStage = stageNum;
  await config.onProgress?.(state);

  for (let loop = 1; loop <= stage.maxLoops; loop++) {
    stage.loops = loop;

    // Run judge
    const articleContent = await config.io.readArticle(state.articlePath);
    const judgeOutput = await judge(articleContent);

    stage.output = judgeOutput;
    stage.history.push(judgeOutput);

    if (judgeOutput.pass) {
      stage.status = 'passed';
      stage.completedAt = now();
      await config.git.commit(`tribunal(stage${stageNum}): ${stageLabel} — PASS @ loop ${loop}/${stage.maxLoops}`);
      await config.onProgress?.(state);
      return true;
    }

    // FAIL — if more loops available, run writer
    if (loop < stage.maxLoops) {
      const feedback = formatFeedback(judgeOutput);
      const writerResult = await writer(articleContent, feedback);
      await config.io.writeArticle(state.articlePath, writerResult.content);
      await config.git.commit(`tribunal(stage${stageNum}): ${stageLabel} writer rewrite — loop ${loop}/${stage.maxLoops}`);
    }
  }

  // Max loops exhausted
  stage.status = 'failed';
  stage.completedAt = now();
  await config.git.commit(`tribunal(stage${stageNum}): ${stageLabel} — FAIL (max loops exhausted)`);
  await config.onProgress?.(state);
  return false;
}

/**
 * Stage 3: FactLib — Worker-first pattern.
 * FactCorrector → Librarian → Combined Judge. Loop back to workers on fail.
 */
async function runStage3(
  state: PipelineState,
  config: PipelineConfig,
): Promise<boolean> {
  const stage = state.stages.stage3;
  if (stage.status === 'passed' || stage.status === 'skipped') return true;

  stage.status = 'running';
  stage.startedAt = now();
  state.currentStage = 3;
  await config.onProgress?.(state);

  const sourceUrl = await config.io.extractSourceUrl(state.articlePath);

  for (let loop = 1; loop <= stage.maxLoops; loop++) {
    stage.loops = loop;

    // Worker-first: FactCorrector → Librarian → Judge
    const articleContent = await config.io.readArticle(state.articlePath);

    // Session 1: FactCorrector
    const factOutput = await config.runners.stage3FactCorrector.run({
      articleContent,
      sourceUrl,
    });
    stage.factCorrectorOutput = factOutput;

    // If FactCorrector made changes, write them
    // (the runner is responsible for returning the modified article via io)
    await config.git.commit(`tribunal(stage3): FactCorrector — loop ${loop}/${stage.maxLoops}`);

    // Session 2: Librarian (runs on FactCorrector's output — causal dependency)
    const articleAfterFact = await config.io.readArticle(state.articlePath);
    const libOutput = await config.runners.stage3Librarian.run({
      articleContent: articleAfterFact,
    });
    stage.librarianOutput = libOutput;
    await config.git.commit(`tribunal(stage3): Librarian — loop ${loop}/${stage.maxLoops}`);

    // Combined Judge
    const articleAfterWorkers = await config.io.readArticle(state.articlePath);
    const judgeOutput = await config.runners.stage3Judge.run({
      articleContent: articleAfterWorkers,
    });

    stage.output = judgeOutput;
    stage.history.push(judgeOutput);

    if (judgeOutput.pass) {
      stage.status = 'passed';
      stage.completedAt = now();
      await config.git.commit(`tribunal(stage3): FactLib — PASS @ loop ${loop}/${stage.maxLoops}`);
      await config.onProgress?.(state);
      return true;
    }

    // FAIL — if more loops, workers will re-run with judge feedback
    if (loop < stage.maxLoops) {
      await config.git.commit(`tribunal(stage3): FactLib judge — FAIL, looping back to workers`);
    }
  }

  stage.status = 'failed';
  stage.completedAt = now();
  await config.git.commit(`tribunal(stage3): FactLib — FAIL (max loops exhausted)`);
  await config.onProgress?.(state);
  return false;
}

/**
 * Stage 4: Final Vibe — relative pass bar, no-block-on-fail.
 * On fail: records degradation, does NOT stop pipeline.
 */
async function runStage4(
  state: PipelineState,
  config: PipelineConfig,
): Promise<void> {
  const stage = state.stages.stage4;
  if (stage.status === 'passed' || stage.status === 'skipped') return;

  stage.status = 'running';
  stage.startedAt = now();
  state.currentStage = 4;
  await config.onProgress?.(state);

  // Need Stage 1 scores for relative comparison
  const stage1Output = state.stages.stage1.output;
  if (!stage1Output) {
    // Stage 1 must have passed to reach here — defensive check
    stage.status = 'skipped';
    stage.completedAt = now();
    await config.onProgress?.(state);
    return;
  }

  for (let loop = 1; loop <= stage.maxLoops; loop++) {
    stage.loops = loop;

    const articleContent = await config.io.readArticle(state.articlePath);
    const judgeOutput = await config.runners.stage4Judge.run({
      articleContent,
      stage1Scores: stage1Output.scores,
    });

    stage.output = judgeOutput;
    stage.history.push(judgeOutput);

    if (judgeOutput.pass) {
      stage.status = 'passed';
      stage.completedAt = now();
      await config.git.commit(`tribunal(stage4): Final Vibe — PASS @ loop ${loop}/${stage.maxLoops}`);
      await config.onProgress?.(state);
      return;
    }

    // FAIL — try writer if more loops
    if (loop < stage.maxLoops) {
      const feedback = formatFeedback(judgeOutput);
      const writerResult = await config.runners.stage4Writer.run({ articleContent, feedback });
      await config.io.writeArticle(state.articlePath, writerResult.content);
      await config.git.commit(`tribunal(stage4): Final Vibe writer — loop ${loop}/${stage.maxLoops}`);
    }
  }

  // Stage 4 fail does NOT block publish — record degradation
  stage.status = 'failed';
  stage.completedAt = now();

  const finalOutput = stage.output;
  if (finalOutput?.is_degraded) {
    await config.io.updateFrontmatter(state.articlePath, {
      stage4Degraded: true,
      stage4DegradedDimensions: finalOutput.degraded_dimensions,
      stage4Scores: finalOutput.scores,
    });
  }

  await config.git.commit(`tribunal(stage4): Final Vibe — degraded (non-blocking)`);
  await config.onProgress?.(state);
}

// ---------------------------------------------------------------------------
// Main Pipeline Orchestrator
// ---------------------------------------------------------------------------

/** Maximum cross-run attempts before marking NEEDS_REVIEW */
const MAX_CROSS_RUN_ATTEMPTS = 3;

/**
 * Run the full tribunal pipeline for a single article.
 *
 * Returns the final PipelineState. Does NOT handle quota pacing
 * (that's the caller's responsibility).
 */
export async function runPipeline(
  articlePath: string,
  config: PipelineConfig,
  existingState?: Partial<PipelineState>,
): Promise<PipelineState> {
  // Import git-format for branch naming (lazy to avoid circular deps)
  const { tribunalBranchName } = await import('./git-format');
  const branchName = existingState?.articleBranch ?? tribunalBranchName(articlePath);

  // Initialize or resume state
  const state: PipelineState = existingState?.stages
    ? {
        ...initPipelineState(articlePath, branchName),
        ...existingState,
        articlePath,
        articleBranch: branchName,
        status: 'running',
      } as PipelineState
    : initPipelineState(articlePath, branchName);

  // Check cross-run retry cap
  if (state.crossRunAttempt > MAX_CROSS_RUN_ATTEMPTS) {
    state.status = 'needs_review';
    state.completedAt = now();
    await config.onProgress?.(state);
    return state;
  }

  // Create tribunal branch (idempotent — git no-ops if branch exists)
  await config.git.createBranch(branchName);

  // --- Stage 0: Worthiness Gate (WARN mode, always continues) ---
  await runStage0(state, config);

  // --- Stage 1: Vibe (standard judge→writer loop) ---
  const stage1Passed = await runJudgeWriterLoop(
    state,
    state.stages.stage1,
    1,
    'Vibe',
    config,
    (content) => config.runners.stage1Judge.run({ articleContent: content }),
    (content, feedback) => config.runners.stage1Writer.run({ articleContent: content, feedback }),
  );

  if (!stage1Passed) {
    state.status = 'failed';
    state.completedAt = now();
    await config.onProgress?.(state);
    return state;
  }

  // --- Stage 2: FreshEyes (standard judge→writer loop) ---
  const stage2Passed = await runJudgeWriterLoop(
    state,
    state.stages.stage2,
    2,
    'FreshEyes',
    config,
    (content) => config.runners.stage2Judge.run({ articleContent: content }),
    (content, feedback) => config.runners.stage2Writer.run({ articleContent: content, feedback }),
  );

  if (!stage2Passed) {
    state.status = 'failed';
    state.completedAt = now();
    await config.onProgress?.(state);
    return state;
  }

  // --- Stage 3: FactLib (worker-first) ---
  const stage3Passed = await runStage3(state, config);

  if (!stage3Passed) {
    state.status = 'failed';
    state.completedAt = now();
    await config.onProgress?.(state);
    return state;
  }

  // --- Stage 4: Final Vibe (relative pass bar, non-blocking) ---
  await runStage4(state, config);

  // --- All stages complete ---
  // Determine final status
  const stage4Failed = state.stages.stage4.status === 'failed';

  if (stage4Failed) {
    // Stage 4 fail is non-blocking — still passes, but with degradation noted
    state.status = 'passed';
  } else {
    state.status = 'passed';
  }

  // Squash merge to main
  const { squashCommitMessage } = await import('./git-format');
  const commitMsg = squashCommitMessage(state);
  await config.git.squashMerge(branchName, commitMsg);

  state.completedAt = now();
  await config.onProgress?.(state);
  return state;
}
