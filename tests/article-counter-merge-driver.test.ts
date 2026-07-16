import { describe, expect, it } from 'vitest';

import { mergeArticleCounterText } from '../scripts/merge-article-counter.mjs';

const base = {
  SD: {
    next: 28,
    label: 'ShroomDog Original',
    description: 'Original articles written by ShroomDog',
  },
  GP: {
    next: 253,
    label: 'Gu-log Picks',
    description: 'Articles picked by ShroomDog',
  },
  MP: {
    next: 314,
    label: 'Mogu Picks',
    description: 'Articles autonomously picked and translated by Mogu',
  },
  Lv: {
    next: 18,
    label: 'Level-Up',
    description: 'Beginner tutorials',
  },
};

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function merge(ours: unknown, theirs: unknown): Record<string, { next: number; label: string }> {
  return JSON.parse(mergeArticleCounterText(text(base), text(ours), text(theirs)));
}

describe('article-counter merge driver', () => {
  it('takes max next when both sides bump the same prefix', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.GP.next = 254;
    theirs.GP.next = 257;

    expect(merge(ours, theirs).GP.next).toBe(257);
  });

  it('keeps independent next bumps on different prefixes', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.GP.next = 254;
    theirs.MP.next = 316;

    const merged = merge(ours, theirs);
    expect(merged.GP.next).toBe(254);
    expect(merged.MP.next).toBe(316);
  });

  it('accepts a one-sided label change', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.GP.label = 'Gu-log Picks updated';

    expect(merge(ours, theirs).GP.label).toBe('Gu-log Picks updated');
  });

  it('fails when both sides change the same label differently', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.GP.label = 'One label';
    theirs.GP.label = 'Another label';

    expect(() => merge(ours, theirs)).toThrow('GP.label: both sides changed differently');
  });

  it('fails on malformed JSON', () => {
    expect(() => mergeArticleCounterText(text(base), '{ nope', text(base))).toThrow(
      'ours: invalid JSON'
    );
  });

  it.each([
    ['SP', 'GP'],
    ['CP', 'MP'],
  ])('rejects retired prefix %s with a %s hint', (legacy, canonical) => {
    const bad = structuredClone(base) as Record<string, unknown>;
    bad[legacy] = bad[canonical];
    delete bad[canonical];

    expect(() => mergeArticleCounterText(text(bad), text(base), text(base))).toThrow(
      `retired prefix ${legacy}; use ${canonical}`
    );
  });

  it('rejects missing and unknown counter keys', () => {
    const missing = structuredClone(base) as Record<string, unknown>;
    delete missing.MP;
    expect(() => mergeArticleCounterText(text(missing), text(base), text(base))).toThrow(
      'missing required prefix MP'
    );

    const unknown = { ...structuredClone(base), XX: { next: 1 } };
    expect(() => mergeArticleCounterText(text(unknown), text(base), text(base))).toThrow(
      'unsupported prefix XX'
    );
  });
});
