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
  'ticketId: GP-1',
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
    expect(fm.ticketId).toBe('GP-1');
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

  // gu-log #546: LLM-authored frontmatter can contain apostrophes, embedded
  // quotes, and colons in free-text fields like `source:`. The old
  // regex-based scanner silently accepted invalid YAML that never survived
  // to the real Astro/YAML parser at build time. Since validate-posts.mjs
  // now parses with a real YAML library, these hostile-but-VALID values
  // must still parse, and genuinely invalid YAML must throw.
  // validFm already sets `source`/`originalDate` — override in place
  // rather than appending, since real YAML (unlike the old regex scanner)
  // correctly rejects duplicate keys.
  const withOverride = (key: string, line: string) => [
    ...validFm.filter((l) => !l.startsWith(`${key}:`)),
    line,
  ];

  it('parses a source label with an apostrophe when properly double-quoted', () => {
    const fm = parseFrontmatter(
      makePost(withOverride('source', 'source: "Simon Willison\'s Weblog"'))
    );
    expect(fm.source).toBe("Simon Willison's Weblog");
  });

  it('parses a source label with an embedded colon', () => {
    const fm = parseFrontmatter(
      makePost(withOverride('source', 'source: "Note: a title with a colon"'))
    );
    expect(fm.source).toBe('Note: a title with a colon');
  });

  it('parses a source label with an embedded double quote (escaped)', () => {
    const fm = parseFrontmatter(makePost(withOverride('source', 'source: "He said \\"hi\\""')));
    expect(fm.source).toBe('He said "hi"');
  });

  it('throws on genuinely invalid YAML (unterminated single-quoted scalar)', () => {
    // A single-quoted YAML scalar cannot contain a bare apostrophe — this
    // is exactly the GP-252 failure mode from gu-log #546.
    const bad = makePost(withOverride('source', "source: 'Simon Willison's Weblog'"));
    expect(() => parseFrontmatter(bad)).toThrow(/Invalid YAML/);
  });

  it('coerces an unquoted date scalar back to a plain string, not a JS Date', () => {
    // yaml.parse() natively turns unquoted YYYY-MM-DD into a JS Date;
    // downstream rules do string ops (DATE_PATTERN.test, etc.) against
    // originalDate/translatedDate, so it must come back as a string.
    const fm = parseFrontmatter(makePost(withOverride('originalDate', 'originalDate: 2026-07-17')));
    expect(typeof fm.originalDate).toBe('string');
    expect(fm.originalDate).toBe('2026-07-17');
  });
});

describe('getBaseFilename', () => {
  it('strips en- prefix', () => {
    expect(getBaseFilename('en-gp-1-x.mdx')).toBe('gp-1-x.mdx');
    expect(getBaseFilename('gp-1-x.mdx')).toBe('gp-1-x.mdx');
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
    const filepath = tmpPath('gp-1-20260401-x.mdx');
    // translatedBy (model signature) is mandatory for every post (Rule 14.5).
    fs.writeFileSync(
      filepath,
      makePost([...validFm, 'translatedBy:', '  model: Opus 4.6', '  harness: Claude Code'])
    );
    const r = validatePost(filepath, [{ filename: 'gp-1-20260401-x.mdx', ticketId: 'GP-1' }]);
    expect(r.errors).toEqual([]);
  });

  it('passes a post whose source label has an apostrophe (properly quoted)', () => {
    const filepath = tmpPath('gp-2-20260401-x.mdx');
    fs.writeFileSync(
      filepath,
      makePost([
        ...validFm.filter((l) => !l.startsWith('source:') && !l.startsWith('ticketId:')),
        'ticketId: GP-2',
        'source: "Simon Willison\'s Weblog"',
        'translatedBy:',
        '  model: Opus 4.6',
        '  harness: Claude Code',
      ])
    );
    const r = validatePost(filepath, [{ filename: 'gp-2-20260401-x.mdx', ticketId: 'GP-2' }]);
    expect(r.errors).toEqual([]);
  });
});

describe('validatePost — invalid YAML (gu-log #546)', () => {
  it('reports invalid YAML as a validation error instead of crashing', () => {
    const filepath = tmpPath('gp-3-20260401-x.mdx');
    fs.writeFileSync(
      filepath,
      makePost([
        ...validFm.filter((l) => !l.startsWith('source:')),
        // Unterminated single-quoted scalar — the exact GP-252 shape.
        "source: 'Simon Willison's Weblog'",
      ])
    );
    const r = validatePost(filepath, []);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e: string) => /Invalid YAML/.test(e))).toBe(true);
  });
});

describe('validatePost — required-field rules', () => {
  function runWithFm(fmLines: string[], filename = 'gp-1-20260401-x.mdx') {
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

  it('accepts canonical GP/MP/SD/Lv ticketId forms', () => {
    for (const [tid, filename] of [
      ['GP-1', 'gp-1-20260401-x.mdx'],
      ['MP-1', 'mp-1-20260401-x.mdx'],
      ['SD-1', 'sd-1-20260401-x.mdx'],
      ['Lv-1', 'levelup-20260401-x.mdx'],
      ['Lv-99', 'levelup-20260401-x.mdx'],
      ['Lv-01', 'levelup-20260401-x.mdx'],
      ['GP-PENDING', 'gp-pending-20260401-x.mdx'],
      ['Lv-PENDING', 'levelup-pending-20260401-x.mdx'],
    ] as const) {
      const r = runWithFm(
        validFm.map((l) => (l.startsWith('ticketId:') ? `ticketId: ${tid}` : l)),
        filename
      );
      expect(r.errors.some((e: string) => e.includes('Invalid ticketId format'))).toBe(false);
    }
  });

  it('rejects the wrong-case LV prefix', () => {
    const r = runWithFm(
      validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: LV-1' : l)),
      'levelup-20260401-x.mdx'
    );
    expect(r.errors.some((e: string) => e.includes('Invalid ticketId format'))).toBe(true);
  });

  it('rejects retired SP/CP ticketIds with an actionable canonical replacement', () => {
    const sp = runWithFm(
      validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: SP-258' : l)),
      'gp-258-20260401-x.mdx'
    );
    expect(sp.errors.some((e: string) => e.includes('use GP-258'))).toBe(true);

    const cp = runWithFm(
      validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: CP-314' : l)),
      'mp-314-20260401-x.mdx'
    );
    expect(cp.errors.some((e: string) => e.includes('use MP-314'))).toBe(true);
  });

  it('rejects retired SP/CP ticket references in frontmatter fields', () => {
    const r = runWithFm([
      ...validFm,
      'status: deprecated',
      'deprecatedBy: SP-165',
      'translatedBy:',
      '  model: Opus 4.6',
      '  harness: Claude Code',
    ]);
    expect(r.errors.some((e: string) => e.includes('use GP-165'))).toBe(true);
  });

  it('treats an empty scores block as absent, not as a partially-written v8 tribunal', () => {
    const r = runWithFm([
      ...validFm,
      'scores:',
      'translatedBy:',
      '  model: Opus 4.6',
      '  harness: Claude Code',
    ]);
    expect(r.errors.some((e: string) => e.startsWith('Missing scores.'))).toBe(false);
  });

  it('validates an unstamped legacy judge as v8 without requiring unwritten judges', () => {
    const r = runWithFm([
      ...validFm,
      'scores:',
      '  vibe:',
      '    persona: 8',
      '    moguNote: 8',
      '    vibe: 8',
      '    clarity: 8',
      '    narrative: 8',
      '    score: 8',
      '    date: "2026-04-02"',
      '    model: "Opus 4.6"',
      'translatedBy:',
      '  model: Opus 4.6',
      '  harness: Claude Code',
    ]);
    expect(r.errors.some((e: string) => e.startsWith('Missing scores.'))).toBe(false);
    expect(r.errors.some((e: string) => e.includes('scores.vibe'))).toBe(false);
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
    const r = runWithFm(validFm, 'en-gp-1-x.mdx');
    expect(r.errors.some((e: string) => e.includes('filename starts with "en-"'))).toBe(true);
  });
});

describe('validatePost — content rules', () => {
  it('flags missing kaomoji', () => {
    const filepath = tmpPath('gp-1-20260401-nokao.mdx');
    const padding = '正文充足內容'.repeat(40);
    fs.writeFileSync(filepath, `---\n${validFm.join('\n')}\n---\n${padding}\nNo face here.\n`);
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('Missing kaomoji'))).toBe(true);
  });

  it('flags content too short', () => {
    const filepath = tmpPath('gp-1-20260401-short.mdx');
    fs.writeFileSync(filepath, `---\n${validFm.join('\n')}\n---\ntiny ${KAOMOJI}\n`);
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('Content too short'))).toBe(true);
  });

  it('flags raw ```mermaid code fence', () => {
    const filepath = tmpPath('gp-1-20260401-mermaid.mdx');
    const padding = '正文充足內容'.repeat(40);
    fs.writeFileSync(
      filepath,
      `---\n${validFm.join('\n')}\n---\n${padding}\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n${KAOMOJI}\n`
    );
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('mermaid'))).toBe(true);
  });

  it('flags translatedBy.model without version number', () => {
    const filepath = tmpPath('gp-1-20260401-badmodel.mdx');
    const fm = [...validFm, 'translatedBy:', '  model: Opus', '  harness: Claude Code'];
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('missing version'))).toBe(true);
  });

  it('accepts whole-number Claude 5-generation release names (e.g. "Sonnet 5")', () => {
    const filepath = tmpPath('gp-1-20260401-sonnet5.mdx');
    const fm = [...validFm, 'translatedBy:', '  model: Sonnet 5', '  harness: Claude Code'];
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('missing version'))).toBe(false);
  });

  it('warns on long summary', () => {
    const filepath = tmpPath('gp-1-20260401-longsummary.mdx');
    const longSummary = 'x'.repeat(310);
    const fm = validFm.map((l) => (l.startsWith('summary:') ? `summary: "${longSummary}"` : l));
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.warnings.some((w: string) => w.includes('summary'))).toBe(true);
  });

  it('warns on filename without date', () => {
    const filepath = tmpPath('gp-1-nodate.mdx');
    fs.writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, []);
    expect(r.warnings.some((w: string) => w.includes('date'))).toBe(true);
  });
});

describe('validatePost — en-* CJK Unified Ideograph guard', () => {
  const enFm = validFm.map((l) =>
    l.startsWith('lang:') ? 'lang: en' : l.startsWith('ticketId:') ? 'ticketId: GP-2' : l
  );
  // makePost()'s shared padding is zh-tw text, which would itself trip this
  // en-only rule — build these fixtures with English padding instead so each
  // assertion isolates the exact behavior under test.
  const enPadding = 'Enough English filler content to clear the minimum length. '.repeat(4);
  function makeEnPost(fmLines: string[], body: string): string {
    return `---\n${fmLines.join('\n')}\n---\n${enPadding}\n\n${body}\n`;
  }

  it('flags an untranslated CJK Unified Ideograph in an en-* body', () => {
    const filepath = tmpPath('en-gp-2-x.mdx');
    fs.writeFileSync(filepath, makeEnPost(enFm, 'This has a leftover 測試字 in it.'));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(true);
  });

  it('does not flag zh-tw posts (rule is en-only)', () => {
    const filepath = tmpPath('gp-1-20260401-zhtw.mdx');
    fs.writeFileSync(filepath, makePost(validFm, `Body content with kaomoji ${KAOMOJI} 測試字.`));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  it('does not flag katakana or Greek letters (outside the Unified Ideograph block)', () => {
    const filepath = tmpPath('en-gp-3-x.mdx');
    fs.writeFileSync(filepath, makeEnPost(enFm, 'Kaomoji like (◕ω◕) and ツ or ω are fine.'));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  it('allows an inline escape via "<!-- cjk-ok -->" on the same line', () => {
    const filepath = tmpPath('en-gp-4-x.mdx');
    fs.writeFileSync(
      filepath,
      makeEnPost(enFm, 'Quoting a name like 測試字 is fine here. <!-- cjk-ok -->')
    );
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });

  it('allows escaping a whole code block via the marker on the opening fence line', () => {
    const filepath = tmpPath('en-gp-5-x.mdx');
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
  const BASELINE_TEST_FILE = 'en-gp-2-baseline.mdx';
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
    const filepath = tmpPath('en-gp-6-x.mdx');
    const fm = [...enFm, 'source: "凡人小北 @frxiaobei"'];
    fs.writeFileSync(filepath, makeEnPost(fm, `Body content with kaomoji ${KAOMOJI}.`));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('CJK Unified Ideograph'))).toBe(false);
  });
});

describe('validatePost — canonical filename gate (GP/MP)', () => {
  function runNamed(filename: string, ticketId: string) {
    const filepath = tmpPath(filename);
    const fm = validFm.map((line) => {
      if (line.startsWith('ticketId:')) return `ticketId: ${ticketId}`;
      if (line.startsWith('lang:') && filename.startsWith('en-')) return 'lang: en';
      return line;
    });
    fs.writeFileSync(filepath, makePost(fm));
    return validatePost(filepath, []);
  }

  it('accepts canonical gp-N / mp-N / pending filenames', () => {
    for (const [filename, tid] of [
      ['gp-258-20260401-x.mdx', 'GP-258'],
      ['en-gp-258-20260401-x.mdx', 'GP-258'],
      ['mp-314-20260401-x.mdx', 'MP-314'],
      ['gp-pending-20260401-x.mdx', 'GP-PENDING'],
      ['mp-pending-20260401-x.mdx', 'MP-PENDING'],
    ] as const) {
      const r = runNamed(filename, tid);
      expect(
        r.errors.some((e: string) => e.includes('filename')),
        `${filename} should carry no filename error, got: ${r.errors.join('; ')}`
      ).toBe(false);
    }
  });

  it('rejects a GP ticket living in a legacy sp-* filename', () => {
    const r = runNamed('sp-258-20260401-x.mdx', 'GP-258');
    expect(r.errors.some((e: string) => e.includes('gp-258-'))).toBe(true);
  });

  it('rejects a GP/MP filename whose number disagrees with the ticketId', () => {
    const r = runNamed('gp-259-20260401-x.mdx', 'GP-258');
    expect(r.errors.some((e: string) => e.includes('gp-258-'))).toBe(true);
  });
});

describe('validatePost — retired series tags', () => {
  it.each(['clawd-picks', 'mogu-picks', 'shroom-picks', 'shroomdog-picks', 'gu-log-picks'])(
    'rejects retired content-type tag %s (series identity comes from ticketId)',
    (tag) => {
      const filepath = tmpPath('gp-1-20260401-x.mdx');
      fs.writeFileSync(filepath, makePost([...validFm, `tags: ["${tag}", "agent"]`]));
      const r = validatePost(filepath, []);
      expect(r.errors.some((e: string) => e.includes(tag))).toBe(true);
    }
  );

  it('accepts ordinary topic tags', () => {
    const filepath = tmpPath('gp-1-20260401-x.mdx');
    fs.writeFileSync(filepath, makePost([...validFm, 'tags: ["agent", "claude-code"]']));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('tag'))).toBe(false);
  });
});

describe('validatePost — retired clawdNote/ClawdNote contract', () => {
  it('rejects a clawdNote score key in frontmatter with a moguNote diagnostic', () => {
    const filepath = tmpPath('gp-1-20260401-x.mdx');
    const fm = [
      ...validFm,
      'scores:',
      '  vibe:',
      '    persona: 8',
      '    clawdNote: 8',
      '    vibe: 8',
      '    narrative: 8',
      '    score: 8',
      '    date: "2026-07-01"',
      '    model: "gpt-5.5"',
    ];
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('moguNote'))).toBe(true);
  });

  it('rejects a ClawdNote component in the body with a MoguNote diagnostic', () => {
    const filepath = tmpPath('gp-1-20260401-x.mdx');
    fs.writeFileSync(filepath, makePost(validFm, `<ClawdNote>還在用舊元件</ClawdNote> ${KAOMOJI}`));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('MoguNote'))).toBe(true);
  });
});

describe('validatePost — cross-file rules', () => {
  it('flags duplicate ticketId across non-paired files', () => {
    const filepath = tmpPath('gp-1-a.mdx');
    fs.writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [
      { filename: 'gp-1-a.mdx', ticketId: 'GP-1' },
      { filename: 'gp-1-b.mdx', ticketId: 'GP-1' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Duplicate ticketId'))).toBe(true);
  });

  it('does NOT flag PENDING ticketId duplicates (multiple drafts share)', () => {
    const fm = validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: GP-PENDING' : l));
    const filepath = tmpPath('gp-pending-20260401-a.mdx');
    fs.writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, [
      { filename: 'gp-pending-20260401-a.mdx', ticketId: 'GP-PENDING' },
      { filename: 'gp-pending-20260401-b.mdx', ticketId: 'GP-PENDING' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Duplicate ticketId'))).toBe(false);
  });

  it('flags translation-pair ticketId mismatch', () => {
    const filepath = tmpPath('gp-1-x.mdx');
    fs.writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [
      { filename: 'gp-1-x.mdx', ticketId: 'GP-1' },
      { filename: 'en-gp-1-x.mdx', ticketId: 'GP-2' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Translation pair ticketId mismatch'))).toBe(
      true
    );
  });
});
