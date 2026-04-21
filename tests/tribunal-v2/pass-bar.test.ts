import { describe, it, expect } from 'vitest';
import {
  checkVibePassBar,
  checkFinalVibePassBar,
  checkFreshEyesPassBar,
  checkFactLibPassBar,
} from '../../src/lib/tribunal-v2/pass-bar';

// ============================================================================
// Stage 1: Absolute pass bar (5-dim integer scoring)
// ============================================================================

describe('checkVibePassBar (Stage 1)', () => {
  it('passes when composite >=8 AND one dim >=9 AND all dims >=8', () => {
    const result = checkVibePassBar({
      persona: 9, clawdNote: 8, vibe: 8, clarity: 8, narrative: 8,
    });
    // composite: floor((9+8+8+8+8)/5) = floor(8.2) = 8
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(8);
    expect(result.hasHighlight).toBe(true);
    expect(result.failedDimensions).toEqual([]);
  });

  it('fails when no dim reaches 9 (no highlight)', () => {
    const result = checkVibePassBar({
      persona: 8, clawdNote: 8, vibe: 8, clarity: 8, narrative: 8,
    });
    // composite=8, max=8 → no highlight → fail
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(8);
    expect(result.hasHighlight).toBe(false);
    expect(result.failedDimensions).toEqual([]);
  });

  it('fails when one dim is 7 even if others are 10', () => {
    const result = checkVibePassBar({
      persona: 10, clawdNote: 10, vibe: 10, clarity: 10, narrative: 7,
    });
    // composite: floor(47/5) = 9, highlight=true, but 7<8 → fail
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(9);
    expect(result.hasHighlight).toBe(true);
    expect(result.failedDimensions).toEqual(['narrative']);
  });

  it('fails when composite <8', () => {
    const result = checkVibePassBar({
      persona: 9, clawdNote: 8, vibe: 8, clarity: 7, narrative: 7,
    });
    // composite: floor(39/5) = 7
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(7);
  });

  it('uses floor for composite (not round)', () => {
    // sum=42, avg=8.4 → floor=8
    const r1 = checkVibePassBar({
      persona: 9, clawdNote: 9, vibe: 8, clarity: 8, narrative: 8,
    });
    expect(r1.composite).toBe(8);
    expect(r1.pass).toBe(true);

    // sum=43, avg=8.6 → floor=8 (not 9)
    const r2 = checkVibePassBar({
      persona: 9, clawdNote: 9, vibe: 9, clarity: 8, narrative: 8,
    });
    expect(r2.composite).toBe(8);
    expect(r2.pass).toBe(true);
  });

  it('throws if any of the 5 dims is missing', () => {
    expect(() =>
      checkVibePassBar({
        persona: 9, clawdNote: 8, vibe: 8, clarity: 8,
      } as any),
    ).toThrow('Missing required dimension: narrative');
  });

  it('passes with all 10s (perfect score)', () => {
    const result = checkVibePassBar({
      persona: 10, clawdNote: 10, vibe: 10, clarity: 10, narrative: 10,
    });
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(10);
  });

  it('reports multiple failed dimensions', () => {
    const result = checkVibePassBar({
      persona: 9, clawdNote: 7, vibe: 6, clarity: 8, narrative: 8,
    });
    expect(result.failedDimensions).toEqual(['clawdNote', 'vibe']);
  });
});

// ============================================================================
// Stage 4: Relative pass bar (degradation check)
// ============================================================================

describe('checkFinalVibePassBar (Stage 4)', () => {
  const stage1 = { persona: 9, clawdNote: 8, vibe: 8, clarity: 8, narrative: 8 };

  it('passes when all dims equal Stage 1 scores', () => {
    const result = checkFinalVibePassBar(
      { persona: 9, clawdNote: 8, vibe: 8, clarity: 8, narrative: 8 },
      stage1,
    );
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('passes when dims improved', () => {
    const result = checkFinalVibePassBar(
      { persona: 10, clawdNote: 9, vibe: 8, clarity: 8, narrative: 8 },
      stage1,
    );
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('passes when dims dropped by exactly 1 (boundary)', () => {
    const s1 = { persona: 9, clawdNote: 9, vibe: 9, clarity: 9, narrative: 9 };
    const result = checkFinalVibePassBar(
      { persona: 8, clawdNote: 8, vibe: 8, clarity: 8, narrative: 8 },
      s1,
    );
    // -1 each, but > 1 is the threshold, so exactly 1 = pass
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('fails when any dim dropped by 2', () => {
    const result = checkFinalVibePassBar(
      { persona: 7, clawdNote: 8, vibe: 8, clarity: 8, narrative: 8 },
      stage1,
    );
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toEqual([
      { dim: 'persona', stage1: 9, current: 7, drop: 2 },
    ]);
  });

  it('reports all degraded dims, not just the first', () => {
    const s1 = { persona: 9, clawdNote: 9, vibe: 9, clarity: 8, narrative: 8 };
    const result = checkFinalVibePassBar(
      { persona: 7, clawdNote: 7, vibe: 9, clarity: 8, narrative: 8 },
      s1,
    );
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toHaveLength(2);
    expect(result.degradedDimensions[0].dim).toBe('persona');
    expect(result.degradedDimensions[1].dim).toBe('clawdNote');
  });

  it('handles asymmetric: some improved, some degraded', () => {
    const result = checkFinalVibePassBar(
      { persona: 10, clawdNote: 8, vibe: 6, clarity: 8, narrative: 8 },
      stage1,
    );
    // persona improved +1, vibe degraded -2 → still fail
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toEqual([
      { dim: 'vibe', stage1: 8, current: 6, drop: 2 },
    ]);
  });
});

// ============================================================================
// Stage 2: FreshEyes pass bar
// ============================================================================

describe('checkFreshEyesPassBar (Stage 2)', () => {
  it('passes when composite >= 8', () => {
    const result = checkFreshEyesPassBar({ readability: 9, firstImpression: 8 });
    // floor((9+8)/2) = floor(8.5) = 8
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(8);
  });

  it('fails when composite < 8', () => {
    const result = checkFreshEyesPassBar({ readability: 7, firstImpression: 8 });
    // floor((7+8)/2) = floor(7.5) = 7
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(7);
  });

  it('uses floor not round', () => {
    const result = checkFreshEyesPassBar({ readability: 9, firstImpression: 7 });
    // floor((9+7)/2) = floor(8) = 8
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(8);
  });

  it('passes with perfect scores', () => {
    const result = checkFreshEyesPassBar({ readability: 10, firstImpression: 10 });
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(10);
  });

  it('fails with all 7s', () => {
    const result = checkFreshEyesPassBar({ readability: 7, firstImpression: 7 });
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(7);
  });
});

// ============================================================================
// Stage 3: FactLib independent pass bars
// ============================================================================

describe('checkFactLibPassBar (Stage 3)', () => {
  it('passes when fact, library, and dupCheck all pass', () => {
    const result = checkFactLibPassBar({
      factAccuracy: 9, sourceFidelity: 8,
      linkCoverage: 8, linkRelevance: 9,
      dupCheck: 10,
    });
    expect(result.pass).toBe(true);
    expect(result.fact_pass).toBe(true);
    expect(result.library_pass).toBe(true);
    expect(result.dupCheck_pass).toBe(true);
  });

  it('fails when fact fails even if library+dupCheck pass (no compensation)', () => {
    const result = checkFactLibPassBar({
      factAccuracy: 7, sourceFidelity: 7,
      linkCoverage: 10, linkRelevance: 10,
      dupCheck: 10,
    });
    // fact: floor((7+7)/2) = 7 < 8 → fail
    // library: floor((10+10)/2) = 10 → pass
    // dupCheck: 10 → pass
    expect(result.pass).toBe(false);
    expect(result.fact_pass).toBe(false);
    expect(result.library_pass).toBe(true);
    expect(result.dupCheck_pass).toBe(true);
  });

  it('fails when library fails even if fact+dupCheck pass', () => {
    const result = checkFactLibPassBar({
      factAccuracy: 10, sourceFidelity: 10,
      linkCoverage: 6, linkRelevance: 7,
      dupCheck: 10,
    });
    // fact: 10, library: floor((6+7)/2) = 6 → fail, dupCheck: pass
    expect(result.pass).toBe(false);
    expect(result.fact_pass).toBe(true);
    expect(result.library_pass).toBe(false);
    expect(result.dupCheck_pass).toBe(true);
  });

  it('fails when dupCheck fails even if fact+library pass (Level E)', () => {
    const result = checkFactLibPassBar({
      factAccuracy: 10, sourceFidelity: 10,
      linkCoverage: 10, linkRelevance: 10,
      dupCheck: 5,
    });
    // fact: pass, library: pass, dupCheck: 5 < 8 → fail
    expect(result.pass).toBe(false);
    expect(result.fact_pass).toBe(true);
    expect(result.library_pass).toBe(true);
    expect(result.dupCheck_pass).toBe(false);
  });

  it('fails when all three fail', () => {
    const result = checkFactLibPassBar({
      factAccuracy: 5, sourceFidelity: 6,
      linkCoverage: 4, linkRelevance: 3,
      dupCheck: 2,
    });
    expect(result.pass).toBe(false);
    expect(result.fact_pass).toBe(false);
    expect(result.library_pass).toBe(false);
    expect(result.dupCheck_pass).toBe(false);
  });

  it('uses floor for fact+library sub-composites, strict >=8 for dupCheck', () => {
    // fact: floor((9+8)/2) = floor(8.5) = 8 → pass
    // library: floor((9+8)/2) = floor(8.5) = 8 → pass
    // dupCheck: 8 → pass (boundary)
    const result = checkFactLibPassBar({
      factAccuracy: 9, sourceFidelity: 8,
      linkCoverage: 9, linkRelevance: 8,
      dupCheck: 8,
    });
    expect(result.pass).toBe(true);

    // fact: floor((8+7)/2) = floor(7.5) = 7 → fail
    const result2 = checkFactLibPassBar({
      factAccuracy: 8, sourceFidelity: 7,
      linkCoverage: 9, linkRelevance: 8,
      dupCheck: 10,
    });
    expect(result2.fact_pass).toBe(false);

    // dupCheck boundary: 7 is below threshold
    const result3 = checkFactLibPassBar({
      factAccuracy: 10, sourceFidelity: 10,
      linkCoverage: 10, linkRelevance: 10,
      dupCheck: 7,
    });
    expect(result3.dupCheck_pass).toBe(false);
  });

  // SHOULD 6: runtime type guard — undefined / non-number / out-of-range must throw
  it('throws when dupCheck is undefined (old judge version without Level E)', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9, sourceFidelity: 9,
        linkCoverage: 9, linkRelevance: 9,
        dupCheck: undefined as unknown as number,
      })
    ).toThrow(/dupCheck is undefined/i);
  });

  it('throws when dupCheck is not a finite number', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9, sourceFidelity: 9,
        linkCoverage: 9, linkRelevance: 9,
        dupCheck: NaN as number,
      })
    ).toThrow(/not a finite number/i);
  });

  it('throws when dupCheck is out of range [0, 10]', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9, sourceFidelity: 9,
        linkCoverage: 9, linkRelevance: 9,
        dupCheck: 11,
      })
    ).toThrow(/outside the valid range/i);

    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9, sourceFidelity: 9,
        linkCoverage: 9, linkRelevance: 9,
        dupCheck: -1,
      })
    ).toThrow(/outside the valid range/i);
  });
});
