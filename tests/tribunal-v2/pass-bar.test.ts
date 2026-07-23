import { describe, it, expect } from 'vitest';
import {
  checkVibePassBar,
  checkFinalVibePassBar,
  checkFreshEyesPassBar,
  checkFactLibPassBar,
  vibeDims,
  freshEyesDims,
} from '../../src/lib/tribunal-v2/pass-bar';

// ============================================================================
// Stage 1: Absolute pass bar (5-dim integer scoring)
// ============================================================================

describe('checkVibePassBar (Stage 1)', () => {
  it('passes when composite >=8 AND one dim >=9 AND all dims >=8', () => {
    const result = checkVibePassBar({
      persona: 9,
      moguNote: 8,
      vibe: 8,
      clarity: 8,
      narrative: 8,
    });
    // composite: floor((9+8+8+8+8)/5) = floor(8.2) = 8
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(8);
    expect(result.hasHighlight).toBe(true);
    expect(result.failedDimensions).toEqual([]);
  });

  it('fails when no dim reaches 9 (no highlight)', () => {
    const result = checkVibePassBar({
      persona: 8,
      moguNote: 8,
      vibe: 8,
      clarity: 8,
      narrative: 8,
    });
    // composite=8, max=8 → no highlight → fail
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(8);
    expect(result.hasHighlight).toBe(false);
    expect(result.failedDimensions).toEqual([]);
  });

  it('fails when one dim is 7 even if others are 10', () => {
    const result = checkVibePassBar({
      persona: 10,
      moguNote: 10,
      vibe: 10,
      clarity: 10,
      narrative: 7,
    });
    // composite: floor(47/5) = 9, highlight=true, but 7<8 → fail
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(9);
    expect(result.hasHighlight).toBe(true);
    expect(result.failedDimensions).toEqual(['narrative']);
  });

  it('fails when composite <8', () => {
    const result = checkVibePassBar({
      persona: 9,
      moguNote: 8,
      vibe: 8,
      clarity: 7,
      narrative: 7,
    });
    // composite: floor(39/5) = 7
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(7);
  });

  it('uses floor for composite (not round)', () => {
    // sum=42, avg=8.4 → floor=8
    const r1 = checkVibePassBar({
      persona: 9,
      moguNote: 9,
      vibe: 8,
      clarity: 8,
      narrative: 8,
    });
    expect(r1.composite).toBe(8);
    expect(r1.pass).toBe(true);

    // sum=43, avg=8.6 → floor=8 (not 9)
    const r2 = checkVibePassBar({
      persona: 9,
      moguNote: 9,
      vibe: 9,
      clarity: 8,
      narrative: 8,
    });
    expect(r2.composite).toBe(8);
    expect(r2.pass).toBe(true);
  });

  it('throws if any of the 5 dims is missing', () => {
    expect(() =>
      checkVibePassBar({
        persona: 9,
        moguNote: 8,
        vibe: 8,
        clarity: 8,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    ).toThrow('Missing required dimension: narrative');
  });

  it('passes with all 10s (perfect score)', () => {
    const result = checkVibePassBar({
      persona: 10,
      moguNote: 10,
      vibe: 10,
      clarity: 10,
      narrative: 10,
    });
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(10);
  });

  it('reports multiple failed dimensions', () => {
    const result = checkVibePassBar({
      persona: 9,
      moguNote: 7,
      vibe: 6,
      clarity: 8,
      narrative: 8,
    });
    expect(result.failedDimensions).toEqual(['moguNote', 'vibe']);
  });
});

// ============================================================================
// Stage 4: Relative pass bar (degradation check)
// ============================================================================

describe('checkFinalVibePassBar (Stage 4)', () => {
  const stage1 = { persona: 9, moguNote: 8, vibe: 8, clarity: 8, narrative: 8 };

  it('passes when all dims equal Stage 1 scores', () => {
    const result = checkFinalVibePassBar(
      { persona: 9, moguNote: 8, vibe: 8, clarity: 8, narrative: 8 },
      stage1
    );
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('passes when dims improved', () => {
    const result = checkFinalVibePassBar(
      { persona: 10, moguNote: 9, vibe: 8, clarity: 8, narrative: 8 },
      stage1
    );
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('passes when dims dropped by exactly 1 (boundary)', () => {
    const s1 = { persona: 9, moguNote: 9, vibe: 9, clarity: 9, narrative: 9 };
    const result = checkFinalVibePassBar(
      { persona: 8, moguNote: 8, vibe: 8, clarity: 8, narrative: 8 },
      s1
    );
    // -1 each, but > 1 is the threshold, so exactly 1 = pass
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('fails when any dim dropped by 2', () => {
    const result = checkFinalVibePassBar(
      { persona: 7, moguNote: 8, vibe: 8, clarity: 8, narrative: 8 },
      stage1
    );
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toEqual([{ dim: 'persona', stage1: 9, current: 7, drop: 2 }]);
  });

  it('reports all degraded dims, not just the first', () => {
    const s1 = { persona: 9, moguNote: 9, vibe: 9, clarity: 8, narrative: 8 };
    const result = checkFinalVibePassBar(
      { persona: 7, moguNote: 7, vibe: 9, clarity: 8, narrative: 8 },
      s1
    );
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toHaveLength(2);
    expect(result.degradedDimensions[0].dim).toBe('persona');
    expect(result.degradedDimensions[1].dim).toBe('moguNote');
  });

  it('handles asymmetric: some improved, some degraded', () => {
    const result = checkFinalVibePassBar(
      { persona: 10, moguNote: 8, vibe: 6, clarity: 8, narrative: 8 },
      stage1
    );
    // persona improved +1, vibe degraded -2 → still fail
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toEqual([{ dim: 'vibe', stage1: 8, current: 6, drop: 2 }]);
  });
});

// ============================================================================
// Stage 2: FreshEyes pass bar
// ============================================================================

describe('checkFreshEyesPassBar (Stage 2)', () => {
  const fresh = (overrides: Partial<Parameters<typeof checkFreshEyesPassBar>[0]> = {}) =>
    checkFreshEyesPassBar({
      readability: 8,
      firstImpression: 8,
      payoffDensity: 8,
      lengthFit: 8,
      ...overrides,
    });

  it('passes when composite >= 8 and payoff/length dimensions pass', () => {
    const result = fresh({ readability: 9, firstImpression: 8, payoffDensity: 8, lengthFit: 8 });
    // floor((9+8+8+8)/4) = floor(8.25) = 8
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(8);
  });

  it('fails when composite < 8', () => {
    const result = fresh({ readability: 7, firstImpression: 8, payoffDensity: 8, lengthFit: 7 });
    // floor((7+8+8+7)/4) = floor(7.5) = 7
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(7);
  });

  it('uses floor not round', () => {
    const result = fresh({ readability: 9, firstImpression: 8, payoffDensity: 8, lengthFit: 7 });
    // floor((9+8+8+7)/4) = floor(8) = 8, but lengthFit is non-compensating.
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(8);
  });

  it('fails when payoffDensity is below 8 even if composite passes', () => {
    const result = fresh({ readability: 10, firstImpression: 10, payoffDensity: 7, lengthFit: 8 });
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(8);
  });

  it('fails when lengthFit is below 8 even if composite passes', () => {
    const result = fresh({ readability: 10, firstImpression: 10, payoffDensity: 8, lengthFit: 7 });
    expect(result.pass).toBe(false);
    expect(result.composite).toBe(8);
  });

  it('passes with perfect scores', () => {
    const result = fresh({
      readability: 10,
      firstImpression: 10,
      payoffDensity: 10,
      lengthFit: 10,
    });
    expect(result.pass).toBe(true);
    expect(result.composite).toBe(10);
  });

  it('fails with all 7s', () => {
    const result = fresh({ readability: 7, firstImpression: 7, payoffDensity: 7, lengthFit: 7 });
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
      factAccuracy: 9,
      sourceFidelity: 8,
      linkCoverage: 8,
      linkRelevance: 9,
      dupCheck: 10,
    });
    expect(result.pass).toBe(true);
    expect(result.fact_pass).toBe(true);
    expect(result.library_pass).toBe(true);
    expect(result.dupCheck_pass).toBe(true);
  });

  it('fails when fact fails even if library+dupCheck pass (no compensation)', () => {
    const result = checkFactLibPassBar({
      factAccuracy: 7,
      sourceFidelity: 7,
      linkCoverage: 10,
      linkRelevance: 10,
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
      factAccuracy: 10,
      sourceFidelity: 10,
      linkCoverage: 6,
      linkRelevance: 7,
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
      factAccuracy: 10,
      sourceFidelity: 10,
      linkCoverage: 10,
      linkRelevance: 10,
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
      factAccuracy: 5,
      sourceFidelity: 6,
      linkCoverage: 4,
      linkRelevance: 3,
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
      factAccuracy: 9,
      sourceFidelity: 8,
      linkCoverage: 9,
      linkRelevance: 8,
      dupCheck: 8,
    });
    expect(result.pass).toBe(true);

    // fact: floor((8+7)/2) = floor(7.5) = 7 → fail
    const result2 = checkFactLibPassBar({
      factAccuracy: 8,
      sourceFidelity: 7,
      linkCoverage: 9,
      linkRelevance: 8,
      dupCheck: 10,
    });
    expect(result2.fact_pass).toBe(false);

    // dupCheck boundary: 7 is below threshold
    const result3 = checkFactLibPassBar({
      factAccuracy: 10,
      sourceFidelity: 10,
      linkCoverage: 10,
      linkRelevance: 10,
      dupCheck: 7,
    });
    expect(result3.dupCheck_pass).toBe(false);
  });

  // SHOULD 6: runtime type guard — undefined / non-number / out-of-range must throw
  it('throws when dupCheck is undefined (old judge version without Level E)', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9,
        sourceFidelity: 9,
        linkCoverage: 9,
        linkRelevance: 9,
        dupCheck: undefined as unknown as number,
      })
    ).toThrow(/dupCheck is undefined/i);
  });

  it('throws when dupCheck is not a finite number', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9,
        sourceFidelity: 9,
        linkCoverage: 9,
        linkRelevance: 9,
        dupCheck: NaN as number,
      })
    ).toThrow(/not a finite number/i);
  });

  it('throws when dupCheck is a non-integer (spec R1 requires integer 0..10)', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9,
        sourceFidelity: 9,
        linkCoverage: 9,
        linkRelevance: 9,
        dupCheck: 8.5,
      })
    ).toThrow(/not an integer/i);
  });

  it('throws when dupCheck is out of range [0, 10]', () => {
    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9,
        sourceFidelity: 9,
        linkCoverage: 9,
        linkRelevance: 9,
        dupCheck: 11,
      })
    ).toThrow(/outside the valid range/i);

    expect(() =>
      checkFactLibPassBar({
        factAccuracy: 9,
        sourceFidelity: 9,
        linkCoverage: 9,
        linkRelevance: 9,
        dupCheck: -1,
      })
    ).toThrow(/outside the valid range/i);
  });
});

// ============================================================================
// move-clarity-vibe-to-fresheyes — version-aware dimension ownership
// ============================================================================

describe('vibeDims / freshEyesDims resolvers', () => {
  it('v9+ Vibe owns 4 dims (no clarity)', () => {
    expect(vibeDims(9)).toEqual(['persona', 'moguNote', 'vibe', 'narrative']);
    expect(vibeDims(10)).toEqual(['persona', 'moguNote', 'vibe', 'narrative']);
  });

  it('v8 and below Vibe owns 5 dims (legacy, with clarity)', () => {
    expect(vibeDims(8)).toEqual(['persona', 'moguNote', 'vibe', 'clarity', 'narrative']);
    expect(vibeDims(3)).toEqual(['persona', 'moguNote', 'vibe', 'clarity', 'narrative']);
  });

  it('v9+ Fresh Eyes owns 5 dims (clarity added)', () => {
    expect(freshEyesDims(9)).toEqual([
      'readability',
      'firstImpression',
      'payoffDensity',
      'lengthFit',
      'clarity',
    ]);
  });

  it('v8 and below Fresh Eyes owns 4 dims (legacy, no clarity)', () => {
    expect(freshEyesDims(8)).toEqual([
      'readability',
      'firstImpression',
      'payoffDensity',
      'lengthFit',
    ]);
  });
});

describe('checkVibePassBar — v9 (4-dim, no clarity)', () => {
  it('composite = floor(sum of 4 dims / 4)', () => {
    const result = checkVibePassBar({ persona: 9, moguNote: 8, vibe: 8, narrative: 8 }, 9);
    // floor((9+8+8+8)/4) = floor(8.25) = 8
    expect(result.composite).toBe(8);
    expect(result.pass).toBe(true);
    expect(result.hasHighlight).toBe(true);
    expect(result.failedDimensions).toEqual([]);
  });

  it('does NOT require clarity at v9', () => {
    // No clarity key present — must not throw.
    expect(() =>
      checkVibePassBar({ persona: 9, moguNote: 8, vibe: 8, narrative: 8 }, 9)
    ).not.toThrow();
  });

  it('fails when any of the 4 dims < 8', () => {
    const result = checkVibePassBar({ persona: 10, moguNote: 10, vibe: 10, narrative: 7 }, 9);
    expect(result.pass).toBe(false);
    expect(result.failedDimensions).toEqual(['narrative']);
  });

  it('throws when a required v9 dim is missing', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      checkVibePassBar({ persona: 9, moguNote: 8, vibe: 8 } as any, 9)
    ).toThrow('Missing required dimension: narrative');
  });

  it('ignores clarity even if present in scores at v9', () => {
    const result = checkVibePassBar(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { persona: 9, moguNote: 8, vibe: 8, narrative: 8, clarity: 2 } as any,
      9
    );
    // clarity=2 would drop composite/fail under legacy, but v9 ignores it.
    expect(result.composite).toBe(8);
    expect(result.pass).toBe(true);
    expect(result.failedDimensions).toEqual([]);
  });
});

describe('checkVibePassBar — v8 regression (5-dim, with clarity)', () => {
  it('defaults to legacy 5-dim math when no version passed', () => {
    const result = checkVibePassBar({
      persona: 9,
      moguNote: 8,
      vibe: 8,
      clarity: 8,
      narrative: 8,
    });
    // floor((9+8+8+8+8)/5) = 8
    expect(result.composite).toBe(8);
    expect(result.pass).toBe(true);
  });

  it('still requires clarity at v8', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      checkVibePassBar({ persona: 9, moguNote: 8, vibe: 8, narrative: 8 } as any, 8)
    ).toThrow('Missing required dimension: clarity');
  });
});

describe('checkFinalVibePassBar — v9 (4-dim, no clarity)', () => {
  it('does not consider clarity for regression at v9', () => {
    const stage1 = { persona: 9, moguNote: 9, vibe: 9, narrative: 9, clarity: 9 };
    const current = { persona: 9, moguNote: 9, vibe: 9, narrative: 9, clarity: 2 };
    // clarity dropped 7 points but is no longer a Vibe dim at v9 → no degradation
    const result = checkFinalVibePassBar(current, stage1, 9);
    expect(result.pass).toBe(true);
    expect(result.degradedDimensions).toEqual([]);
  });

  it('still flags a > 1 drop on an owned v9 dim', () => {
    const stage1 = { persona: 9, moguNote: 9, vibe: 9, narrative: 9 };
    const current = { persona: 7, moguNote: 9, vibe: 9, narrative: 9 };
    const result = checkFinalVibePassBar(current, stage1, 9);
    expect(result.pass).toBe(false);
    expect(result.degradedDimensions).toEqual([{ dim: 'persona', stage1: 9, current: 7, drop: 2 }]);
  });
});

describe('checkFreshEyesPassBar — v9 (5-dim, clarity hard gate)', () => {
  const fresh9 = (
    overrides: Partial<{
      readability: number;
      firstImpression: number;
      payoffDensity: number;
      lengthFit: number;
      clarity: number;
    }> = {}
  ) =>
    checkFreshEyesPassBar(
      {
        readability: 8,
        firstImpression: 8,
        payoffDensity: 8,
        lengthFit: 8,
        clarity: 8,
        ...overrides,
      },
      9
    );

  it('composite = floor(sum of 5 dims / 5)', () => {
    const result = fresh9({ readability: 10, clarity: 10 });
    // floor((10+8+8+8+10)/5) = floor(8.8) = 8
    expect(result.composite).toBe(8);
    expect(result.pass).toBe(true);
  });

  it('passes when composite≥8 AND payoffDensity≥8 AND lengthFit≥8 AND clarity≥8', () => {
    const result = fresh9({
      readability: 8,
      firstImpression: 8,
      payoffDensity: 8,
      lengthFit: 8,
      clarity: 8,
    });
    expect(result.pass).toBe(true);
  });

  it('clarity=7 fails despite high composite (non-compensating)', () => {
    const result = fresh9({
      readability: 10,
      firstImpression: 10,
      payoffDensity: 10,
      lengthFit: 10,
      clarity: 7,
    });
    // composite floor((10+10+10+10+7)/5) = floor(9.4) = 9 ≥ 8, but clarity gate fails
    expect(result.composite).toBe(9);
    expect(result.pass).toBe(false);
  });
});

describe('checkFreshEyesPassBar — v8 regression (4-dim, no clarity gate)', () => {
  it('defaults to legacy 4-dim math and bar when no version passed', () => {
    const result = checkFreshEyesPassBar({
      readability: 9,
      firstImpression: 8,
      payoffDensity: 8,
      lengthFit: 8,
    });
    // floor((9+8+8+8)/4) = 8
    expect(result.composite).toBe(8);
    expect(result.pass).toBe(true);
  });

  it('has no clarity gate at v8 (clarity absence does not fail)', () => {
    const result = checkFreshEyesPassBar(
      { readability: 9, firstImpression: 8, payoffDensity: 8, lengthFit: 8 },
      8
    );
    expect(result.pass).toBe(true);
  });
});
