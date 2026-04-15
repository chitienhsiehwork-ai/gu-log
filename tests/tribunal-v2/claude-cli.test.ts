/**
 * Tribunal v2 — Contract tests for claude-cli helpers.
 *
 * These tests exercise the JSON extraction logic with realistic agent
 * outputs. They do NOT spawn the real `claude` CLI (that's Layer 3 /
 * end-to-end). See tests/tribunal-v2/README.md for the test layering
 * philosophy.
 */

import { describe, it, expect } from 'vitest';
import { extractJson } from '../../src/lib/tribunal-v2/runners/claude-cli';

describe('extractJson — v1 → v2 migration safety', () => {
  it('parses plain JSON object', () => {
    const obj = extractJson('{"a":1,"b":"two"}') as { a: number; b: string };
    expect(obj).toEqual({ a: 1, b: 'two' });
  });

  it('strips leading + trailing markdown json fences', () => {
    const raw = '```json\n{"pass":true,"composite":9}\n```';
    expect(extractJson(raw)).toEqual({ pass: true, composite: 9 });
  });

  it('strips bare ``` fences', () => {
    const raw = '```\n{"x":1}\n```';
    expect(extractJson(raw)).toEqual({ x: 1 });
  });

  it('skips prose preceding the JSON body', () => {
    const raw = `Here is my scoring result for the article:

{"pass": false, "scores": {"persona": 7}, "composite": 7}`;
    expect(extractJson(raw)).toEqual({
      pass: false,
      scores: { persona: 7 },
      composite: 7,
    });
  });

  it('handles nested structures with string braces', () => {
    const raw = '{"msg":"hello {world} and }","n":{"a":1}}';
    const parsed = extractJson(raw) as { msg: string; n: { a: number } };
    expect(parsed.msg).toBe('hello {world} and }');
    expect(parsed.n).toEqual({ a: 1 });
  });

  it('parses arrays at the top level', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses the real v2 VibeJudgeOutput shape emitted by agents', () => {
    // Real output captured from smoke test against cp-290
    const raw = `PASS — composite 8
\`\`\`json
{
  "pass": true,
  "scores": {
    "persona": 8,
    "clawdNote": 8,
    "vibe": 8,
    "clarity": 9,
    "narrative": 9
  },
  "composite": 8,
  "judge_model": "claude-opus-4-6",
  "judge_version": "2.0.0",
  "timestamp": "2026-04-15T12:00:00Z"
}
\`\`\``;
    const parsed = extractJson(raw) as {
      pass: boolean;
      scores: Record<string, number>;
      composite: number;
      judge_model: string;
      judge_version: string;
      timestamp: string;
    };
    expect(parsed.pass).toBe(true);
    expect(parsed.scores.clarity).toBe(9);
    expect(parsed.composite).toBe(8);
    expect(parsed.judge_version).toBe('2.0.0');
  });

  it('throws when no JSON is present', () => {
    expect(() => extractJson('no json here at all, just prose')).toThrow(/No valid JSON found/);
  });

  it('rejects string-embedded braces after invalid JSON body', () => {
    // If the first { starts garbage, make sure we don't loop forever
    const bad = '{incomplete and then {"real":"json"}';
    const parsed = extractJson(bad) as { real: string };
    expect(parsed).toEqual({ real: 'json' });
  });
});
