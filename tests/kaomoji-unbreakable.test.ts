import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs gate module has no type declarations
import { check } from '../scripts/check-kaomoji-unbreakable.mjs';

// CI gate (runs in the `unit-tests` vitest job): every known kaomoji must be
// detected and made unbreakable by remark-kaomoji-nowrap, and no ordinary
// parenthetical may be wrongly modified. Mirrors scripts/check-kaomoji-
// unbreakable.mjs, which also runs in pre-commit.
describe('kaomoji never split across a line', () => {
  const { ok, hard, warn } = check();

  it('every corpus kaomoji is detected and atomic; no false positives', () => {
    expect(hard, hard.join('\n')).toEqual([]);
    expect(ok).toBe(true);
  });

  it('surfaces any possible un-protected kaomoji as a warning (non-blocking)', () => {
    if (warn.length) console.warn('kaomoji warnings:\n' + warn.join('\n'));
    expect(Array.isArray(warn)).toBe(true);
  });
});
