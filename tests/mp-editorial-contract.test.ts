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
      expect(contract, file).toMatch(/controlling\s+caveat/);
      expect(contract, file).toContain('speaker');
      expect(contract, file).toMatch(/MoguNote is\s+optional|MoguNote 選配/);
      expect(contract, file).toMatch(/omit|omitted|省略/);
      expect(contract, file).toMatch(/no minimum editorial\s+distance/);
      expect(contract, file).toMatch(
        /close translation\/rewrite|close\s+form|stay close through\s+translation\/rewrite/i
      );
      expect(contract, file).toMatch(/source-author experience|source author's experience/);
      expect(contract, file).toMatch(/plausible fabricated human biography/);
    }
  });

  it('keeps each pipeline stage aligned on distance and experience boundaries', () => {
    for (const file of [
      'tools/gp-pipeline/internal/prompts/write.tmpl',
      'tools/gp-pipeline/internal/prompts/review.tmpl',
      'tools/gp-pipeline/internal/prompts/refine.tmpl',
    ]) {
      const contract = read(file);
      expect(contract, file).toMatch(
        /no\s+minimum editorial\s+distance|editorial-distance freedom/i
      );
      expect(contract, file).toMatch(/close(?:-form)? translation\/rewrite|close-form MP/i);
      expect(contract, file).toMatch(
        /rebuild(?:ed)? (?:the )?article|rebuild freely|freely rebuilt/i
      );
      expect(contract, file).toMatch(/does not inherit GP|without adding GP/i);
      expect(contract, file).toMatch(/editorial\/tool interactions that actually happened/);
      expect(contract, file).toMatch(/clearly fantastical persona experiences/);
      expect(contract, file).toMatch(/source-author experience|source author's experiments/);
      expect(contract, file).toMatch(/plausible fabricated human biography|plausible human work/);
    }
  });

  it('keeps writer guidance aligned without the old blanket lived-experience ban', () => {
    for (const file of ['GU-LOG_WRITER_PROMPT.md', 'scripts/mogu-picks-prompt.md']) {
      const contract = read(file);
      expect(contract, file).toContain('最低改寫幅度');
      expect(contract, file).toContain('實際發生的 editorial／tool interaction');
      expect(contract, file).toContain('奇幻 persona');
      expect(contract, file).not.toMatch(/捏造[^\n。]*(?:親身經歷|lived experience)/);
    }
  });

  it('keeps vibe scorers from penalizing valid distance or persona choices', () => {
    for (const file of [
      '.claude/agents/vibe-opus-scorer.md',
      '.codex/agents/vibe-opus-scorer.toml',
      'scripts/vibe-scoring-standard.md',
    ]) {
      const contract = read(file);
      expect(contract, file).toMatch(/no\s+minimum editorial\s+distance/);
      expect(contract, file).toMatch(/Do not reward or penalize|Do not penalize/i);
      expect(contract, file).toMatch(/editorial\/tool interactions that actually happened/);
      expect(contract, file).toMatch(/clearly fantastical\s+persona/);
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
      expect(scorer).toMatch(/Absence alone must not lower\s+the\s+score/);
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
      expect(writer, file).toMatch(/no minimum editorial\s+distance/);
      expect(writer, file).toMatch(/editorial\/tool\s+interactions\s+that\s+actually\s+happened/);
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
