/**
 * Tribunal v2 — Pass Bar Utilities
 *
 * Pure functions for computing pass/fail for each stage.
 * All composites use Math.floor() (integer制).
 */

import { PASS_BARS } from './types';
import type { VibeJudgeOutput } from './types';

type VibeScores = VibeJudgeOutput['scores'];

// ---------------------------------------------------------------------------
// Version-aware dimension ownership (move-clarity-vibe-to-fresheyes)
//
// `clarity` (pronoun / voice attribution) moves from Vibe → Fresh Eyes for
// posts scored at tribunalVersion >= 9. Older posts keep the legacy ownership.
// The dimension lists below are the SINGLE source for *this module*; gate
// scripts hold their own (intentionally duplicated — see design.md) copies.
// ---------------------------------------------------------------------------

const NEW_RULES_MIN_VERSION = 9;

/** Default version when a caller doesn't supply one — legacy (pre-clarity-move). */
const DEFAULT_TRIBUNAL_VERSION = 8;

const VIBE_DIMS_V8 = ['persona', 'clawdNote', 'vibe', 'clarity', 'narrative'] as const;
const VIBE_DIMS_V9 = ['persona', 'clawdNote', 'vibe', 'narrative'] as const;
const FRESH_EYES_DIMS_V8 = [
  'readability',
  'firstImpression',
  'payoffDensity',
  'lengthFit',
] as const;
const FRESH_EYES_DIMS_V9 = [
  'readability',
  'firstImpression',
  'payoffDensity',
  'lengthFit',
  'clarity',
] as const;

/** Vibe-owned dimensions for the given tribunalVersion. */
export function vibeDims(version: number = DEFAULT_TRIBUNAL_VERSION): readonly string[] {
  return version >= NEW_RULES_MIN_VERSION ? VIBE_DIMS_V9 : VIBE_DIMS_V8;
}

/** Fresh-Eyes-owned dimensions for the given tribunalVersion. */
export function freshEyesDims(version: number = DEFAULT_TRIBUNAL_VERSION): readonly string[] {
  return version >= NEW_RULES_MIN_VERSION ? FRESH_EYES_DIMS_V9 : FRESH_EYES_DIMS_V8;
}

/** Check if Stage 1 Vibe scores pass the bar */
export function checkVibePassBar(
  scores: VibeScores,
  version: number = DEFAULT_TRIBUNAL_VERSION
): {
  pass: boolean;
  composite: number;
  hasHighlight: boolean;
  failedDimensions: string[];
} {
  const dims = vibeDims(version);
  // The owned-dim list is version-resolved (readonly string[]); index the
  // scores object through a string-keyed view so TS doesn't widen to `any`.
  const s = scores as Record<string, number>;

  // Validate all owned dims present
  for (const dim of dims) {
    if (s[dim] === undefined || s[dim] === null) {
      throw new Error(`Missing required dimension: ${dim}`);
    }
  }

  const values = dims.map((d) => s[d]);
  const composite = Math.floor(values.reduce((a, b) => a + b, 0) / values.length);
  const hasHighlight = Math.max(...values) >= PASS_BARS.STAGE_1_HIGHLIGHT;
  const failedDimensions = dims.filter((d) => s[d] < PASS_BARS.STAGE_1_MIN_DIMENSION);

  const pass =
    composite >= PASS_BARS.STAGE_1_COMPOSITE && hasHighlight && failedDimensions.length === 0;

  return { pass, composite, hasHighlight, failedDimensions };
}

/** Check if Stage 4 Final Vibe passes the relative bar */
export function checkFinalVibePassBar(
  currentScores: VibeScores,
  stage1Scores: VibeScores,
  version: number = DEFAULT_TRIBUNAL_VERSION
): {
  pass: boolean;
  degradedDimensions: Array<{ dim: string; stage1: number; current: number; drop: number }>;
} {
  const degradedDimensions: Array<{ dim: string; stage1: number; current: number; drop: number }> =
    [];

  const cur = currentScores as Record<string, number>;
  const s1 = stage1Scores as Record<string, number>;
  for (const dim of vibeDims(version)) {
    const drop = s1[dim] - cur[dim];
    if (drop > PASS_BARS.STAGE_4_MAX_REGRESSION) {
      degradedDimensions.push({
        dim,
        stage1: s1[dim],
        current: cur[dim],
        drop,
      });
    }
  }

  return {
    pass: degradedDimensions.length === 0,
    degradedDimensions,
  };
}

/**
 * Check if Stage 2 FreshEyes passes.
 *
 * For tribunalVersion >= 9 the composite spans 5 dims and `clarity` joins
 * `payoffDensity` / `lengthFit` as a non-compensating hard gate. For <= 8 the
 * legacy 4-dim composite and 2-gate bar apply (no clarity).
 */
export function checkFreshEyesPassBar(
  scores: {
    readability: number;
    firstImpression: number;
    payoffDensity: number;
    lengthFit: number;
    clarity?: number;
  },
  version: number = DEFAULT_TRIBUNAL_VERSION
): {
  pass: boolean;
  composite: number;
} {
  const dims = freshEyesDims(version);
  const values = dims.map((d) => (scores as Record<string, number>)[d]);
  const composite = Math.floor(values.reduce((a, b) => a + b, 0) / values.length);

  const isV9 = version >= NEW_RULES_MIN_VERSION;
  const clarityGate = !isV9 || (scores.clarity ?? 0) >= PASS_BARS.STAGE_2_COMPOSITE;

  return {
    pass:
      composite >= PASS_BARS.STAGE_2_COMPOSITE &&
      scores.payoffDensity >= PASS_BARS.STAGE_2_COMPOSITE &&
      scores.lengthFit >= PASS_BARS.STAGE_2_COMPOSITE &&
      clarityGate,
    composite,
  };
}

/**
 * Check if Stage 3 FactLib passes.
 *
 * Three independent pass bars (Level E — `add-librarian-dupcheck`):
 *   fact_pass    = floor(avg(factAccuracy, sourceFidelity)) >= 8
 *   library_pass = floor(avg(linkCoverage, linkRelevance)) >= 8
 *   dupCheck_pass = dupCheck >= 8
 *
 * overall pass = fact_pass AND library_pass AND dupCheck_pass (無補償)
 */
export function checkFactLibPassBar(scores: {
  factAccuracy: number;
  sourceFidelity: number;
  linkCoverage: number;
  linkRelevance: number;
  dupCheck: number;
}): {
  pass: boolean;
  fact_pass: boolean;
  library_pass: boolean;
  dupCheck_pass: boolean;
} {
  // Runtime type guard for dupCheck (spec R1: integer 0..10).
  // Old judge versions (< 2.1.0) or malformed output may omit dupCheck or send
  // a non-integer. Silent `undefined >= 8 → false` would permanently fail the
  // dupCheck bar without any diagnostic. Throw early with a clear message.
  const raw = scores.dupCheck;
  if (raw === undefined || raw === null) {
    throw new Error(
      `[checkFactLibPassBar] scores.dupCheck is ${raw}. ` +
        `judge_version >= 2.1.0 is required for Level E dupCheck. ` +
        `Check that the judge agent is using the updated fact-checker.md prompt.`
    );
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(
      `[checkFactLibPassBar] scores.dupCheck is not a finite number: ${JSON.stringify(raw)}`
    );
  }
  if (!Number.isInteger(raw)) {
    throw new Error(
      `[checkFactLibPassBar] scores.dupCheck = ${raw} is not an integer. ` +
        `Spec R1 requires integer 0..10. Judge must not output fractional scores.`
    );
  }
  // Clamp to valid range instead of silently passing garbage values.
  if (raw < 0 || raw > 10) {
    throw new Error(
      `[checkFactLibPassBar] scores.dupCheck = ${raw} is outside the valid range [0, 10]. ` +
        `Judge must output an integer between 0 and 10 inclusive.`
    );
  }

  const fact_pass =
    Math.floor((scores.factAccuracy + scores.sourceFidelity) / 2) >=
    PASS_BARS.STAGE_3_FACT_COMPOSITE;
  const library_pass =
    Math.floor((scores.linkCoverage + scores.linkRelevance) / 2) >=
    PASS_BARS.STAGE_3_LIBRARY_COMPOSITE;
  const dupCheck_pass = raw >= PASS_BARS.STAGE_3_DUPCHECK;

  return {
    pass: fact_pass && library_pass && dupCheck_pass,
    fact_pass,
    library_pass,
    dupCheck_pass,
  };
}
