import type { CollectionEntry } from 'astro:content';
import {
  checkFreshEyesPassBar,
  checkVibePassBar,
  freshEyesDims,
  vibeDims,
} from '../lib/tribunal-v2/pass-bar';

type PostScores = NonNullable<CollectionEntry<'posts'>['data']['scores']>;
type JudgeName = (typeof JUDGES)[number];

/** Judges whose composite `.score` counts toward the overall tribunal score. */
const JUDGES = ['vibe', 'factCheck', 'librarian', 'freshEyes'] as const;

/** Featured / homepage publish bar. Posts below this ship, but are badged
 * "refining" and held off the homepage until a background tribunal lifts them. */
export const PUBLISH_BAR = 8;

/** A post is "evaluated" once it carries a numeric vibe composite. */
export function hasTribunalScore(scores?: PostScores): boolean {
  return typeof scores?.vibe?.score === 'number';
}

/** Composite `.score` of every judge that is present (vibe + any of the others). */
function presentJudgeScores(scores?: PostScores): number[] {
  if (!scores) return [];
  const out: number[] = [];
  for (const judge of JUDGES) {
    const score = scores[judge]?.score;
    if (typeof score === 'number') out.push(score);
  }
  return out;
}

function hasAllJudgeScores(scores?: PostScores): boolean {
  return !!scores && JUDGES.every((judge) => typeof scores[judge]?.score === 'number');
}

function getTribunalVersion(scores?: PostScores): number {
  return typeof scores?.tribunalVersion === 'number' ? scores.tribunalVersion : 8;
}

function compositeJudgePasses(scores: PostScores | undefined, judge: JudgeName): boolean {
  const score = scores?.[judge]?.score;
  return typeof score === 'number' && score >= PUBLISH_BAR;
}

function hasNumericDimensions(
  scores: Record<string, unknown> | undefined,
  dims: readonly string[]
): scores is Record<string, number> {
  return !!scores && dims.every((dim) => typeof scores[dim] === 'number');
}

function factCheckPasses(scores: PostScores | undefined): boolean {
  const factCheck = scores?.factCheck;
  if (!factCheck || !compositeJudgePasses(scores, 'factCheck')) return false;

  const core = [factCheck.accuracy, factCheck.fidelity, factCheck.consistency];
  if (!core.every((score): score is number => typeof score === 'number')) return false;

  const coreComposite = Math.floor(core.reduce((sum, score) => sum + score, 0) / core.length);
  return (
    coreComposite >= PUBLISH_BAR &&
    (factCheck.sourceBoundary ?? 0) >= PUBLISH_BAR &&
    (factCheck.commentarySeparation ?? 0) >= PUBLISH_BAR
  );
}

function vibePasses(scores: PostScores | undefined): boolean {
  const vibe = scores?.vibe;
  if (!vibe || !compositeJudgePasses(scores, 'vibe')) return false;

  try {
    const version = getTribunalVersion(scores);
    if (!hasNumericDimensions(vibe, vibeDims(version))) return false;
    return checkVibePassBar(vibe as Parameters<typeof checkVibePassBar>[0], version).pass;
  } catch {
    return false;
  }
}

function freshEyesPasses(scores: PostScores | undefined): boolean {
  const freshEyes = scores?.freshEyes;
  if (!freshEyes || !compositeJudgePasses(scores, 'freshEyes')) return false;

  try {
    const version = getTribunalVersion(scores);
    if (!hasNumericDimensions(freshEyes, freshEyesDims(version))) return false;
    return checkFreshEyesPassBar(
      freshEyes as Parameters<typeof checkFreshEyesPassBar>[0],
      version
    ).pass;
  } catch {
    return false;
  }
}

/** Overall tribunal composite = floor(avg of present judge composites), or
 * null when the post has not been scored. */
export function computeOverallComposite(scores?: PostScores): number | null {
  const vals = presentJudgeScores(scores);
  if (vals.length === 0) return null;
  return Math.floor(vals.reduce((sum, n) => sum + n, 0) / vals.length);
}

/**
 * Meets the featured bar: scored AND the full tribunal PASS bar succeeds.
 * This intentionally matches the rubric hard gates, not just judge composites.
 */
export function meetsPublishBar(scores?: PostScores): boolean {
  if (!hasTribunalScore(scores)) return false;
  if (!hasAllJudgeScores(scores)) return false;
  return (
    compositeJudgePasses(scores, 'librarian') &&
    factCheckPasses(scores) &&
    vibePasses(scores) &&
    freshEyesPasses(scores)
  );
}

/**
 * Below the featured bar: the post HAS a real tribunal score but does not
 * meet it. Score-less grandfathered posts are NOT below bar — they are
 * "unevaluated", so they stay on the homepage untouched.
 */
export function isBelowPublishBar(scores?: PostScores): boolean {
  return hasTribunalScore(scores) && !meetsPublishBar(scores);
}
