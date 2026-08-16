import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('MP editorial contract', () => {
  it('keeps Claude and Codex judges aligned on retained-claim grounding', () => {
    for (const file of [
      '.claude/agents/fact-checker.md',
      '.codex/agents/fact-checker.toml',
      '.claude/agents/librarian.md',
      '.codex/agents/librarian.toml',
    ]) {
      const contract = read(file);
      expect(contract, file).toContain('controlling caveat');
      expect(contract, file).toContain('speaker');
      expect(contract, file).toMatch(/MoguNote is optional|MoguNote 選配/);
      expect(contract, file).toMatch(/omit|omitted|省略/);
    }
  });

  it('maps a complete no-MoguNote MP onto the existing scoring schema without forcing a note', () => {
    const standard = read('scripts/vibe-scoring-standard.md');
    const claudeScorer = read('.claude/agents/vibe-opus-scorer.md');
    const codexScorer = read('.codex/agents/vibe-opus-scorer.toml');

    expect(standard).toContain('MP 無 note 對映');
    expect(standard).toContain('`moguNote` 維度改看 body');
    for (const scorer of [claudeScorer, codexScorer]) {
      expect(scorer).toContain('MoguNote is optional');
      expect(scorer).toMatch(/Absence alone must not lower the score/);
      expect(scorer).toMatch(/body voice/);
    }
  });

  it('keeps Tribunal Writer from pushing Mogu analysis out of MP body', () => {
    for (const file of [
      '.claude/agents/tribunal-writer.md',
      '.codex/agents/tribunal-writer.toml',
    ]) {
      const writer = read(file);
      expect(writer, file).toMatch(/core analysis|core thesis/);
      expect(writer, file).toMatch(/body/);
      expect(writer, file).toContain('MoguNote is optional');
    }
  });
});
