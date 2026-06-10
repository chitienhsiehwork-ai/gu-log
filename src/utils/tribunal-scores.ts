import type { CollectionEntry } from 'astro:content';

type PostScores = NonNullable<CollectionEntry<'posts'>['data']['scores']>;

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

/** Overall tribunal composite = floor(avg of present judge composites), or
 * null when the post has not been scored. */
export function computeOverallComposite(scores?: PostScores): number | null {
  const vals = presentJudgeScores(scores);
  if (vals.length === 0) return null;
  return Math.floor(vals.reduce((sum, n) => sum + n, 0) / vals.length);
}

/** Meets the featured bar: scored AND every present judge composite >= 8. */
export function meetsPublishBar(scores?: PostScores): boolean {
  if (!hasTribunalScore(scores)) return false;
  const vals = presentJudgeScores(scores);
  return vals.length > 0 && vals.every((score) => score >= PUBLISH_BAR);
}

/**
 * Below the featured bar: the post HAS a real tribunal score but does not
 * meet it. Score-less grandfathered posts are NOT below bar — they are
 * "unevaluated", so they stay on the homepage untouched.
 */
export function isBelowPublishBar(scores?: PostScores): boolean {
  return hasTribunalScore(scores) && !meetsPublishBar(scores);
}
