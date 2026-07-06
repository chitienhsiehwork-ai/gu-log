/**
 * Unit tests for scripts/validate-posts.mjs
 *
 * The script is the gu-log frontmatter / kaomoji / filename gate. We import
 * its pure functions and feed in synthetic post content to pin every rule.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vModule from '../scripts/validate-posts.mjs';

// Single sandboxed tmpdir for the whole suite. CodeQL's js/path-injection
// only stays clean when destination paths are joined under a path returned
// from os.mkdtempSync — string-concat to "/tmp/..." trips it because the
// filename half is treated as a (test-controlled) tainted source.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guvp-'));
const tmpPath = (name: string) => path.join(TMP, path.basename(name));

// validate-posts.mjs is plain JS without .d.ts; widen to any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = vModule as any;
const { parseFrontmatter, getBaseFilename, getContentBody, validatePost, CJK_GRANDFATHERED_LINES } =
  v;

const KAOMOJI = '(◕‿◕)';

function makePost(fmLines: string[], body = `Body content with kaomoji ${KAOMOJI}.`): string {
  // Pad body so it clears the 200-char minimum after import/tag stripping
  const padding = '正文充足內容'.repeat(40);
  return `---\n${fmLines.join('\n')}\n---\n${padding}\n\n${body}\n`;
}

const validFm = [
  'ticketId: SP-1',
  'title: Hello',
  'originalDate: 2026-04-01',
  'translatedDate: 2026-04-02',
  'source: "@simon on X"',
  'sourceUrl: https://example.com/x',
  'summary: A short summary',
  'lang: zh-tw',
];

describe('parseFrontmatter', () => {
  it('parses flat YAML', () => {
    const fm = parseFrontmatter(makePost(validFm));
    expect(fm.ticketId).toBe('SP-1');
    expect(fm.title).toBe('Hello');
    expect(fm.lang).toBe('zh-tw');
  });

  it('parses tags array', () => {
    const fm = parseFrontmatter(makePost([...validFm, 'tags: [a, "b", c]']));
    expect(fm.tags).toEqual(['a', 'b', 'c']);
  });

  it('parses nested translatedBy.model', () => {
    const fm = parseFrontmatter(
      makePost([...validFm, 'translatedBy:', '  model: Opus 4.6', '  harness: Claude Code'])
    );
    expect(fm.translatedBy?.model).toBe('Opus 4.6');
    expect(fm.translatedBy?.harness).toBe('Claude Code');
  });

  it('returns null on missing frontmatter', () => {
    expect(parseFrontmatter('no frontmatter here')).toBeNull();
  });
});

describe('getBaseFilename', () => {
  it('strips en- prefix', () => {
    expect(getBaseFilename('en-sp-1-x.mdx')).toBe('sp-1-x.mdx');
    expect(getBaseFilename('sp-1-x.mdx')).toBe('sp-1-x.mdx');
  });
});

describe('getContentBody', () => {
  it('returns body after frontmatter block', () => {
    const body = getContentBody('---\nfoo: 1\n---\nhello');
    expect(body.trim()).toBe('hello');
  });

  it('returns empty when no frontmatter', () => {
    expect(getContentBody('no fm')).toBe('');
  });
});

describe('validatePost — pass case', () => {
  it('passes a fully-valid zh-tw post', () => {
    const filepath = tmpPath('sp-1-20260401-x.mdx');
    // translatedBy (model signature) is mandatory for every post (Rule 14.5).
    fs.writeFileSync(
      filepath,
      makePost([...validFm, 'translatedBy:', '  model: Opus 4.6', '  harness: Claude Code'])
    );
    const r = validatePost(filepath, [{ filename: 'sp-1-20260401-x.mdx', ticketId: 'SP-1' }]);
    expect(r.errors).toEqual([]);
  });
});

describe('validatePost — required-field rules', () => {
  function runWithFm(fmLines: string[], filename = 'sp-1-x.mdx') {
    const filepath = tmpPath(filename);
    fs.writeFileSync(filepath, makePost(fmLines));
    return validatePost(filepath, []);
  }

  it('flags missing title', () => {
    const r = runWithFm(validFm.filter((l) => !l.startsWith('title:')));
    expect(r.errors).toContain('Missing required field: title');
  });

  it('flags missing translatedBy (model signature)', () => {
    const r = runWithFm(validFm); // validFm has no translatedBy
    expect(r.errors).toContain(
      'Missing translatedBy (model signature) — every post needs model + harness'
    );
  });

  it('flags missing summary', () => {
    const r = runWithFm(validFm.filter((l) => !l.startsWith('summary:')));
    expect(r.errors).toContain('Missing required field: summary');
  });

  it('flags missing ticketId', () => {
    const r = runWithFm(validFm.filter((l) => !l.startsWith('ticketId:')));
    expect(r.errors).toContain('Missing ticketId');
  });

  it('flags malformed ticketId', () => {
    const r = runWithFm(validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: XX-99' : l)));
    expect(r.errors.some((e: string) => e.includes('Invalid ticketId format'))).toBe(true);
  });

  it('accepts SP/CP/SD/Lv ticketId', () => {
    for (const tid of ['SP-1', 'CP-1', 'SD-1', 'Lv-1', 'SP-PENDING']) {
      const r = runWithFm(validFm.map((l) => (l.startsWith('ticketId:') ? `ticketId: ${tid}` : l)));
      expect(r.errors.some((e: string) => e.includes('Invalid ticketId format'))).toBe(false);
    }
  });

  it('flags malformed originalDate', () => {
    const r = runWithFm(
      validFm.map((l) => (l.startsWith('originalDate:') ? 'originalDate: 2026/04/01' : l))
    );
    expect(r.errors.some((e: string) => e.includes('Invalid originalDate format'))).toBe(true);
  });

  it('flags non-http sourceUrl', () => {
    const r = runWithFm(
      validFm.map((l) => (l.startsWith('sourceUrl:') ? 'sourceUrl: ftp://x' : l))
    );
    expect(r.errors.some((e: string) => e.includes('Invalid sourceUrl'))).toBe(true);
  });

  it('flags lang/filename mismatch (en lang on non-en filename)', () => {
    const r = runWithFm(validFm.map((l) => (l.startsWith('lang:') ? 'lang: en' : l)));
    expect(r.errors.some((e: string) => e.includes("filename doesn't start with"))).toBe(true);
  });

  it('flags zh-tw lang on en- filename', () => {
    const r = runWithFm(validFm, 'en-sp-1-x.mdx');
    expect(r.errors.some((e: string) => e.includes('filename starts with "en-"'))).toBe(true);
  });
});

describe('validatePost — content rules', () => {
  it('flags missing kaomoji', () => {
    const filepath = tmpPath('no-kaomoji.mdx');
    const padding = '正文充足內容'.repeat(40);
    fs.writeFileSync(filepath, `---\n${validFm.join('\n')}\n---\n${padding}\nNo face here.\n`);
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('Missing kaomoji'))).toBe(true);
  });

  it('flags content too short', () => {
    const filepath = tmpPath('short.mdx');
    fs.writeFileSync(filepath, `---\n${validFm.join('\n')}\n---\ntiny ${KAOMOJI}\n`);
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('Content too short'))).toBe(true);
  });

  it('flags raw ```mermaid code fence', () => {
    const filepath = tmpPath('mermaid.mdx');
    const padding = '正文充足內容'.repeat(40);
    fs.writeFileSync(
      filepath,
      `---\n${validFm.join('\n')}\n---\n${padding}\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n${KAOMOJI}\n`
    );
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('mermaid'))).toBe(true);
  });

  it('flags translatedBy.model without version number', () => {
    const filepath = tmpPath('badmodel.mdx');
    const fm = [...validFm, 'translatedBy:', '  model: Opus', '  harness: Claude Code'];
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('missing version'))).toBe(true);
  });

  it('accepts whole-number Claude 5-generation release names (e.g. "Sonnet 5")', () => {
    const filepath = tmpPath('sonnet5model.mdx');
    const fm = [...validFm, 'translatedBy:', '  model: Sonnet 5', '  harness: Claude Code'];
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('missing version'))).toBe(false);
  });

  it('warns on long summary', () => {
    const filepath = tmpPath('longsummary.mdx');
    const longSummary = 'x'.repeat(310);
    const fm = validFm.map((l) => (l.startsWith('summary:') ? `summary: "${longSummary}"` : l));
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.warnings.some((w: string) => w.includes('summary'))).toBe(true);
  });

  it('warns on filename without date', () => {
    const filepath = tmpPath('no-date-in-name.mdx');
    fs.writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, []);
    expect(r.warnings.some((w: string) => w.includes('date'))).toBe(true);
  });
});

describe('validatePost — en-* CJK Unified Ideograph guard', () => {
  const enFm = validFm.map((l) =>
    l.startsWith('lang:') ? 'lang: en' : l.startsWith('ticketId:') ? 'ticketId: SP-2' : l
  );
  // makePost()'s shared padding is zh-tw text, which would itself trip this
  // en-only rule — build these fixtures with English padding instead so each
  // assertion isolates the exact behavior under test.
  const enPadding = 'Enough English filler content to clear the minimum length. '.repeat(4);
  function makeEnPost(fmLines: string[], body: string): string {
    return `---\n${fmLines.join('\n')}\n---\n${enPadding}\n\n${body}\n`;
  }

  it('flags an untranslated CJK Unified Ideograph in an en-* body', () => {
    const filepath = tmpPath('en-sp-2-x.mdx');
    fs.writeFileSync(filepath, makeEnPost(enFm, 'This has a leftover 測試字 in it.'));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(true);
  });

  it('does not flag zh-tw posts (rule is en-only)', () => {
    const filepath = tmpPath('sp-2-x.mdx');
    fs.writeFileSync(filepath, makePost(validFm, `Body content with kaomoji ${KAOMOJI} 測試字.`));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  it('does not flag katakana or Greek letters (outside the Unified Ideograph block)', () => {
    const filepath = tmpPath('en-sp-3-x.mdx');
    fs.writeFileSync(filepath, makeEnPost(enFm, 'Kaomoji like (◕ω◕) and ツ or ω are fine.'));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  it('allows an inline escape via "<!-- cjk-ok -->" on the same line', () => {
    const filepath = tmpPath('en-sp-4-x.mdx');
    fs.writeFileSync(
      filepath,
      makeEnPost(enFm, 'Quoting a name like 測試字 is fine here. <!-- cjk-ok -->')
    );
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  it('allows escaping a whole code block via the marker on the opening fence line', () => {
    const filepath = tmpPath('en-sp-5-x.mdx');
    const body = ['```typescript <!-- cjk-ok -->', 'const x = "測試字";', '```'].join('\n');
    fs.writeFileSync(filepath, makeEnPost(enFm, body));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  // CJK_GRANDFATHERED_LINES is expected to shrink to empty as legit citations
  // get escaped and bugs get retranslated (it's zero as of this writing — see
  // scripts/validate-posts.mjs's comment on the Map). These two tests inject
  // a synthetic entry via the exported Map so the downgrade-to-warning
  // mechanism itself stays covered regardless of the baseline's real size.
  const BASELINE_TEST_FILE = 'en-baseline-test-fixture.mdx';
  const BASELINE_TEST_LINE = '# 這是測試用的 baseline 豁免行。';

  it('downgrades a grandfathered baseline line to a warning instead of an error', () => {
    CJK_GRANDFATHERED_LINES.set(BASELINE_TEST_FILE, new Set([BASELINE_TEST_LINE]));
    try {
      const filepath = tmpPath(BASELINE_TEST_FILE);
      fs.writeFileSync(filepath, makeEnPost(enFm, BASELINE_TEST_LINE));
      const r = validatePost(filepath, []);
      expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
      expect(r.warnings.some((w: string) => w.includes('grandfathered'))).toBe(true);
    } finally {
      CJK_GRANDFATHERED_LINES.delete(BASELINE_TEST_FILE);
    }
  });

  it('still fails a NEW (non-baseline) CJK line in an otherwise-grandfathered file', () => {
    // The baseline exempts specific line *text*, not the whole file — a
    // different offending line in the same file must still fail.
    CJK_GRANDFATHERED_LINES.set(BASELINE_TEST_FILE, new Set([BASELINE_TEST_LINE]));
    try {
      const filepath = tmpPath(BASELINE_TEST_FILE);
      fs.writeFileSync(filepath, makeEnPost(enFm, '這是全新的違規句子，不在 baseline 裡。'));
      const r = validatePost(filepath, []);
      expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(true);
    } finally {
      CJK_GRANDFATHERED_LINES.delete(BASELINE_TEST_FILE);
    }
  });

  it('does not exempt frontmatter (only the body is scanned, not the guard bypass)', () => {
    // Frontmatter itself is out of scope for this rule (source/attribution
    // fields legitimately carry original-language names) — confirm a CJK
    // name in frontmatter alone does not trigger the body guard.
    const filepath = tmpPath('en-sp-6-x.mdx');
    const fm = [...enFm, 'source: "凡人小北 @frxiaobei"'];
    fs.writeFileSync(filepath, makeEnPost(fm, `Body content with kaomoji ${KAOMOJI}.`));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });
});

describe('validatePost — cross-file rules', () => {
  it('flags duplicate ticketId across non-paired files', () => {
    const filepath = tmpPath('sp-1-a.mdx');
    fs.writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [
      { filename: 'sp-1-a.mdx', ticketId: 'SP-1' },
      { filename: 'sp-1-b.mdx', ticketId: 'SP-1' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Duplicate ticketId'))).toBe(true);
  });

  it('does NOT flag PENDING ticketId duplicates (multiple drafts share)', () => {
    const fm = validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: SP-PENDING' : l));
    const filepath = tmpPath('pending.mdx');
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, [
      { filename: 'pending.mdx', ticketId: 'SP-PENDING' },
      { filename: 'other-pending.mdx', ticketId: 'SP-PENDING' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Duplicate ticketId'))).toBe(false);
  });

  it('flags translation-pair ticketId mismatch', () => {
    const filepath = tmpPath('sp-1-x.mdx');
    fs.writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [
      { filename: 'sp-1-x.mdx', ticketId: 'SP-1' },
      { filename: 'en-sp-1-x.mdx', ticketId: 'SP-2' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Translation pair ticketId mismatch'))).toBe(
      true
    );
  });
});
