import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  BOARD_SCHEMA_VERSION,
  CONTRACT_VERSION,
  EXPERIMENT_SCHEMA_VERSION,
  MODEL_SPECS,
  RESULT_SCHEMA_VERSION,
  buildInvocation,
  executeExperiment,
  extractIncumbent,
  initializeExperiment,
  planRetry,
  renderBoardHTML,
  sha256,
  stableJSON,
  stripMoguNotes,
  unwrapStructuredOutput,
  validateBlindPacket,
  validateCommentaryArtifact,
  validatePrivateMapping,
  validateInvocationProvenance,
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

  it('allows one transport retry or a semantics-frozen format repair, but not auth retry', () => {
    expect(planRetry({ failureClass: 'TRANSPORT', exitStatus: 1, rawOutput: '', inputs })).toEqual({
      kind: 'transport',
      target: null,
    });
    expect(planRetry({ failureClass: 'AUTH', exitStatus: 1, rawOutput: '', inputs })).toBeNull();
    const malformed = {
      ...validArtifact(),
      version: 'stale-version',
      source_sha256: '0'.repeat(64),
      candidates: [{ ...validArtifact().candidates[0], after_byte: 1, extra: true }],
    };
    const retry = planRetry({
      failureClass: undefined,
      exitStatus: 0,
      provenanceValidated: true,
      rawOutput: JSON.stringify(malformed),
      inputs,
    });
    expect(retry?.kind).toBe('format');
    expect(retry?.target).toEqual(validArtifact());
    expect(retry?.target?.candidates[0].commentary).toBe(malformed.candidates[0].commentary);
    expect(
      planRetry({
        failureClass: undefined,
        exitStatus: 0,
        provenanceValidated: false,
        rawOutput: JSON.stringify(malformed),
        inputs,
      })
    ).toBeNull();
  });
});

describe('anonymous ranking board', () => {
  const packetCore = {
    schema_version: BOARD_SCHEMA_VERSION,
    experiment_id: 'gp-273-0123456789abcdef',
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
  const packet = { ...packetCore, board_sha256: sha256(stableJSON(packetCore)) };

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
    expect(html).toContain('--control-line:#8f8a81');
    expect(html).toContain('.rank{position:static');
    expect(html).toContain('preferred?.focus()');
    expect(html).toContain("index===0?'disabled'");
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

  it('recomputes the packet hash instead of trusting a stored digest', () => {
    expect(validateBlindPacket(packet)).toEqual(packet);
    const changed = {
      ...packet,
      entries: [{ ...packet.entries[0], note: '被換掉了。' }, packet.entries[1]],
    };
    expect(() => validateBlindPacket(changed)).toThrow('self-hash');
  });
});

describe('private evidence integrity', () => {
  it('disables Codex tools, limits reads to the run CWD and refuses unattested model identity', () => {
    const spec = MODEL_SPECS.find((candidate) => candidate.provider === 'codex')!;
    const invocation = buildInvocation(spec, {
      effort: 'high',
      runDir: '/private/tmp/gu-log-mogunote-blind.test/runs/opaque',
      schema: {},
      sessionId: 'isolated-session',
      outputPath: '/private/tmp/gu-log-mogunote-blind.test/runs/opaque/output.json',
    });
    expect(invocation.args).not.toContain('--sandbox');
    expect(invocation.args).toContain(
      'permissions.cwd-readonly={ filesystem={ ":root"="deny", ":minimal"="read", ":tmpdir"="deny", ":slash_tmp"="deny", ":workspace_roots"={ "."="read" } }, network={ enabled=false } }'
    );
    for (const feature of [
      'shell_tool',
      'unified_exec',
      'view_image',
      'apps',
      'browser_use',
      'computer_use',
    ]) {
      expect(invocation.args).toContain(feature);
    }
    expect(() =>
      validateInvocationProvenance(spec, {
        actualModel: null,
        actualModelSource: null,
        providerReportedModels: [],
        providerSessionId: 'thread-id',
      })
    ).toThrow('does not attest');
    expect(
      validateInvocationProvenance(
        MODEL_SPECS.find((candidate) => candidate.model === 'claude-opus-5')!,
        {
          actualModel: 'claude-opus-5',
          actualModelSource: 'provider_usage',
          providerReportedModels: ['claude-opus-5'],
          providerSessionId: 'session-id',
        }
      )
    ).toBeTruthy();
  });

  it('requires a complete current/revised pair while preserving collapsed abstention provenance', () => {
    const artifact = validArtifact();
    const abstention = { ...artifact, candidates: [] };
    const entries = [
      {
        id: 'N01',
        before: '前文。',
        after: '後文。',
        summary: '',
        note: artifact.candidates[0].commentary,
        empty: false,
      },
      {
        id: 'N02',
        before: '前文。',
        after: '後文。',
        summary: '舊稿',
        note: '舊旁白。',
        empty: false,
      },
      { id: 'N03', before: '前文。', after: '後文。', summary: '', note: '', empty: true },
    ];
    const core = {
      schema_version: BOARD_SCHEMA_VERSION,
      experiment_id: 'gp-273-integrity',
      title: 'GP-273 MoguNote 匿名評選',
      entries,
    };
    const packet = { ...core, board_sha256: sha256(stableJSON(core)) };
    const attempt = (suffix: string) => ({
      run_uuid: `run-${suffix}`,
      isolation_session_id: `isolation-${suffix}`,
      provider_session_id: `provider-${suffix}`,
      validation_error: null,
    });
    const cells = [
      {
        requested_model: 'claude-opus-5',
        arm: 'current',
        status: 'VALID',
        artifact,
        actual_model: 'claude-opus-5',
        actual_model_source: 'provider_usage',
        attempts: [attempt('current')],
      },
      {
        requested_model: 'claude-opus-5',
        arm: 'revised',
        status: 'VALID',
        artifact: abstention,
        actual_model: 'claude-opus-5',
        actual_model_source: 'provider_usage',
        attempts: [attempt('revised')],
      },
    ];
    const mapped = (
      arm: string,
      id: string,
      value: typeof artifact,
      suffix: string,
      type: string
    ) => ({
      requested_model: 'claude-opus-5',
      actual_model: 'claude-opus-5',
      actual_model_source: 'provider_usage',
      provider: 'claude',
      arm,
      type,
      run_uuid: `run-${suffix}`,
      isolation_session_id: `isolation-${suffix}`,
      provider_session_id: `provider-${suffix}`,
      candidate_sha256: sha256(stableJSON(value)),
      id,
    });
    const mapping = {
      schema_version: EXPERIMENT_SCHEMA_VERSION,
      experiment_id: packet.experiment_id,
      board_sha256: packet.board_sha256,
      entries: [
        { id: 'N01', type: 'candidate', candidate_sha256: sha256(stableJSON(artifact)) },
        { id: 'N02', type: 'incumbent', candidate_sha256: sha256('incumbent') },
        { id: 'N03', type: 'no-note', candidate_sha256: sha256('no-note') },
      ],
      cells: [
        mapped('current', 'N01', artifact, 'current', 'candidate'),
        mapped('revised', 'N03', abstention, 'revised', 'abstain'),
      ],
    };
    expect(validatePrivateMapping(mapping, packet, cells)).toEqual(mapping);
    expect(() =>
      validatePrivateMapping({ ...mapping, cells: mapping.cells.slice(0, 1) }, packet, cells)
    ).toThrow('every admissible model pair');
    expect(() => validatePrivateMapping({ ...mapping, cells: [] }, packet, cells)).toThrow(
      'every admissible model pair'
    );
  });

  it('rejects an invalid root before creating or chmodding it', async () => {
    const forbidden = `/private/tmp/not-a-mogunote-root-${Date.now()}`;
    await expect(
      initializeExperiment({ repoRoot: process.cwd(), root: forbidden })
    ).rejects.toThrow('direct child');
    await expect(fs.lstat(forbidden)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a non-pristine execution phase before invoking any provider', async () => {
    const root = `/private/tmp/gu-log-mogunote-blind.phase-${Date.now()}`;
    try {
      await initializeExperiment({ repoRoot: process.cwd(), root });
      await fs.writeFile(`${root}/collector/partial.json`, '{}\n', { mode: 0o600 });
      await expect(executeExperiment(root, { concurrency: 1 })).rejects.toThrow('not pristine');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
