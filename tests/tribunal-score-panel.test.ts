import { describe, expect, it } from 'vitest';
import {
  clarityLivesInFreshEyes,
  resolveFreshEyesClarity,
  resolveVibeClarity,
} from '../src/utils/tribunal-score-panel';

describe('tribunal score panel clarity placement', () => {
  it('keeps clarity under Vibe for tribunal v5', () => {
    const scores = {
      tribunalVersion: 5,
      vibe: { clarity: 9 },
      freshEyes: { clarity: 7 },
    };

    expect(clarityLivesInFreshEyes(scores.tribunalVersion)).toBe(false);
    expect(resolveVibeClarity(scores)).toBe(9);
    expect(resolveFreshEyesClarity(scores)).toBeUndefined();
  });

  it('moves clarity to Fresh Eyes for tribunal v6', () => {
    const scores = {
      tribunalVersion: 6,
      vibe: { clarity: 8 },
      freshEyes: { clarity: 9 },
    };

    expect(clarityLivesInFreshEyes(scores.tribunalVersion)).toBe(true);
    expect(resolveFreshEyesClarity(scores)).toBe(9);
    expect(resolveVibeClarity(scores)).toBeUndefined();
  });

  it('uses legacy vibe clarity as a fallback when a v6 post has not been backfilled yet', () => {
    const scores = {
      tribunalVersion: 6,
      vibe: { clarity: 8 },
      freshEyes: {},
    };

    expect(resolveFreshEyesClarity(scores)).toBe(8);
    expect(resolveVibeClarity(scores)).toBeUndefined();
  });
});
