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
import * as os from 'node:os';
import * as path from 'node:path';

// Per-suite tmpdir; CodeQL js/path-injection-clean (mkdtempSync is a safe origin).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gucg-'));
const tmpPath = (name: string) => path.join(TMP, path.basename(name));
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
  it('allows common engineering terms ShroomDog accepts in zh-tw prose', () => {
    expect(jj.isAllowed('vs')).toBe(true);
    expect(jj.isAllowed('bug')).toBe(true);
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
    const filepath = tmpPath('jj-flag.mdx');
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
    const filepath = tmpPath('en-jj.mdx');
    fs.writeFileSync(filepath, `---\nlang: en\n---\nplain English body.\n`);
    const r = jj.checkFile(filepath);
    expect(r.skipped).toBe(true);
  });

  it('passes acronym-only english', () => {
    const filepath = tmpPath('jj-pass.mdx');
    fs.writeFileSync(filepath, `---\nlang: zh-tw\n---\n用 API 跟 CLI 一起測試。\n`);
    const r = jj.checkFile(filepath);
    expect(r.violations).toEqual([]);
  });
});

describe('check-jingjing ALLOWLIST_RAW parsing (line-aware comments)', () => {
  // Regression for the bug where ALLOWLIST_RAW was tokenized by whitespace
  // across the whole blob, so only the leading '#' token of a comment line
  // was filtered — every other word in that comment's prose silently became
  // an "accepted English" term.
  it('rejects prose words that only ever appear inside a full-line comment', () => {
    // These words appear only in ALLOWLIST_RAW comment lines (annotations
    // explaining why a real term below them was added), never as an actual
    // allowlisted token on their own line.
    expect(jj.isAllowed('Behavioral-economics')).toBe(false);
    expect(jj.isAllowed('happiness')).toBe(false);
    expect(jj.isAllowed('researchers')).toBe(false);
    expect(jj.isAllowed('cited')).toBe(false);
    expect(jj.isAllowed('handle')).toBe(false);
  });

  it('rejects prose from inline "rule #2"-style comment lines', () => {
    // Comment lines that themselves contain a '#' mid-line (e.g. "writer-prompt
    // rule #2: ...") must still be treated as a single comment line, not
    // parsed for tokens after the embedded '#'.
    expect(jj.isAllowed('writer-prompt')).toBe(false);
    expect(jj.isAllowed('embedded')).toBe(false);
  });

  it('still allows real allowlist tokens declared on non-comment lines', () => {
    expect(jj.isAllowed('Superintelligence')).toBe(true);
    expect(jj.isAllowed('Artificial')).toBe(true);
    expect(jj.isAllowed('xG')).toBe(true);
    expect(jj.isAllowed('commit')).toBe(true);
    expect(jj.isAllowed('ClawdNote')).toBe(true);
  });

  it('a zh-tw post using only comment-leaked words is flagged', () => {
    const filepath = tmpPath('jj-comment-leak.mdx');
    fs.writeFileSync(
      filepath,
      `---\nlang: zh-tw\n---\n這篇找了幾位 researchers 討論 happiness 的 cited 研究。\n`
    );
    const r = jj.checkFile(filepath);
    expect(r.violations.map((v: { word: string }) => v.word)).toEqual(
      expect.arrayContaining(['researchers', 'happiness', 'cited'])
    );
  });

  it('warns (not silently floods) when --baseline-ref cannot be resolved', () => {
    const CLI = path.join(__dirname, '..', 'scripts', 'check-jingjing.mjs');
    const filepath = tmpPath('jj-unresolvable-baseline.mdx');
    fs.writeFileSync(filepath, `---\nlang: zh-tw\n---\n這個 approach 真的很 solid。\n`);
    let stderr = '';
    try {
      execFileSync('node', [CLI, '--baseline-ref=does-not-exist/nowhere', filepath], {
        encoding: 'utf-8',
      });
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(stderr).toMatch(/baseline ref .* could not be resolved/);
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
    const filepath = tmpPath('pronoun.mdx');
    fs.writeFileSync(filepath, `---\nlang: zh-tw\n---\n這篇文章想告訴你一件事。\n`);
    const v = pron.findViolations(filepath);
    expect(v.length).toBe(1);
    expect(v[0].chars).toContain('你');
  });

  it('does NOT flag 你/我 inside ClawdNote', () => {
    const filepath = tmpPath('pronoun-clawd.mdx');
    fs.writeFileSync(
      filepath,
      `---\nlang: zh-tw\n---\n正文沒有事兒。\n<ClawdNote>\n我覺得你應該來看這個\n</ClawdNote>\n`
    );
    const v = pron.findViolations(filepath);
    expect(v).toEqual([]);
  });

  it('does NOT flag 我 inside the compound 自我 (self-, not a pronoun)', () => {
    const filepath = tmpPath('pronoun-ziwo.mdx');
    fs.writeFileSync(
      filepath,
      `---\nlang: zh-tw\n---\n一個會自我修正、能自我檢查的 loop 才靠得住。\n`
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

  it('judgeDims(vibe, v8) has 5 dimensions (legacy, with clarity)', () => {
    expect(fmScores.judgeDims('vibe', 8)).toEqual([
      'persona',
      'clawdNote',
      'vibe',
      'clarity',
      'narrative',
    ]);
  });

  it('judgeDims(vibe, v9) has 4 dimensions (no clarity)', () => {
    expect(fmScores.judgeDims('vibe', 9)).toEqual(['persona', 'clawdNote', 'vibe', 'narrative']);
  });

  it('judgeDims(freshEyes, v9) has 5 dimensions (clarity added)', () => {
    expect(fmScores.judgeDims('freshEyes', 9)).toEqual([
      'readability',
      'firstImpression',
      'payoffDensity',
      'lengthFit',
      'clarity',
    ]);
  });

  it('judgeDims(freshEyes, v8) has 4 dimensions (legacy, no clarity)', () => {
    expect(fmScores.judgeDims('freshEyes', 8)).toEqual([
      'readability',
      'firstImpression',
      'payoffDensity',
      'lengthFit',
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

// ════════════════════════════════════════════════════════════════════════════
// score-floor-check (version-aware required vibe dims)
// ════════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { isBelowPublishBar } from '../src/utils/tribunal-scores';

const FLOOR_CHECK = path.join(__dirname, '..', 'scripts', 'score-floor-check.mjs');

function runFloorCheck(file: string): { code: number; stderr: string } {
  try {
    execFileSync('node', [FLOOR_CHECK, file], { encoding: 'utf-8' });
    return { code: 0, stderr: '' };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? '') };
  }
}

describe('score-floor-check version-aware vibe dims', () => {
  it('v9 post passes with 4 vibe dims (no clarity) + composite >= 3', () => {
    const f = tmpPath('floor-v9-ok.mdx');
    fs.writeFileSync(
      f,
      `---
lang: zh-tw
scores:
  tribunalVersion: 9
  vibe:
    persona: 8
    clawdNote: 8
    vibe: 8
    narrative: 8
    score: 8
    date: "2026-06-18"
---
body
`
    );
    expect(runFloorCheck(f).code).toBe(0);
  });

  it('v9 post blocked when missing a required v9 dim (narrative)', () => {
    const f = tmpPath('floor-v9-missing.mdx');
    fs.writeFileSync(
      f,
      `---
lang: zh-tw
scores:
  tribunalVersion: 9
  vibe:
    persona: 8
    clawdNote: 8
    vibe: 8
    score: 8
    date: "2026-06-18"
---
body
`
    );
    const r = runFloorCheck(f);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/narrative/);
  });

  it('v8 post still requires 5 vibe dims (clarity required)', () => {
    const f = tmpPath('floor-v8-missing-clarity.mdx');
    fs.writeFileSync(
      f,
      `---
lang: zh-tw
scores:
  tribunalVersion: 8
  vibe:
    persona: 8
    clawdNote: 8
    vibe: 8
    narrative: 8
    score: 8
    date: "2026-06-18"
---
body
`
    );
    const r = runFloorCheck(f);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/clarity/);
  });

  it('legacy v8 post with clarity present passes', () => {
    const f = tmpPath('floor-v8-ok.mdx');
    fs.writeFileSync(
      f,
      `---
lang: zh-tw
scores:
  tribunalVersion: 8
  vibe:
    persona: 8
    clawdNote: 8
    vibe: 8
    clarity: 8
    narrative: 8
    score: 8
    date: "2026-06-18"
---
body
`
    );
    expect(runFloorCheck(f).code).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Translation-pair publish-bar parity
//
// Why this gate exists: the sp-pipeline only produces the zh-tw post; the en
// version is authored separately, and it is easy to forget to mirror the zh
// scores block into it. When that happens to a sub-8 post, isBelowPublishBar()
// returns false for the score-less en file — so the en version silently leaks
// onto the /en homepage and shows no "refining" badge, while its zh-tw twin is
// correctly held back. (SP-237 shipped with exactly this bug.)
//
// A pre-merge visual check would catch it, but "remember to eyeball both
// languages" is not a system — this assertion is. It runs in the per-PR
// `unit-tests` job and reuses the real runtime helpers (parseScores +
// isBelowPublishBar), so it can never drift from what the site actually does.
// ════════════════════════════════════════════════════════════════════════════
const POSTS_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');

function baseFilename(filename: string): string {
  return filename.startsWith('en-') ? filename.slice(3) : filename;
}

function belowBarOf(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const split = fmScores.splitFrontmatter(content);
  if (!split) return false;
  const scores = fmScores.parseScores(split.fmText);
  return isBelowPublishBar(scores);
}

describe('translation-pair publish-bar parity', () => {
  it('every zh-tw + en pair agrees on isBelowPublishBar (no language leaks onto the homepage alone)', () => {
    const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'));
    const byBase = new Map<string, string[]>();
    for (const f of files) {
      const arr = byBase.get(baseFilename(f)) ?? [];
      arr.push(f);
      byBase.set(baseFilename(f), arr);
    }

    const mismatches: string[] = [];
    for (const [, pair] of byBase) {
      if (pair.length !== 2) continue; // only complete zh+en pairs
      const en = pair.find((f) => f.startsWith('en-'));
      const zh = pair.find((f) => !f.startsWith('en-'));
      if (!en || !zh) continue; // two files but not a real cross-lang pair
      const zhBelow = belowBarOf(path.join(POSTS_DIR, zh));
      const enBelow = belowBarOf(path.join(POSTS_DIR, en));
      if (zhBelow !== enBelow) {
        mismatches.push(
          `${zh} (belowBar=${zhBelow}) vs ${en} (belowBar=${enBelow}) — mirror the scores block across both languages`
        );
      }
    }

    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
