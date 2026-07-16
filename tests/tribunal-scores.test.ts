import { describe, expect, it } from 'vitest';
import { isBelowPublishBar, meetsPublishBar } from '../src/utils/tribunal-scores';

type Scores = Parameters<typeof meetsPublishBar>[0];

function passScores(overrides: Partial<NonNullable<Scores>> = {}): Scores {
  return {
    tribunalVersion: 9,
    vibe: {
      persona: 9,
      moguNote: 8,
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
        moguNote: 8,
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
        moguNote: 8,
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

  it('treats un-scored posts as unevaluated, not below bar (grandfather)', () => {
    // spec: publish-bar-visibility — Un-scored posts SHALL be grandfathered
    expect(isBelowPublishBar(undefined)).toBe(false);
    expect(isBelowPublishBar({} as NonNullable<Scores>)).toBe(false);
    // 沒分數也不算 meets bar——它是 unevaluated，兩邊都不成立
    expect(meetsPublishBar(undefined)).toBe(false);
  });

  it('fails partial tribunal scores instead of publishing from Vibe alone', () => {
    const scores = {
      tribunalVersion: 9,
      vibe: {
        persona: 9,
        moguNote: 8,
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

describe('tribunal version defaults (legacy read)', () => {
  it('treats a missing tribunalVersion as v8 — Vibe still owns clarity', () => {
    // Same numbers as a passing v9 post, but WITHOUT the version stamp:
    // legacy ownership applies, vibe.clarity is required, so this must NOT
    // meet the publish bar (clarity is absent).
    const scores = passScores({ tribunalVersion: undefined });
    delete (scores as Record<string, unknown>).tribunalVersion;
    expect(meetsPublishBar(scores)).toBe(false);
    expect(isBelowPublishBar(scores)).toBe(true);
  });

  it('meets the bar for an unstamped legacy post with the full v8 vibe set', () => {
    const scores = passScores();
    delete (scores as Record<string, unknown>).tribunalVersion;
    const vibe = { ...(scores as NonNullable<Scores>).vibe!, clarity: 8 };
    const legacy = { ...(scores as NonNullable<Scores>), vibe };
    // v8 fresh eyes does not require clarity — strip it to prove the legacy
    // 4-dim fresh-eyes set still passes.
    const freshEyes = { ...legacy.freshEyes! };
    delete (freshEyes as Record<string, unknown>).clarity;
    legacy.freshEyes = freshEyes;
    expect(meetsPublishBar(legacy)).toBe(true);
  });
});
