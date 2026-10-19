import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

// Only guards against deliberately retired rules coming back. Positive
// assertions on prompt wording were removed: they failed on every harmless
// rephrase without protecting behavior. The editorial contract itself lives in
// openspec/specs/editorial-charter/spec.md.
describe('retired editorial rules stay retired', () => {
  it('keeps the retired GP translation contract out of the judges', () => {
    for (const file of [
      '.claude/agents/fact-checker.md',
      '.codex/agents/fact-checker.toml',
      '.claude/agents/librarian.md',
      '.codex/agents/librarian.toml',
      '.claude/agents/fresh-eyes.md',
      '.codex/agents/fresh-eyes.toml',
      '.claude/agents/vibe-opus-scorer.md',
      '.codex/agents/vibe-opus-scorer.toml',
      'scripts/vibe-scoring-standard.md',
    ]) {
      expect(read(file), file).not.toMatch(
        /complete translation|translation fidelity|complete-coverage|source-author-voice|inherit GP|原文出處|calibration-only/
      );
    }
  });

  it('keeps the old blanket lived-experience ban out of writer guidance', () => {
    for (const file of ['GU-LOG_WRITER_PROMPT.md', 'scripts/mogu-picks-prompt.md']) {
      expect(read(file), file).not.toMatch(/捏造[^\n。]*(?:親身經歷|lived experience)/);
    }
  });

  it('keeps taken-down GP posts out of the calibration anchors', () => {
    for (const file of [
      '.claude/agents/fact-checker.md',
      '.claude/agents/vibe-opus-scorer.md',
      '.claude/agents/tribunal-writer.md',
      '.codex/agents/librarian.toml',
      '.codex/agents/fresh-eyes.toml',
      '.codex/agents/vibe-opus-scorer.toml',
      '.codex/agents/tribunal-writer.toml',
      'scripts/vibe-scoring-standard.md',
      '.codex/agents/references/v7-recap-false-positive.md',
    ]) {
      expect(read(file), file).not.toMatch(/\bGP-\d+|gp-\d+-/);
    }
  });

  it('does not add MP rewrite/original submodes to operator-facing surfaces', () => {
    for (const file of [
      'CONTRIBUTING.md',
      'tools/gp-pipeline/SKILL.md',
      'tools/gp-pipeline/README.md',
      'scripts/mogu-picks-prompt.md',
    ]) {
      expect(read(file), file).not.toMatch(/MP-(?:rewrite|original)|mp-(?:rewrite|original)/);
    }
  });
});
