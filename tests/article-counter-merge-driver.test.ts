import { describe, expect, it } from 'vitest';

import { mergeArticleCounterText } from '../scripts/merge-article-counter.mjs';

const base = {
  SD: {
    next: 28,
    label: 'ShroomDog Original',
    description: 'Original articles written by ShroomDog',
  },
  SP: {
    next: 253,
    label: 'Gu-log Picks',
    description: 'Articles picked by ShroomDog',
  },
  CP: {
    next: 314,
    label: 'Mogu Picks',
    description: 'Articles autonomously picked and translated by Mogu',
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
    ours.SP.next = 254;
    theirs.SP.next = 257;

    expect(merge(ours, theirs).SP.next).toBe(257);
  });

  it('keeps independent next bumps on different prefixes', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.SP.next = 254;
    theirs.CP.next = 316;

    const merged = merge(ours, theirs);
    expect(merged.SP.next).toBe(254);
    expect(merged.CP.next).toBe(316);
  });

  it('accepts a one-sided label change', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.SP.label = 'Gu-log Picks / SP';

    expect(merge(ours, theirs).SP.label).toBe('Gu-log Picks / SP');
  });

  it('fails when both sides change the same label differently', () => {
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.SP.label = 'One label';
    theirs.SP.label = 'Another label';

    expect(() => merge(ours, theirs)).toThrow('SP.label: both sides changed differently');
  });

  it('fails on malformed JSON', () => {
    expect(() => mergeArticleCounterText(text(base), '{ nope', text(base))).toThrow(
      'ours: invalid JSON'
    );
  });
});
