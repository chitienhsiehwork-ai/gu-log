import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JUDGE_DIMS, JUDGE_DIMS_V9 } from '../scripts/frontmatter-scores.mjs';

const root = path.resolve(import.meta.dirname, '..');
const commandFile = '.claude/commands/vibe-score.md';
const source = fs.readFileSync(path.join(root, commandFile), 'utf8');
const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
const codeBlocks = [...body.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map(([, lang, code]) => ({
  lang,
  code,
}));

// `/vibe-score` once carried its own copy of the Vibe rubric (dimensions,
// anchors, pass bar, output schema) and scored with the session's floating
// model, so it drifted from the real judge. The rubric now lives only in the
// judge contract that scripts/tribunal.sh runs; the command must stay a thin
// wrapper around that runner (#1164).
describe('/vibe-score command stays a thin wrapper around tribunal.sh', () => {
  it('GIVEN the command WHEN an agent runs it THEN its only executable step is a score-only Vibe stage of tribunal.sh', () => {
    expect(codeBlocks, 'exactly one code block: the runner call').toHaveLength(1);
    const [block] = codeBlocks;
    expect(block.lang).toBe('bash');

    const runnerCalls = block.code.split('\n').filter((line) => /\bscripts\/\S+\.sh\b/.test(line));
    expect(runnerCalls, 'one script call, to the canonical runner').toHaveLength(1);
    const [call] = runnerCalls;
    expect(call).toMatch(/\bbash scripts\/tribunal\.sh\b/);
    expect(call).toMatch(/(?:^|\s)--score-only(?:\s|$)/);
    expect(call).toMatch(/(?:^|\s)--only-stage[ =]vibe(?:\s|$)/);
    expect(call).toContain('"$ARGUMENTS"');
  });

  it('GIVEN the rubric lives in the judge contract WHEN the command is read THEN it embeds no judge dimensions, anchors, pass-bar math or output schema', () => {
    // Every dimension any Tribunal version scores, from the frontmatter SSOT.
    // `vibe` is both a dimension and the stage name the command must pass.
    const dimensions = new Set(
      [...Object.values(JUDGE_DIMS), ...Object.values(JUDGE_DIMS_V9)]
        .flat()
        .filter((dim) => dim !== 'vibe')
    );
    expect(dimensions.size).toBeGreaterThan(0);
    for (const dim of dimensions) {
      expect(body, `dimension "${dim}"`).not.toMatch(new RegExp(`\\b${dim}\\b`, 'i'));
    }

    expect(body, 'calibration anchors').not.toMatch(/\b(?:GP|MP|SD|SP|CP|Lv)-\d+\b/i);
    expect(body, 'pass-bar thresholds or composite math').not.toMatch(
      /[≥≤]|>=|<=|\bfloor\(|\/\s*\d\b/
    );
    expect(body, 'own output schema or JSON example').not.toMatch(/```json|"judge"\s*:/);
  });
});
