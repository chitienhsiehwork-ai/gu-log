import { describe, expect, it } from 'vitest';

import {
  BOARD_SCHEMA_VERSION,
  CONTRACT_VERSION,
  RESULT_SCHEMA_VERSION,
  extractIncumbent,
  renderBoardHTML,
  sha256,
  stripMoguNotes,
  unwrapStructuredOutput,
  validateCommentaryArtifact,
  validateRankingResult,
} from '../scripts/experiments/mogunote-blind/lib.mjs';

const translation = `---
title: 測試
---

第一段。

第二段。
`;
const source = 'Source text.';
const inputs = {
  source,
  translation,
  sourceSha256: sha256(source),
  translationSha256: sha256(translation),
};

function validArtifact() {
  const anchor = '第一段。';
  return {
    version: CONTRACT_VERSION,
    source_sha256: inputs.sourceSha256,
    translation_sha256: inputs.translationSha256,
    candidates: [
      {
        id: 'candidate-1',
        anchor_text: anchor,
        after_byte: Buffer.byteLength(
          translation.slice(0, translation.indexOf(anchor) + anchor.length)
        ),
        commentary: '工具把成本藏起來時，速度常常只是帳單晚到。',
      },
    ],
  };
}

describe('MoguNote blind experiment contract', () => {
  it('freezes the translation by removing the one note and its unused import', () => {
    const post = `---
title: 測試
---

import MoguNote from '../../components/MoguNote.astro';

正文。

<MoguNote summary="摘要">
旁白。
</MoguNote>
`;
    expect(stripMoguNotes(post, { expectedCount: 1 })).not.toContain('MoguNote');
    expect(stripMoguNotes(post, { expectedCount: 1 })).toContain('正文。');
    expect(() => stripMoguNotes(post, { expectedCount: 2 })).toThrow('expected 2');
    expect(extractIncumbent(post)).toEqual({
      summary: '摘要',
      commentary: '旁白。',
      anchorText: '正文。',
    });
  });

  it('accepts only explicit zero-or-one strict candidates with fresh hashes and anchors', () => {
    expect(validateCommentaryArtifact(validArtifact(), inputs)).toEqual(validArtifact());
    expect(
      validateCommentaryArtifact({ ...validArtifact(), candidates: [] }, inputs).candidates
    ).toEqual([]);

    const multiple = validArtifact();
    multiple.candidates.push({ ...multiple.candidates[0], id: 'candidate-2' });
    expect(() => validateCommentaryArtifact(multiple, inputs)).toThrow('at most one');
    expect(() =>
      validateCommentaryArtifact({ ...validArtifact(), translation_sha256: '0'.repeat(64) }, inputs)
    ).toThrow('stale');
    expect(() =>
      validateCommentaryArtifact({ ...validArtifact(), candidates: null }, inputs)
    ).toThrow('explicit array');
    expect(() =>
      validateCommentaryArtifact(
        { ...validArtifact(), candidates: [{ ...validArtifact().candidates[0], extra: true }] },
        inputs
      )
    ).toThrow('keys');
    expect(() =>
      validateCommentaryArtifact(
        {
          ...validArtifact(),
          candidates: [{ ...validArtifact().candidates[0], after_byte: 3 }],
        },
        inputs
      )
    ).toThrow('outside');
  });

  it('unwraps known CLI transport envelopes without accepting fenced model prose', () => {
    const artifact = validArtifact();
    expect(unwrapStructuredOutput(JSON.stringify(artifact))).toEqual(artifact);
    expect(unwrapStructuredOutput(JSON.stringify({ structured_output: artifact }))).toEqual(
      artifact
    );
    expect(unwrapStructuredOutput(JSON.stringify({ result: JSON.stringify(artifact) }))).toEqual(
      artifact
    );
    expect(() => unwrapStructuredOutput('```json\n{}\n```')).toThrow('bare JSON');
  });
});

describe('anonymous ranking board', () => {
  const packet = {
    schema_version: BOARD_SCHEMA_VERSION,
    experiment_id: 'gp-273-0123456789abcdef',
    board_sha256: 'a'.repeat(64),
    title: 'GP-273 MoguNote 匿名評選',
    entries: [
      {
        id: 'N01',
        before: '前文。',
        after: '後文。',
        summary: '',
        note: '多看懂一層。',
        empty: false,
      },
      {
        id: 'N02',
        before: '前文。',
        after: '',
        summary: '',
        note: '',
        empty: true,
      },
    ],
  };

  it('renders a self-contained board with comments, autosave, keyboard moves and JSON export', () => {
    const html = renderBoardHTML(packet);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('localStorage');
    expect(html).toContain('你的評論');
    expect(html).toContain('上移');
    expect(html).toContain('下載 JSON');
    expect(html).toContain('unreviewed');
    expect(html).toContain("['unreviewed','keep','pending','reject'].includes");
    expect(html).toContain('aria-checked');
    expect(html).toContain('id="progress"');
    for (const leaked of ['gpt-5.6-sol', 'claude-opus-5', 'grok-4.6', '/private/tmp']) {
      expect(html).not.toContain(leaked);
    }
  });

  it('rejects stale, duplicate and incomplete ranking exports', () => {
    const result = {
      schema_version: RESULT_SCHEMA_VERSION,
      experiment_id: packet.experiment_id,
      board_sha256: packet.board_sha256,
      submitted_at: '2026-08-16T00:00:00.000Z',
      ranking: ['N01'],
      decisions: { N01: 'keep', N02: 'pending' },
      comments: { N01: '有味道。', N02: '' },
    };
    expect(validateRankingResult(result, packet)).toEqual(result);
    expect(() =>
      validateRankingResult({ ...result, board_sha256: 'b'.repeat(64) }, packet)
    ).toThrow('stale');
    expect(() => validateRankingResult({ ...result, ranking: ['N01', 'N01'] }, packet)).toThrow(
      'duplicates'
    );
    expect(() =>
      validateRankingResult({ ...result, comments: { N01: 'missing N02' } }, packet)
    ).toThrow('missing comment');
    expect(() =>
      validateRankingResult(
        { ...result, decisions: { ...result.decisions, N02: 'unreviewed' } },
        packet
      )
    ).toThrow('missing decision');
  });
});
