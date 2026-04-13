/**
 * Tribunal v2 — Pass Bar Utilities
 *
 * Pure functions for computing pass/fail for each stage.
 * All composites use Math.floor() (integer制).
 */

import { PASS_BARS } from './types';
import type { VibeJudgeOutput } from './types';

type VibeScores = VibeJudgeOutput['scores'];

const VIBE_DIMS = ['persona', 'clawdNote', 'vibe', 'clarity', 'narrative'] as const;

/** Check if Stage 1 Vibe scores pass the bar */
export function checkVibePassBar(scores: VibeScores): {
  pass: boolean;
  composite: number;
  hasHighlight: boolean;
  failedDimensions: string[];
} {
  // Validate all 5 dims present
  for (const dim of VIBE_DIMS) {
    if (scores[dim] === undefined || scores[dim] === null) {
      throw new Error(`Missing required dimension: ${dim}`);
    }
  }

  const values = VIBE_DIMS.map((d) => scores[d]);
  const composite = Math.floor(values.reduce((a, b) => a + b, 0) / values.length);
  const hasHighlight = Math.max(...values) >= PASS_BARS.STAGE_1_HIGHLIGHT;
  const failedDimensions = VIBE_DIMS.filter((d) => scores[d] < PASS_BARS.STAGE_1_MIN_DIMENSION);

  const pass =
    composite >= PASS_BARS.STAGE_1_COMPOSITE &&
    hasHighlight &&
    failedDimensions.length === 0;

  return { pass, composite, hasHighlight, failedDimensions };
}

/** Check if Stage 4 Final Vibe passes the relative bar */
export function checkFinalVibePassBar(
  currentScores: VibeScores,
  stage1Scores: VibeScores,
): {
  pass: boolean;
  degradedDimensions: Array<{ dim: string; stage1: number; current: number; drop: number }>;
} {
  const degradedDimensions: Array<{ dim: string; stage1: number; current: number; drop: number }> = [];

  for (const dim of VIBE_DIMS) {
    const drop = stage1Scores[dim] - currentScores[dim];
    if (drop > PASS_BARS.STAGE_4_MAX_REGRESSION) {
      degradedDimensions.push({
        dim,
        stage1: stage1Scores[dim],
        current: currentScores[dim],
        drop,
      });
    }
  }

  return {
    pass: degradedDimensions.length === 0,
    degradedDimensions,
  };
}

/** Check if Stage 2 FreshEyes passes */
export function checkFreshEyesPassBar(scores: {
  readability: number;
  firstImpression: number;
}): {
  pass: boolean;
  composite: number;
} {
  const composite = Math.floor((scores.readability + scores.firstImpression) / 2);
  return {
    pass: composite >= PASS_BARS.STAGE_2_COMPOSITE,
    composite,
  };
}

/** Check if Stage 3 FactLib passes (independent fact_pass AND library_pass) */
export function checkFactLibPassBar(scores: {
  factAccuracy: number;
  sourceFidelity: number;
  linkCoverage: number;
  linkRelevance: number;
}): {
  pass: boolean;
  fact_pass: boolean;
  library_pass: boolean;
} {
  const fact_pass =
    Math.floor((scores.factAccuracy + scores.sourceFidelity) / 2) >= PASS_BARS.STAGE_3_FACT_COMPOSITE;
  const library_pass =
    Math.floor((scores.linkCoverage + scores.linkRelevance) / 2) >= PASS_BARS.STAGE_3_LIBRARY_COMPOSITE;

  return {
    pass: fact_pass && library_pass,
    fact_pass,
    library_pass,
  };
}
