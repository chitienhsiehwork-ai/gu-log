import { describe, expect, it } from 'vitest';
import { isBelowPublishBar, meetsPublishBar } from '../src/utils/tribunal-scores';

type Scores = Parameters<typeof meetsPublishBar>[0];

function passScores(overrides: Partial<NonNullable<Scores>> = {}): Scores {
  return {
    tribunalVersion: 9,
    vibe: {
      persona: 9,
      clawdNote: 8,
      vibe: 8,
      narrative: 8,
      score: 8,
      date: '2026-06-21',
    },
    factCheck: {
      accuracy: 8,
      fidelity: 8,
      consistency: 8,
      sourceBoundary: 8,
      commentarySeparation: 8,
      score: 8,
      date: '2026-06-21',
    },
    librarian: {
      glossary: 8,
      crossRef: 8,
      sourceAlign: 8,
      attribution: 8,
      score: 8,
      date: '2026-06-21',
    },
    freshEyes: {
      readability: 8,
      firstImpression: 8,
      payoffDensity: 8,
      lengthFit: 8,
      clarity: 8,
      score: 8,
      date: '2026-06-21',
    },
    ...overrides,
  };
}

describe('tribunal publish bar', () => {
  it('passes only when the full tribunal pass bar passes', () => {
    expect(meetsPublishBar(passScores())).toBe(true);
    expect(isBelowPublishBar(passScores())).toBe(false);
  });

  it('fails when Vibe composite is 8 but no dimension reaches 9', () => {
    const scores = passScores({
      vibe: {
        persona: 8,
        clawdNote: 8,
        vibe: 8,
        narrative: 8,
        score: 8,
        date: '2026-06-21',
      },
    });

    expect(meetsPublishBar(scores)).toBe(false);
    expect(isBelowPublishBar(scores)).toBe(true);
  });

  it('fails when v9 Fresh Eyes clarity misses its non-compensating gate', () => {
    const scores = passScores({
      freshEyes: {
        readability: 10,
        firstImpression: 10,
        payoffDensity: 10,
        lengthFit: 10,
        clarity: 7,
        score: 9,
        date: '2026-06-21',
      },
    });

    expect(meetsPublishBar(scores)).toBe(false);
    expect(isBelowPublishBar(scores)).toBe(true);
  });

  it('keeps legacy v8 clarity under Vibe and not Fresh Eyes', () => {
    const scores = passScores({
      tribunalVersion: 8,
      vibe: {
        persona: 9,
        clawdNote: 8,
        vibe: 8,
        clarity: 8,
        narrative: 8,
        score: 8,
        date: '2026-06-21',
      },
      freshEyes: {
        readability: 9,
        firstImpression: 8,
        payoffDensity: 8,
        lengthFit: 8,
        score: 8,
        date: '2026-06-21',
      },
    });

    expect(meetsPublishBar(scores)).toBe(true);
  });

  it('fails partial tribunal scores instead of publishing from Vibe alone', () => {
    const scores = {
      tribunalVersion: 9,
      vibe: {
        persona: 9,
        clawdNote: 8,
        vibe: 8,
        narrative: 8,
        score: 8,
        date: '2026-06-21',
      },
    } satisfies Scores;

    expect(meetsPublishBar(scores)).toBe(false);
    expect(isBelowPublishBar(scores)).toBe(true);
  });
});
