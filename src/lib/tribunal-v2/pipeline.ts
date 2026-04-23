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
import { enforceWriterConstraints } from './writer-constraints';
import { checkFinalVibePassBar } from './pass-bar';

// ---------------------------------------------------------------------------
// Pipeline State Types
// ---------------------------------------------------------------------------

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'needs_review';

export interface StageResult<T> {
  status: StageStatus;
  loops: number;
  maxLoops: number;
  output?: T; // judge/worker output from final loop
  history: T[]; // all loop outputs for debugging
  startedAt?: string; // ISO 8601
  completedAt?: string;
}

export interface PipelineState {
  articlePath: string; // e.g. "src/content/posts/cp-280-slug.mdx"
  articleBranch: string; // e.g. "tribunal/2026-04-11-cp-280-slug"
  status: 'running' | 'passed' | 'failed' | 'needs_review';
  currentStage: number; // 0-4 (Stage 5 translation is separate)
  crossRunAttempt: number; // 1-3, NEEDS_REVIEW at 3

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
    stage3FactCorrector: StageRunner<
      { articleContent: string; sourceUrl: string },
      FactCorrectorOutput
    >;
    stage3Librarian: StageRunner<{ articleContent: string }, LibrarianOutput>;
    stage3Judge: StageRunner<{ articleContent: string }, FactLibJudgeOutput>;
    stage4Judge: StageRunner<
      { articleContent: string; stage1Scores: VibeJudgeOutput['scores'] },
      FinalVibeJudgeOutput
    >;
    stage4Writer: StageRunner<{ articleContent: string; feedback: string }, { content: string }>;
  };

  git: {
    createBranch(name: string): Promise<void>;
    /**
     * Commit `paths` with `message`. Callers pass an explicit pathspec so
     * the tribunal branch only picks up pipeline-owned files (never a blind
     * `git add -A`). When `paths` is empty/omitted or nothing ends up
     * staged, an `--allow-empty` marker commit is created for audit-trail
     * continuity. Returns the new commit hash.
     */
     commit(message: string, paths?: string[]): Promise<string>;
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

/**
 * Guard against judge agents silently mutating the article.
 *
 * Judges run under `claude --dangerously-skip-permissions` with full Write
 * access, and read untrusted article content verbatim into their prompts.
 * A prompt injection in the article body, or plain agent drift, could
 * push a judge to rewrite the file during its run — which we'd then
 * silently commit if the orchestrator assumed the article was untouched.
 *
 * Snapshot the article before the judge runs; if the file changed after,
 * revert it and fail-fast with a loud error. Judges must remain read-only.
 */
async function assertJudgeDidNotMutate(
  config: PipelineConfig,
  articlePath: string,
  before: string,
  stageLabel: string
): Promise<void> {
  const after = await config.io.readArticle(articlePath);
  if (after !== before) {
    await config.io.writeArticle(articlePath, before);
    throw new Error(
      `[tribunal-v2] ${stageLabel} judge mutated article — reverted. ` +
        `This should never happen; judges are read-only. Likely cause: prompt ` +
        `injection in article content or agent drift. Investigate before re-running.`
    );
  }
}

/** Format judge feedback string from improvements + critical_issues */
function formatFeedback(output: {
  improvements?: Record<string, string>;
  critical_issues?: string[];
}): string {
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
async function runStage0(state: PipelineState, config: PipelineConfig): Promise<void> {
  const stage = state.stages.stage0;
  if (stage.status === 'passed' || stage.status === 'skipped') return;

  stage.status = 'running';
  stage.startedAt = now();
  await config.onProgress?.(state);

  const articleContent = await config.io.readArticle(state.articlePath);
  const output = await config.runners.stage0Judge.run({ articleContent });
  await assertJudgeDidNotMutate(config, state.articlePath, articleContent, 'stage0');

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

  await config.git.commit(
    `tribunal(stage0): worthiness gate — ${output.pass ? 'PASS' : 'WARN'}`,
    [state.articlePath]
  );
  await config.onProgress?.(state);
}

/**
 * Standard judge→writer loop for Stages 1, 2.
 * Returns true if stage passed, false if max loops exhausted.
 */
async function runJudgeWriterLoop<
  TJudge extends {
    pass: boolean;
    improvements?: Record<string, string>;
    critical_issues?: string[];
  },
>(
  state: PipelineState,
  stage: StageResult<TJudge>,
  stageNum: number,
  stageLabel: string,
  config: PipelineConfig,
  judge: (content: string) => Promise<TJudge>,
  writer: (content: string, feedback: string) => Promise<{ content: string }>
): Promise<boolean> {
  if (stage.status === 'passed' || stage.status === 'skipped') return true;

  stage.status = 'running';
  stage.startedAt = now();
  state.currentStage = stageNum;
  await config.onProgress?.(state);

  // Persistent constraint-violation feedback carried across loops — once the
  // writer violates a structural invariant, we remind it on every subsequent
  // loop until the violation is gone (cheap insurance against repeat offenses).
  let pendingConstraintFeedback = '';

  for (let loop = 1; loop <= stage.maxLoops; loop++) {
    stage.loops = loop;

    // Run judge
    const articleContent = await config.io.readArticle(state.articlePath);
    const judgeOutput = await judge(articleContent);
    await assertJudgeDidNotMutate(
      config,
      state.articlePath,
      articleContent,
      `stage${stageNum}`
    );

    stage.output = judgeOutput;
    stage.history.push(judgeOutput);

    if (judgeOutput.pass) {
      stage.status = 'passed';
      stage.completedAt = now();
      // No-path marker: the judge is read-only, so any article changes
      // for this stage were already committed by prior writer loops.
      // Using a marker prevents leaking undetected judge mutations even
      // if the assertion above missed something.
      await config.git.commit(
        `tribunal(stage${stageNum}): ${stageLabel} — PASS @ loop ${loop}/${stage.maxLoops}`
      );
      await config.onProgress?.(state);
      return true;
    }

    // FAIL — if more loops available, run writer
    if (loop < stage.maxLoops) {
      const judgeFeedback = formatFeedback(judgeOutput);
      const feedback = pendingConstraintFeedback
        ? `STRUCTURAL CONSTRAINTS (previous rewrite was rejected — MUST fix these this time):\n${pendingConstraintFeedback}\n\n${judgeFeedback}`
        : judgeFeedback;

      const writerResult = await writer(articleContent, feedback);
      await config.io.writeArticle(state.articlePath, writerResult.content);

      // Enforce writer-constraints BEFORE committing — catches URL/heading/
      // frontmatter drift and 你/我 pronoun leaks that the pre-commit hook
      // would otherwise reject (which would crash the pipeline).
      const afterContent = await config.io.readArticle(state.articlePath);
      const constraints = await enforceWriterConstraints(
        articleContent,
        afterContent,
        state.articlePath
      );

      if (!constraints.pass) {
        // Revert the writer's changes and treat this loop as a writer failure.
        await config.io.writeArticle(state.articlePath, articleContent);
        pendingConstraintFeedback = constraints.feedback;
        await config.git.commit(
          `tribunal(stage${stageNum}): ${stageLabel} writer rejected (constraint violations) — loop ${loop}/${stage.maxLoops}`
        );
        continue;
      }

      // Writer passed structural checks — clear the pending feedback.
      pendingConstraintFeedback = '';
      await config.git.commit(
        `tribunal(stage${stageNum}): ${stageLabel} writer rewrite — loop ${loop}/${stage.maxLoops}`,
        [state.articlePath]
      );
    }
  }

  // Max loops exhausted — marker commit (no article paths to stage)
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
async function runStage3(state: PipelineState, config: PipelineConfig): Promise<boolean> {
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

    // Enforce writer-constraints after FactCorrector — it has scope to rewrite
    // body prose and MUST NOT touch frontmatter/URLs/headings/pronouns.
    {
      const afterFact = await config.io.readArticle(state.articlePath);
      const constraints = await enforceWriterConstraints(
        articleContent,
        afterFact,
        state.articlePath
      );
      if (!constraints.pass) {
        // Revert FactCorrector's changes — treat as worker failure.
        await config.io.writeArticle(state.articlePath, articleContent);
        await config.git.commit(
          `tribunal(stage3): FactCorrector rejected (constraint violations) — loop ${loop}/${stage.maxLoops}`
        );
        // Fall through: Librarian + Judge run on the unmodified article.
      } else {
        await config.git.commit(
          `tribunal(stage3): FactCorrector — loop ${loop}/${stage.maxLoops}`,
          [state.articlePath]
        );
      }
    }

    // Session 2: Librarian (runs on current article state — may or may not
    // include FactCorrector's changes depending on whether they passed)
    const articleBeforeLib = await config.io.readArticle(state.articlePath);
    const libOutput = await config.runners.stage3Librarian.run({
      articleContent: articleBeforeLib,
    });
    stage.librarianOutput = libOutput;

    // Librarian should only add links, never change text/frontmatter/URLs/etc.
    {
      const afterLib = await config.io.readArticle(state.articlePath);
      const constraints = await enforceWriterConstraints(
        articleBeforeLib,
        afterLib,
        state.articlePath
      );
      if (!constraints.pass) {
        await config.io.writeArticle(state.articlePath, articleBeforeLib);
        await config.git.commit(
          `tribunal(stage3): Librarian rejected (constraint violations) — loop ${loop}/${stage.maxLoops}`
        );
      } else {
        await config.git.commit(
          `tribunal(stage3): Librarian — loop ${loop}/${stage.maxLoops}`,
          [state.articlePath]
        );
      }
    }

    // Combined Judge — must be read-only.
    const articleAfterWorkers = await config.io.readArticle(state.articlePath);
    const judgeOutput = await config.runners.stage3Judge.run({
      articleContent: articleAfterWorkers,
    });
    await assertJudgeDidNotMutate(
      config,
      state.articlePath,
      articleAfterWorkers,
      'stage3'
    );

    stage.output = judgeOutput;
    stage.history.push(judgeOutput);

    if (judgeOutput.pass) {
      stage.status = 'passed';
      stage.completedAt = now();
      // No-path marker — workers already committed their passing changes.
      await config.git.commit(
        `tribunal(stage3): FactLib — PASS @ loop ${loop}/${stage.maxLoops}`
      );
      await config.onProgress?.(state);
      return true;
    }

    // dupCheck-only FAIL: fact + library passed, but dupCheck failed.
    // Workers (FactCorrector / Librarian) have no dedup semantics — re-running
    // them cannot fix a dedup misclassification. Skip the worker loop entirely,
    // write the verdict to frontmatter, and mark needs_review for human triage
    // (or Level F gate).
    if (judgeOutput.fact_pass && judgeOutput.library_pass && !judgeOutput.dupCheck_pass) {
      // Extract verdict from improvements.dupCheck if present
      const verdictRaw = judgeOutput.improvements?.dupCheck ?? '';
      const classMatch = verdictRaw.match(/class=([^\s]+)/);
      const actionMatch = verdictRaw.match(/action=([^\s]+)/);
      const slugsMatch = verdictRaw.match(/matchedSlugs=\[([^\]]*)\]/);
      const reasonMatch = verdictRaw.match(/reason=(.+)$/);

      const dupClass = classMatch?.[1] ?? 'unknown';
      const dupAction = actionMatch?.[1] ?? 'unknown';
      const matchedSlugs = slugsMatch?.[1]
        ? slugsMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const reason = reasonMatch?.[1]?.trim() ?? '';
      const score = judgeOutput.scores.dupCheck;

      // Write nested dedup.tribunalVerdict — io adapter deep-merges object
      // values so existing dedup.* fields (e.g. independentDiff from Level C)
      // are preserved rather than overwritten.
      await config.io.updateFrontmatter(state.articlePath, {
        dedup: {
          tribunalVerdict: {
            class: dupClass,
            action: dupAction,
            matchedSlugs,
            score,
            reason,
          },
        },
      });

      stage.status = 'needs_review';
      stage.completedAt = now();
      // Descriptive commit — NOT "max loops exhausted", so humans see the real reason.
      await config.git.commit(
        `stage3: dupCheck FAIL (class=${dupClass} action=${dupAction}) — skip worker loop`,
        [state.articlePath]
      );
      await config.onProgress?.(state);
      return false;
    }

    // General FAIL (fact or library failed) — if more loops, workers will re-run
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
async function runStage4(state: PipelineState, config: PipelineConfig): Promise<void> {
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

  // Persistent constraint-violation feedback carried across loops — same
  // pattern as runJudgeWriterLoop so Stage 4 writer violations get caught
  // before commit (Stage 4 fail is non-blocking but mutations still land
  // on the tribunal branch and get squash-merged into main).
  let pendingConstraintFeedback = '';

  for (let loop = 1; loop <= stage.maxLoops; loop++) {
    stage.loops = loop;

    const articleContent = await config.io.readArticle(state.articlePath);
    const judgeOutput = await config.runners.stage4Judge.run({
      articleContent,
      stage1Scores: stage1Output.scores,
    });
    await assertJudgeDidNotMutate(config, state.articlePath, articleContent, 'stage4');

    // The Stage 4 judge prompt explicitly says the ORCHESTRATOR applies the
    // relative pass bar (no dim drops > 1 from Stage 1). Trusting the
    // model's `pass` boolean defeats that contract — if agent drift or a
    // different rubric ends up in the model's head, degraded drafts can
    // be accepted and skip the degradation marker. Derive pass/degraded
    // deterministically here from scores, and overwrite the model's
    // claim so downstream consumers always see the orchestrator's truth.
    const passBar = checkFinalVibePassBar(judgeOutput.scores, stage1Output.scores);
    judgeOutput.pass = passBar.pass;
    judgeOutput.is_degraded = !passBar.pass;
    judgeOutput.degraded_dimensions = passBar.degradedDimensions.map((d) => d.dim);

    stage.output = judgeOutput;
    stage.history.push(judgeOutput);

    if (judgeOutput.pass) {
      stage.status = 'passed';
      stage.completedAt = now();
      await config.git.commit(
        `tribunal(stage4): Final Vibe — PASS @ loop ${loop}/${stage.maxLoops}`
      );
      await config.onProgress?.(state);
      return;
    }

    // FAIL — try writer if more loops
    if (loop < stage.maxLoops) {
      const judgeFeedback = formatFeedback(judgeOutput);
      const feedback = pendingConstraintFeedback
        ? `STRUCTURAL CONSTRAINTS (previous rewrite was rejected — MUST fix these this time):\n${pendingConstraintFeedback}\n\n${judgeFeedback}`
        : judgeFeedback;

      const writerResult = await config.runners.stage4Writer.run({ articleContent, feedback });
      await config.io.writeArticle(state.articlePath, writerResult.content);

      // Enforce writer-constraints BEFORE committing — Stage 4 has its own
      // dedicated writer (v2-final-vibe-writer) but the same structural
      // invariants apply (URLs / headings / frontmatter / pronouns).
      const afterContent = await config.io.readArticle(state.articlePath);
      const constraints = await enforceWriterConstraints(
        articleContent,
        afterContent,
        state.articlePath
      );

      if (!constraints.pass) {
        await config.io.writeArticle(state.articlePath, articleContent);
        pendingConstraintFeedback = constraints.feedback;
        await config.git.commit(
          `tribunal(stage4): Final Vibe writer rejected (constraint violations) — loop ${loop}/${stage.maxLoops}`
        );
        continue;
      }

      pendingConstraintFeedback = '';
      await config.git.commit(
        `tribunal(stage4): Final Vibe writer — loop ${loop}/${stage.maxLoops}`,
        [state.articlePath]
      );
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

  await config.git.commit(
    `tribunal(stage4): Final Vibe — degraded (non-blocking)`,
    [state.articlePath]
  );
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
  existingState?: Partial<PipelineState>
): Promise<PipelineState> {
  // Import git-format for branch naming (lazy to avoid circular deps)
  const { tribunalBranchName } = await import('./git-format');
  const branchName = existingState?.articleBranch ?? tribunalBranchName(articlePath);

  // Initialize or resume state
  const state: PipelineState = existingState?.stages
    ? ({
        ...initPipelineState(articlePath, branchName),
        ...existingState,
        articlePath,
        articleBranch: branchName,
        status: 'running',
      } as PipelineState)
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
    (content, feedback) => config.runners.stage1Writer.run({ articleContent: content, feedback })
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
    (content, feedback) => config.runners.stage2Writer.run({ articleContent: content, feedback })
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
    // Propagate stage-level status: 'needs_review' (dupCheck-only FAIL) vs
    // 'failed' (fact/library exhausted max loops). Do NOT flatten both paths
    // into 'failed' — scripts/tribunal-v2-run.ts uses exit code 3 for
    // needs_review and exit code 1 for failed; CI/orchestrator behavior differs.
    state.status =
      state.stages.stage3.status === 'needs_review' ? 'needs_review' : 'failed';
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
