/**
 * Tribunal v2 — Git Format Utilities
 *
 * Branch naming, squash commit messages, and commit message parsing.
 *
 * Decisions:
 * - Branch: `tribunal/YYYY-MM-DD-<slug>` (date prefix for easy chronological lookup)
 * - Commit messages: Unicode OK (繁中 article titles in subject line)
 * - Stage summary embedded in commit body for `git log --grep` analytics
 */

import { basename } from 'node:path';
import type { PipelineState, StageResult } from './pipeline';
import type {
  VibeJudgeOutput,
  FinalVibeJudgeOutput,
  FactLibJudgeOutput,
} from './types';

// ---------------------------------------------------------------------------
// Branch Name
// ---------------------------------------------------------------------------

/**
 * Generate tribunal branch name.
 * Format: `tribunal/2026-04-11-cp-280-slug`
 *
 * Extracts the date from today (branch creation time) and the slug
 * from the article path.
 */
export function tribunalBranchName(articlePath: string): string {
  const slug = basename(articlePath, '.mdx');
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `tribunal/${today}-${slug}`;
}

// ---------------------------------------------------------------------------
// Squash Commit Message
// ---------------------------------------------------------------------------

function formatVibeScores(scores: VibeJudgeOutput['scores']): string {
  return `persona:${scores.persona} clawdNote:${scores.clawdNote} vibe:${scores.vibe} clarity:${scores.clarity} narrative:${scores.narrative}`;
}

function formatStageStatus<T>(label: string, stage: StageResult<T>, detail?: string): string {
  const status = stage.status === 'passed' ? 'PASS' : stage.status === 'failed' ? 'FAIL' : stage.status.toUpperCase();

  let line = `${label}: ${status}`;

  if (stage.loops > 0 && stage.maxLoops > 0) {
    line += ` @ loop ${stage.loops}/${stage.maxLoops}`;
  }

  if (detail) {
    line += ` (${detail})`;
  }

  return line;
}

/**
 * Generate squash merge commit message with stage summary.
 *
 * Example output:
 * ```
 * tribunal: CP-280 延遲降低 40% 的新框架
 *
 * Stage 0: PASS (no warn)
 * Stage 1: PASS @ loop 2/3 (persona:9 clawdNote:8 vibe:9 clarity:8 narrative:8)
 * Stage 2: PASS @ loop 1/2
 * Stage 3: PASS @ loop 1/2 (fact:9 lib:8)
 * Stage 4: PASS @ loop 1/2 (no regression)
 * ```
 */
export function squashCommitMessage(state: PipelineState): string {
  const slug = basename(state.articlePath, '.mdx');
  const lines: string[] = [];

  // Subject line
  lines.push(`tribunal: ${slug}`);
  lines.push('');

  // Stage 0
  const s0 = state.stages.stage0;
  const s0Detail = s0.output
    ? s0.output.pass ? 'no warn' : 'WARN'
    : undefined;
  lines.push(formatStageStatus('Stage 0', s0, s0Detail));

  // Stage 1
  const s1 = state.stages.stage1;
  const s1Detail = s1.output
    ? formatVibeScores(s1.output.scores)
    : undefined;
  lines.push(formatStageStatus('Stage 1', s1, s1Detail));

  // Stage 2
  const s2 = state.stages.stage2;
  lines.push(formatStageStatus('Stage 2', s2));

  // Stage 3
  const s3 = state.stages.stage3;
  const s3Output = s3.output as FactLibJudgeOutput | undefined;
  const s3Detail = s3Output
    ? `fact:${Math.floor((s3Output.scores.factAccuracy + s3Output.scores.sourceFidelity) / 2)} lib:${Math.floor((s3Output.scores.linkCoverage + s3Output.scores.linkRelevance) / 2)} dup:${s3Output.scores.dupCheck ?? 'n/a'}`
    : undefined;
  lines.push(formatStageStatus('Stage 3', s3, s3Detail));

  // Stage 4
  const s4 = state.stages.stage4;
  const s4Output = s4.output as FinalVibeJudgeOutput | undefined;
  let s4Detail: string | undefined;
  if (s4Output) {
    if (s4.status === 'passed') {
      s4Detail = 'no regression';
    } else if (s4Output.is_degraded) {
      s4Detail = `degraded: ${s4Output.degraded_dimensions.join(', ')}`;
    }
  }
  lines.push(formatStageStatus('Stage 4', s4, s4Detail));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Commit Message Parser
// ---------------------------------------------------------------------------

export interface ParsedCommitMessage {
  slug: string;
  stages: Array<{
    stage: number;
    status: string;
    loop?: number;
    maxLoops?: number;
    detail?: string;
  }>;
}

const STAGE_LINE_REGEX = /^Stage (\d): (PASS|FAIL|WARN|PENDING|RUNNING|SKIPPED|NEEDS_REVIEW)(?:\s+@\s+loop\s+(\d+)\/(\d+))?(?:\s+\((.+)\))?$/;

/**
 * Parse a tribunal squash commit message back into structured data.
 * Returns null if the message doesn't match the tribunal format.
 */
export function parseCommitMessage(message: string): ParsedCommitMessage | null {
  const lines = message.split('\n');
  if (!lines[0]?.startsWith('tribunal: ')) return null;

  const slug = lines[0].slice('tribunal: '.length).trim();
  const stages: ParsedCommitMessage['stages'] = [];

  for (const line of lines) {
    const match = STAGE_LINE_REGEX.exec(line.trim());
    if (!match) continue;

    stages.push({
      stage: parseInt(match[1], 10),
      status: match[2],
      loop: match[3] ? parseInt(match[3], 10) : undefined,
      maxLoops: match[4] ? parseInt(match[4], 10) : undefined,
      detail: match[5] || undefined,
    });
  }

  if (stages.length === 0) return null;

  return { slug, stages };
}
