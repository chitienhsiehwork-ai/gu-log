/**
 * Unit tests for content-gate scripts:
 *   - scripts/detect-model.mjs (formatModelName)
 *   - scripts/check-jingjing.mjs (isAllowed / maskContent / checkFile)
 *   - scripts/check-pronoun-clarity.mjs (buildMask / findViolations / stripInlineCode)
 *   - scripts/check-translatedby-model.mjs (parseFrontmatter)
 *   - scripts/frontmatter-scores.mjs (parseScores / serializeScores / splitFrontmatter / removeScoresBlock)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { formatModelName } from '../scripts/detect-model.mjs';
import * as jjModule from '../scripts/check-jingjing.mjs';
import * as pronModule from '../scripts/check-pronoun-clarity.mjs';
import * as tbmModule from '../scripts/check-translatedby-model.mjs';
import * as fmScoresModule from '../scripts/frontmatter-scores.mjs';

// All four are plain JS without .d.ts; widen to any for ergonomic tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
const jj = jjModule as any;
const pron = pronModule as any;
const tbm = tbmModule as any;
const fmScores = fmScoresModule as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════════════
// detect-model
// ════════════════════════════════════════════════════════════════════════════
describe('detect-model.formatModelName', () => {
  it('maps direct ids', () => {
    expect(formatModelName('claude-opus-4-7')).toBe('Opus 4.7');
    expect(formatModelName('claude-opus-4-6')).toBe('Opus 4.6');
    expect(formatModelName('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(formatModelName('claude-haiku-4-5')).toBe('Haiku 4.5');
    expect(formatModelName('gemini-3-pro')).toBe('Gemini 3 Pro');
    expect(formatModelName('gpt-5.3-codex')).toBe('GPT-5.3 Codex');
  });

  it('strips provider prefix', () => {
    expect(formatModelName('anthropic/claude-opus-4-6')).toBe('Opus 4.6');
  });

  it('partial match falls through', () => {
    expect(formatModelName('claude-opus-4-6[1m]')).toBe('Opus 4.6');
  });

  it('unknown id is returned as-is', () => {
    expect(formatModelName('unknown-model')).toBe('unknown-model');
  });

  it('empty input → "Unknown"', () => {
    expect(formatModelName('')).toBe('Unknown');
    expect(formatModelName(null)).toBe('Unknown');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// check-jingjing
// ════════════════════════════════════════════════════════════════════════════
describe('check-jingjing.isAllowed', () => {
  it('allows single chars / pure numbers', () => {
    expect(jj.isAllowed('a')).toBe(true);
    expect(jj.isAllowed('1.0')).toBe(true);
  });
  it('allows short uppercase acronyms', () => {
    expect(jj.isAllowed('API')).toBe(true);
    expect(jj.isAllowed('SDK')).toBe(true);
    expect(jj.isAllowed('LLM')).toBe(true);
  });
  it('allows mixed-case identifiers with numbers', () => {
    expect(jj.isAllowed('GPT-5')).toBe(true);
    expect(jj.isAllowed('K2.5')).toBe(true);
  });
  it('strips trailing punctuation before checking', () => {
    expect(jj.isAllowed('API.')).toBe(true);
  });
  it('rejects decorative english words', () => {
    expect(jj.isAllowed('approach')).toBe(false);
    expect(jj.isAllowed('solid')).toBe(false);
  });
});

describe('check-jingjing.maskContent', () => {
  it('masks fenced code blocks', () => {
    const masked = jj.maskContent('hello\n```js\nlet x = 1;\n```\nworld');
    expect(masked).not.toMatch(/let x = 1/);
    expect(masked).toMatch(/hello/);
    expect(masked).toMatch(/world/);
  });

  it('masks inline code', () => {
    const masked = jj.maskContent('use `npm install` to setup');
    expect(masked).not.toMatch(/npm install/);
  });

  it('masks blockquote lines', () => {
    const masked = jj.maskContent('> quoted english here\nbody');
    expect(masked).not.toMatch(/quoted english here/);
  });

  it('masks frontmatter', () => {
    const masked = jj.maskContent('---\ntitle: Hello\n---\nbody');
    expect(masked).not.toMatch(/title: Hello/);
  });
});

describe('check-jingjing.checkFile', () => {
  it('flags decorative english in zh-tw post', () => {
    const filepath = '/tmp/jj-flag.mdx';
    fs.writeFileSync(
      filepath,
      `---\nlang: zh-tw\n---\n這個 approach 真的很 solid，產出 production-ready 的東西。\n`
    );
    const r = jj.checkFile(filepath);
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.violations.map((v: { word: string }) => v.word)).toEqual(
      expect.arrayContaining(['approach', 'solid'])
    );
  });

  it('skips en- posts', () => {
    const filepath = '/tmp/en-jj.mdx';
    fs.writeFileSync(filepath, `---\nlang: en\n---\nplain English body.\n`);
    const r = jj.checkFile(filepath);
    expect(r.skipped).toBe(true);
  });

  it('passes acronym-only english', () => {
    const filepath = '/tmp/jj-pass.mdx';
    fs.writeFileSync(filepath, `---\nlang: zh-tw\n---\n用 API 跟 CLI 一起測試。\n`);
    const r = jj.checkFile(filepath);
    expect(r.violations).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// check-pronoun-clarity
// ════════════════════════════════════════════════════════════════════════════
describe('check-pronoun-clarity', () => {
  it('isEnglishPost detects en- prefix', () => {
    expect(pron.isEnglishPost('/p/en-foo.mdx')).toBe(true);
    expect(pron.isEnglishPost('/p/foo.mdx')).toBe(false);
  });

  it('stripInlineCode replaces inline code with spaces', () => {
    expect(pron.stripInlineCode('use `你好` here')).toBe('use      here');
  });

  it('buildMask masks frontmatter / fences / ClawdNote / blockquote', () => {
    const lines = [
      '---',
      'title: Hi',
      '---',
      'body line with 你',
      '<ClawdNote>',
      '我來吐槽',
      '</ClawdNote>',
      '> 引用 我',
      '```',
      'code 我 here',
      '```',
      'normal 我 line',
    ];
    const mask = pron.buildMask(lines);
    expect(mask[0]).toBe(true); // frontmatter
    expect(mask[2]).toBe(true);
    expect(mask[4]).toBe(true); // ClawdNote open
    expect(mask[5]).toBe(true); // ClawdNote inner
    expect(mask[7]).toBe(true); // blockquote
    expect(mask[8]).toBe(true); // fence
    expect(mask[9]).toBe(true); // fence inner
    expect(mask[11]).toBe(false); // body
  });

  it('findViolations flags 你 / 我 in body prose', () => {
    const filepath = '/tmp/pronoun.mdx';
    fs.writeFileSync(filepath, `---\nlang: zh-tw\n---\n這篇文章想告訴你一件事。\n`);
    const v = pron.findViolations(filepath);
    expect(v.length).toBe(1);
    expect(v[0].chars).toContain('你');
  });

  it('does NOT flag 你/我 inside ClawdNote', () => {
    const filepath = '/tmp/pronoun-clawd.mdx';
    fs.writeFileSync(
      filepath,
      `---\nlang: zh-tw\n---\n正文沒有事兒。\n<ClawdNote>\n我覺得你應該來看這個\n</ClawdNote>\n`
    );
    const v = pron.findViolations(filepath);
    expect(v).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// check-translatedby-model.parseFrontmatter
// ════════════════════════════════════════════════════════════════════════════
describe('check-translatedby-model.parseFrontmatter', () => {
  it('parses translatedBy.model and harness', () => {
    const fm = tbm.parseFrontmatter(
      '---\ntitle: x\ntranslatedBy:\n  model: Opus 4.6\n  harness: Claude Code\n---\nbody'
    );
    expect(fm.translatedBy.model).toBe('Opus 4.6');
    expect(fm.translatedBy.harness).toBe('Claude Code');
  });

  it('returns null for malformed frontmatter', () => {
    expect(tbm.parseFrontmatter('no frontmatter')).toBeNull();
  });

  it('handles quoted values', () => {
    const fm = tbm.parseFrontmatter(
      `---\ntranslatedBy:\n  model: "Opus 4.7"\n  harness: 'Claude Code'\n---\n`
    );
    expect(fm.translatedBy.model).toBe('Opus 4.7');
    expect(fm.translatedBy.harness).toBe('Claude Code');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// frontmatter-scores
// ════════════════════════════════════════════════════════════════════════════
describe('frontmatter-scores', () => {
  it('VALID_JUDGES matches schema', () => {
    expect(fmScores.VALID_JUDGES).toEqual(['librarian', 'factCheck', 'freshEyes', 'vibe']);
  });

  it('JUDGE_DIMS has 5 vibe dimensions', () => {
    expect(fmScores.JUDGE_DIMS.vibe).toEqual([
      'persona',
      'clawdNote',
      'vibe',
      'clarity',
      'narrative',
    ]);
  });

  it('splitFrontmatter splits FM and body', () => {
    const r = fmScores.splitFrontmatter('---\ntitle: x\n---\nbody here');
    expect(r?.fmText).toBe('title: x');
    expect(r?.body).toBe('body here');
  });

  it('splitFrontmatter returns null when no FM', () => {
    expect(fmScores.splitFrontmatter('no frontmatter')).toBeNull();
  });

  it('parseScores reads numeric + string + nested', () => {
    const fmText = `title: x
scores:
  tribunalVersion: 3
  vibe:
    persona: 8
    clawdNote: 9
    vibe: 8
    clarity: 9
    narrative: 8
    score: 8
    date: "2026-04-01"
    model: "claude-opus-4-6[1m]"`;
    const scores = fmScores.parseScores(fmText);
    expect(scores.tribunalVersion).toBe(3);
    expect(scores.vibe.persona).toBe(8);
    expect(scores.vibe.score).toBe(8);
    expect(scores.vibe.date).toBe('2026-04-01');
    expect(scores.vibe.model).toBe('claude-opus-4-6[1m]');
  });

  it('serializeScores round-trips through parseScores', () => {
    const original = {
      tribunalVersion: 3,
      vibe: {
        persona: 8,
        clawdNote: 9,
        vibe: 8,
        clarity: 9,
        narrative: 8,
        score: 8,
        date: '2026-04-01',
        model: 'claude-opus-4-6[1m]',
      },
    };
    const yaml = fmScores.serializeScores(original);
    const parsed = fmScores.parseScores(yaml);
    expect(parsed).toEqual(original);
  });

  it('removeScoresBlock strips the entire scores: block', () => {
    const fm = `title: x
scores:
  tribunalVersion: 3
  vibe:
    persona: 8
otherKey: y`;
    const stripped = fmScores.removeScoresBlock(fm);
    expect(stripped).not.toMatch(/scores:/);
    expect(stripped).toMatch(/title: x/);
    expect(stripped).toMatch(/otherKey: y/);
  });

  it('serializeScores returns empty for empty input', () => {
    expect(fmScores.serializeScores({})).toBe('');
  });
});
