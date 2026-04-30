/**
 * Unit tests for scripts/validate-posts.mjs
 *
 * The script is the gu-log frontmatter / kaomoji / filename gate. We import
 * its pure functions and feed in synthetic post content to pin every rule.
 */
import { describe, it, expect } from 'vitest';
import * as vModule from '../scripts/validate-posts.mjs';

// validate-posts.mjs is plain JS without .d.ts; widen to any.
const v = vModule as any;
const { parseFrontmatter, getBaseFilename, getContentBody, validatePost } = v;

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
    const filepath = '/tmp/sp-1-20260401-x.mdx';
    require('fs').writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [{ filename: 'sp-1-20260401-x.mdx', ticketId: 'SP-1' }]);
    expect(r.errors).toEqual([]);
  });
});

describe('validatePost — required-field rules', () => {
  function runWithFm(fmLines: string[], filename = 'sp-1-x.mdx') {
    const filepath = `/tmp/${filename}`;
    require('fs').writeFileSync(filepath, makePost(fmLines));
    return validatePost(filepath, []);
  }

  it('flags missing title', () => {
    const r = runWithFm(validFm.filter((l) => !l.startsWith('title:')));
    expect(r.errors).toContain('Missing required field: title');
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
    const filepath = '/tmp/no-kaomoji.mdx';
    const padding = '正文充足內容'.repeat(40);
    require('fs').writeFileSync(filepath, `---\n${validFm.join('\n')}\n---\n${padding}\nNo face here.\n`);
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('Missing kaomoji'))).toBe(true);
  });

  it('flags content too short', () => {
    const filepath = '/tmp/short.mdx';
    require('fs').writeFileSync(filepath, `---\n${validFm.join('\n')}\n---\ntiny ${KAOMOJI}\n`);
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('Content too short'))).toBe(true);
  });

  it('flags raw ```mermaid code fence', () => {
    const filepath = '/tmp/mermaid.mdx';
    const padding = '正文充足內容'.repeat(40);
    require('fs').writeFileSync(
      filepath,
      `---\n${validFm.join('\n')}\n---\n${padding}\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n${KAOMOJI}\n`
    );
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('mermaid'))).toBe(true);
  });

  it('flags translatedBy.model without version number', () => {
    const filepath = '/tmp/badmodel.mdx';
    const fm = [...validFm, 'translatedBy:', '  model: Opus', '  harness: Claude Code'];
    require('fs').writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.errors.some((e: string) => e.includes('missing version'))).toBe(true);
  });

  it('warns on long summary', () => {
    const filepath = '/tmp/longsummary.mdx';
    const longSummary = 'x'.repeat(310);
    const fm = validFm.map((l) => (l.startsWith('summary:') ? `summary: "${longSummary}"` : l));
    require('fs').writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, []);
    expect(r.warnings.some((w: string) => w.includes('summary'))).toBe(true);
  });

  it('warns on filename without date', () => {
    const filepath = '/tmp/no-date-in-name.mdx';
    require('fs').writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, []);
    expect(r.warnings.some((w: string) => w.includes('date'))).toBe(true);
  });
});

describe('validatePost — cross-file rules', () => {
  it('flags duplicate ticketId across non-paired files', () => {
    const filepath = '/tmp/sp-1-a.mdx';
    require('fs').writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [
      { filename: 'sp-1-a.mdx', ticketId: 'SP-1' },
      { filename: 'sp-1-b.mdx', ticketId: 'SP-1' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Duplicate ticketId'))).toBe(true);
  });

  it('does NOT flag PENDING ticketId duplicates (multiple drafts share)', () => {
    const fm = validFm.map((l) => (l.startsWith('ticketId:') ? 'ticketId: SP-PENDING' : l));
    const filepath = '/tmp/pending.mdx';
    require('fs').writeFileSync(filepath, makePost(fm));
    const r = validatePost(filepath, [
      { filename: 'pending.mdx', ticketId: 'SP-PENDING' },
      { filename: 'other-pending.mdx', ticketId: 'SP-PENDING' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Duplicate ticketId'))).toBe(false);
  });

  it('flags translation-pair ticketId mismatch', () => {
    const filepath = '/tmp/sp-1-x.mdx';
    require('fs').writeFileSync(filepath, makePost(validFm));
    const r = validatePost(filepath, [
      { filename: 'sp-1-x.mdx', ticketId: 'SP-1' },
      { filename: 'en-sp-1-x.mdx', ticketId: 'SP-2' },
    ]);
    expect(r.errors.some((e: string) => e.includes('Translation pair ticketId mismatch'))).toBe(true);
  });
});
