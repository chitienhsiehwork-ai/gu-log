import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { canonicalPrefix, selectPair, validateCounter } from '../scripts/allocate-ticket.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fromRoot = (...parts: string[]) => path.join(root, ...parts);

describe('canonical pipeline surface', () => {
  it('keeps one GP pipeline entrypoint and no retired wrappers or binary', () => {
    const entrypoint = fromRoot('tools', 'gp-pipeline', 'gp-pipeline');
    const bytes = fs.readFileSync(entrypoint);

    expect(bytes.subarray(0, 19).toString()).toBe('#!/usr/bin/env bash');
    expect(fs.existsSync(fromRoot('tools', 'sp-pipeline'))).toBe(false);
    expect(fs.existsSync(fromRoot('scripts', 'gp-pipeline.sh'))).toBe(false);
    expect(fs.existsSync(fromRoot('scripts', 'sp-pipeline.sh'))).toBe(false);
  });

  it('exposes only canonical Mogu Picks automation filenames', () => {
    for (const file of [
      'mogu-picks-config.json',
      'mogu-picks-loop.sh',
      'mogu-picks-prompt.md',
      'mogu-picks-queue.yaml',
    ]) {
      expect(fs.existsSync(fromRoot('scripts', file)), file).toBe(true);
    }

    for (const file of [
      'clawd-picks-config.json',
      'clawd-picks-loop.sh',
      'clawd-picks-prompt.md',
      'cp-candidates-queue.yaml',
      'cp-dedup-guard.sh',
      'cp-dedup-queue.sh',
      'cp-dedup-similarity.py',
      'renumber-cp.sh',
      'renumber-cp.py',
    ]) {
      expect(fs.existsSync(fromRoot('scripts', file)), file).toBe(false);
    }
  });

  it('preserves the 44 publishable queue URLs and isolates the orphan record', () => {
    const queue = parseYaml(fs.readFileSync(fromRoot('scripts', 'mogu-picks-queue.yaml'), 'utf8'));

    expect(queue.candidates).toHaveLength(44);
    expect(queue.candidates.every((candidate: { url?: string }) => candidate.url)).toBe(true);
    expect(queue.candidates[0].url).toBe('https://x.com/daniel_mac8/status/2032331508212457472');
    expect(queue.candidates.at(-1).url).toBe(
      'https://9to5mac.com/2026/04/09/anthropic-scales-up-with-enterprise-features-for-claude-cowork-and-managed-agents/'
    );
    expect(queue.incompleteCandidates).toEqual([
      expect.objectContaining({ reason: 'missing-source-url' }),
    ]);
    expect(queue.incompleteCandidates[0]).not.toHaveProperty('url');
  });

  it('uses the canonical MP pipeline without early counter allocation', () => {
    const prompt = fs.readFileSync(fromRoot('scripts', 'mogu-picks-prompt.md'), 'utf8');

    expect(prompt).toContain('gp-pipeline run "SOURCE_URL" --prefix MP');
    expect(prompt).toContain('MP-PENDING');
    expect(prompt).not.toContain('--series CP');
    expect(prompt).not.toContain('CP-PENDING');
    expect(prompt).not.toContain('MP.next++');
  });
});

describe('manual allocation prefix contract', () => {
  it.each([
    ['gp', 'GP'],
    ['MP', 'MP'],
    ['sd', 'SD'],
    ['lv', 'Lv'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(canonicalPrefix(input)).toBe(expected);
  });

  it.each(['SP', 'CP', 'unknown'])('does not expose a compatibility alias for %s', (input) => {
    expect(canonicalPrefix(input)).toBeNull();
  });

  it.each([
    ['SP', 'GP'],
    ['CP', 'MP'],
  ])('rejects retired filter %s with a %s hint', (legacy, canonical) => {
    expect(() => selectPair([], legacy)).toThrow(`Retired prefix ${legacy}; use ${canonical}`);
  });

  it('rejects legacy, missing, and unknown counter keys', () => {
    const canonical = {
      GP: { next: 1 },
      MP: { next: 1 },
      SD: { next: 1 },
      Lv: { next: 1 },
    };
    expect(() => validateCounter(canonical)).not.toThrow();
    expect(() => validateCounter({ ...canonical, SP: { next: 1 } })).toThrow(
      'retired prefix SP; use GP'
    );
    const { MP: _missing, ...missing } = canonical;
    expect(() => validateCounter(missing)).toThrow('missing required prefix(es): MP');
    expect(() => validateCounter({ ...canonical, XX: { next: 1 } })).toThrow(
      'unsupported prefix(es): XX'
    );
  });
});

describe('article counter taxonomy', () => {
  it('has exactly the four canonical keys', () => {
    const counter = JSON.parse(
      fs.readFileSync(fromRoot('scripts', 'article-counter.json'), 'utf8')
    );
    expect(Object.keys(counter).sort()).toEqual(['GP', 'Lv', 'MP', 'SD']);
  });
});
