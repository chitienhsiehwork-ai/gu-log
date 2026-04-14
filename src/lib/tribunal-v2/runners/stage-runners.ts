/**
 * Tribunal v2 — Concrete Stage Runners
 *
 * Each runner implements the `StageRunner<TInput, TOutput>` interface from
 * pipeline.ts and wraps `claude -p --agent <name>` with the correct agent,
 * timeout, and prompt template.
 *
 * Judges read the article from disk via their own Read tool — we pass the path,
 * not the content. Writers modify the article in place via their Write tool.
 */

import type { StageRunner } from '../pipeline';
import type {
  WorthinessJudgeOutput,
  VibeJudgeOutput,
  FinalVibeJudgeOutput,
  FreshEyesJudgeOutput,
  FactLibJudgeOutput,
  FactCorrectorOutput,
  LibrarianOutput,
} from '../types';
import { runJudgeAgent, runWriterAgent } from './claude-cli';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Timeouts (seconds)
// ---------------------------------------------------------------------------

const TIMEOUT = {
  JUDGE_STAGE0: 180,
  JUDGE_VIBE: 300,
  JUDGE_FRESH_EYES: 300,
  JUDGE_FACTLIB: 600,
  WORKER_FACT_CORRECTOR: 600,
  WORKER_LIBRARIAN: 300,
  WRITER_STAGE: 900,
  WRITER_FINAL_VIBE: 900,
} as const;

// ---------------------------------------------------------------------------
// Stage 0 — Worthiness Judge
// ---------------------------------------------------------------------------

export const stage0JudgeRunner: StageRunner<
  { articleContent: string; articlePath?: string },
  WorthinessJudgeOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage0Judge: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<WorthinessJudgeOutput>({
      agent: 'v2-worthiness-judge',
      timeoutSec: TIMEOUT.JUDGE_STAGE0,
      buildPrompt: (outputPath) => `Evaluate worthiness for this post: ${articlePath}

Read the post, then score it on coreInsight / expandability / audienceRelevance per your agent instructions.

Write the v2 WorthinessJudgeOutput JSON to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    return parsed;
  },
};

// ---------------------------------------------------------------------------
// Stage 1 / Stage 4 — Vibe Judge (shared agent, dual-mode)
// ---------------------------------------------------------------------------

export const stage1JudgeRunner: StageRunner<
  { articleContent: string; articlePath?: string },
  VibeJudgeOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage1Judge: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<VibeJudgeOutput>({
      agent: 'v2-vibe-judge',
      timeoutSec: TIMEOUT.JUDGE_VIBE,
      buildPrompt: (outputPath) => `Score this post: ${articlePath}

Setup: read scripts/vibe-scoring-standard.md and WRITING_GUIDELINES.md before scoring.

Write the v2 VibeJudgeOutput JSON to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    return parsed;
  },
};

export const stage4JudgeRunner: StageRunner<
  { articleContent: string; articlePath?: string; stage1Scores: VibeJudgeOutput['scores'] },
  FinalVibeJudgeOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage4Judge: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<FinalVibeJudgeOutput>({
      agent: 'v2-vibe-judge',
      timeoutSec: TIMEOUT.JUDGE_VIBE,
      buildPrompt: (outputPath) => `Score this post (Stage 4 Final Vibe mode): ${articlePath}

Setup: read scripts/vibe-scoring-standard.md and WRITING_GUIDELINES.md before scoring.

Stage 1 reference scores for relative comparison:
${JSON.stringify(input.stage1Scores, null, 2)}

Score the CURRENT version of the post on the same 5 dimensions. The orchestrator will apply the relative pass bar (no dim drops > 1 from Stage 1) — you just score independently.

Output shape is FinalVibeJudgeOutput: include scores, composite, pass (boolean), stage_1_scores (copy the reference above), degraded_dimensions (names of dims that dropped > 1 from Stage 1), is_degraded (any dropped > 1?).

Write the v2 FinalVibeJudgeOutput JSON to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    // Ensure stage_1_scores is populated even if agent forgot
    if (!parsed.stage_1_scores) parsed.stage_1_scores = input.stage1Scores;
    return parsed;
  },
};

// ---------------------------------------------------------------------------
// Stage 2 — Fresh Eyes Judge
// ---------------------------------------------------------------------------

export const stage2JudgeRunner: StageRunner<
  { articleContent: string; articlePath?: string },
  FreshEyesJudgeOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage2Judge: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<FreshEyesJudgeOutput>({
      agent: 'v2-fresh-eyes-judge',
      timeoutSec: TIMEOUT.JUDGE_FRESH_EYES,
      buildPrompt: (outputPath) => `Fresh-eyes review this post: ${articlePath}

Score readability and firstImpression from a 3-month engineer persona per your agent instructions.

Write the v2 FreshEyesJudgeOutput JSON to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    return parsed;
  },
};

// ---------------------------------------------------------------------------
// Stage 3 — FactLib (worker-first)
// ---------------------------------------------------------------------------

export const stage3FactCorrectorRunner: StageRunner<
  { articleContent: string; sourceUrl: string; articlePath?: string },
  FactCorrectorOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage3FactCorrector: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<FactCorrectorOutput>({
      agent: 'v2-fact-corrector',
      timeoutSec: TIMEOUT.WORKER_FACT_CORRECTOR,
      buildPrompt: (outputPath) => `Fact-correct this post: ${articlePath}

Source URL for verification: ${input.sourceUrl}

Scope: body + ShroomDogNote ONLY — do NOT modify ClawdNote content (creative scope).

Per your agent instructions, use the standing checklist, fetch the source URL if helpful, and make in-place factual corrections using your Write tool.

Write the v2 FactCorrectorOutput JSON (summary of changes_made + flagged_but_not_changed + source_urls_fetched + scope_violations_detected) to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    return parsed;
  },
};

export const stage3LibrarianRunner: StageRunner<
  { articleContent: string; articlePath?: string },
  LibrarianOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage3Librarian: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<LibrarianOutput>({
      agent: 'v2-librarian-worker',
      timeoutSec: TIMEOUT.WORKER_LIBRARIAN,
      buildPrompt: (outputPath) => `Add library links to this post: ${articlePath}

Per your agent instructions, add glossary links and cross-references where appropriate. Do NOT modify text or facts — only add links. Use your Write tool to save the updated file.

Write the v2 LibrarianOutput JSON (glossary_links_added + cross_references_added) to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    return parsed;
  },
};

export const stage3JudgeRunner: StageRunner<
  { articleContent: string; articlePath?: string },
  FactLibJudgeOutput
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage3Judge: articlePath required');
      })();

    const { parsed } = await runJudgeAgent<FactLibJudgeOutput>({
      agent: 'v2-factlib-judge',
      timeoutSec: TIMEOUT.JUDGE_FACTLIB,
      buildPrompt: (outputPath) => `Judge FactLib for this post: ${articlePath}

Score factAccuracy / sourceFidelity / linkCoverage / linkRelevance. Set fact_pass (from first 2 dims) and library_pass (from last 2 dims) independently. Overall pass = fact_pass AND library_pass.

Write the v2 FactLibJudgeOutput JSON to: ${outputPath}
Confirm with a one-line status on stdout.`,
    });

    return parsed;
  },
};

// ---------------------------------------------------------------------------
// Writers (Stage 1/2 shared + Stage 4 dedicated)
// ---------------------------------------------------------------------------

export const stage1WriterRunner: StageRunner<
  { articleContent: string; feedback: string; articlePath?: string },
  { content: string }
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage1Writer: articlePath required');
      })();

    await runWriterAgent({
      agent: 'v2-stage-writer',
      timeoutSec: TIMEOUT.WRITER_STAGE,
      prompt: `Rewrite this post to address Stage 1 (Vibe) judge failures: ${articlePath}

Judge feedback (v2 VibeJudgeOutput JSON):
\`\`\`json
${input.feedback}
\`\`\`

Per your agent instructions, use the Write tool to save the rewritten post to the SAME path. Obey writer-constraints (frontmatter / URLs / headings must not change).`,
    });

    // Writer modified the file via its Write tool. Read it back so the
    // pipeline's `io.writeArticle(path, content)` call is a no-op write.
    const content = await readFile(articlePath, 'utf-8');
    return { content };
  },
};

export const stage2WriterRunner: StageRunner<
  { articleContent: string; feedback: string; articlePath?: string },
  { content: string }
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage2Writer: articlePath required');
      })();

    await runWriterAgent({
      agent: 'v2-stage-writer',
      timeoutSec: TIMEOUT.WRITER_STAGE,
      prompt: `Rewrite this post to address Stage 2 (FreshEyes) judge failures: ${articlePath}

Judge feedback (v2 FreshEyesJudgeOutput JSON):
\`\`\`json
${input.feedback}
\`\`\`

Per your agent instructions, use the Write tool to save the rewritten post to the SAME path. Obey writer-constraints (frontmatter / URLs / headings must not change).`,
    });

    const content = await readFile(articlePath, 'utf-8');
    return { content };
  },
};

export const stage4WriterRunner: StageRunner<
  { articleContent: string; feedback: string; articlePath?: string },
  { content: string }
> = {
  async run(input) {
    const articlePath =
      input.articlePath ??
      (() => {
        throw new Error('stage4Writer: articlePath required');
      })();

    await runWriterAgent({
      agent: 'v2-final-vibe-writer',
      timeoutSec: TIMEOUT.WRITER_FINAL_VIBE,
      prompt: `Rewrite this post to address Stage 4 (Final Vibe) regression: ${articlePath}

Judge feedback (v2 FinalVibeJudgeOutput JSON, contains degraded_dimensions + stage_1_scores for reference):
\`\`\`json
${input.feedback}
\`\`\`

Per your agent instructions, focus ONLY on the degraded dimensions (those that dropped > 1 from Stage 1). Use the Write tool to save to the same path. Obey writer-constraints.`,
    });

    const content = await readFile(articlePath, 'utf-8');
    return { content };
  },
};

// ---------------------------------------------------------------------------
// Factory — build a full `PipelineConfig.runners`
// ---------------------------------------------------------------------------

/**
 * Build the `runners` portion of PipelineConfig.
 * The `articlePath` field is injected into each runner call by a wrapper
 * that captures the pipeline's current article path.
 */
export function buildRunners(articlePath: string) {
  // Wrap every runner so input includes articlePath automatically.
  const inject = <TIn, TOut>(
    r: StageRunner<TIn & { articlePath?: string }, TOut>
  ): StageRunner<TIn, TOut> => ({
    run: (input, feedback) => r.run({ ...input, articlePath }, feedback),
  });

  return {
    stage0Judge: inject(stage0JudgeRunner),
    stage1Judge: inject(stage1JudgeRunner),
    stage1Writer: inject(stage1WriterRunner),
    stage2Judge: inject(stage2JudgeRunner),
    stage2Writer: inject(stage2WriterRunner),
    stage3FactCorrector: inject(stage3FactCorrectorRunner),
    stage3Librarian: inject(stage3LibrarianRunner),
    stage3Judge: inject(stage3JudgeRunner),
    stage4Judge: inject(stage4JudgeRunner),
    stage4Writer: inject(stage4WriterRunner),
  };
}
