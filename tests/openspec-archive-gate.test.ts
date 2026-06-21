import { describe, expect, it } from 'vitest';
import { findUnarchivedNewChanges } from '../scripts/check-openspec-archive.mjs';

describe('findUnarchivedNewChanges', () => {
  it('passes on an empty diff', () => {
    expect(findUnarchivedNewChanges(['existing-change'], ['existing-change'])).toEqual([]);
  });

  it('fails with one newly introduced active change', () => {
    expect(findUnarchivedNewChanges([], ['new-change'])).toEqual(['new-change']);
  });

  it('passes when a newly introduced change was archived', () => {
    expect(findUnarchivedNewChanges([], [])).toEqual([]);
  });

  it('passes for a grandfathered active change present in base and head', () => {
    expect(findUnarchivedNewChanges(['grandfathered-change'], ['grandfathered-change'])).toEqual(
      []
    );
  });

  it('lists every newly introduced active change in sorted order', () => {
    expect(
      findUnarchivedNewChanges(
        ['grandfathered-change'],
        ['z-new-change', 'grandfathered-change', 'a-new-change']
      )
    ).toEqual(['a-new-change', 'z-new-change']);
  });
});
