import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkerModule from '../scripts/check-glossary-links.mjs';
import * as fixerModule from '../scripts/apply-glossary-links.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const checker = checkerModule as any;
const fixer = fixerModule as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gugl-'));
const tmpPath = (name: string) => path.join(TMP, path.basename(name));
const CHECKER_CLI = fileURLToPath(new URL('../scripts/check-glossary-links.mjs', import.meta.url));

const glossary = [
  {
    term: 'Elixir',
    linking: { enabled: true, anchor: 'elixir', match: ['Elixir'], caseSensitive: true },
  },
  {
    term: 'Codex app server',
    linking: {
      enabled: true,
      anchor: 'codex-app-server',
      match: ['Codex app server'],
      caseSensitive: true,
    },
  },
  {
    term: 'Codex',
    linking: { enabled: true, anchor: 'codex', match: ['Codex'], caseSensitive: true },
  },
  {
    term: 'Power Potion',
    aliases: ['Power Elixir'],
    linking: {
      enabled: true,
      anchor: 'power-potion',
      match: ['Power Potion'],
      caseSensitive: true,
    },
  },
];

describe('glossary link checker', () => {
  it('accepts a valid changed-posts Git base', () => {
    const result = spawnSync(
      process.execPath,
      [CHECKER_CLI, '--changed-posts=HEAD', '--format', 'json'],
      { encoding: 'utf8' }
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, violations: [] });
  });

  it('fails closed when the changed-posts Git base cannot be resolved', () => {
    const missingBase = '--src-prefix=bogus';
    const result = spawnSync(
      process.execPath,
      [CHECKER_CLI, `--changed-posts=${missingBase}`, '--format', 'json'],
      { encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('"ok": true');
    expect(result.stderr).toContain('Could not enumerate changed posts from Git base');
    expect(result.stderr).toContain(missingBase);
  });

  it('reports an unlinked safe body occurrence', () => {
    const file = tmpPath('missing.mdx');
    fs.writeFileSync(
      file,
      '---\nlang: zh-tw\nsummary: "Elixir here is metadata"\n---\n正文提到 Elixir 實作。\n'
    );

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      term: 'Elixir',
      expectedHref: '/glossary#elixir',
    });
  });

  it('counts one correct link as article-level coverage for repeated terms', () => {
    const file = tmpPath('covered.mdx');
    fs.writeFileSync(
      file,
      '---\nlang: zh-tw\n---\n[Elixir](/glossary#elixir) 先介紹。後面 Elixir 裸字可以保留。\n'
    );

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([]);
  });

  it('uses English glossary path for English posts', () => {
    const file = tmpPath('en-post.mdx');
    fs.writeFileSync(file, '---\nlang: en\n---\nElixir is used here.\n');

    const result = checker.checkFile(file, { glossary });

    expect(result.violations[0].expectedHref).toBe('/en/glossary#elixir');
  });

  it('ignores frontmatter, code, inline code, existing links, raw URLs, HTML attrs, blockquotes, and MDX component blocks', () => {
    const file = tmpPath('ignored.mdx');
    fs.writeFileSync(
      file,
      [
        '---',
        'lang: zh-tw',
        'summary: "Elixir in metadata"',
        '---',
        '```',
        'Elixir in code',
        '```',
        '`Elixir inline`',
        '[Elixir docs](https://elixir-lang.org)',
        'https://example.com/Elixir',
        '<Thing label="Elixir" />',
        '<Mermaid caption="x" chart={`graph TB',
        '  A["Elixir in diagram"]',
        '`} />',
        '> Elixir in quote',
        '',
      ].join('\n')
    );

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([]);
  });

  it('does not use aliases as automatic matchers', () => {
    const file = tmpPath('alias.mdx');
    fs.writeFileSync(file, '---\nlang: zh-tw\n---\nPower Elixir 是另一個語境。\n');

    const result = checker.checkFile(file, { glossary });

    expect(result.violations.map((v: { term: string }) => v.term)).not.toContain('Power Potion');
  });

  it('prefers longer match strings at the same location', () => {
    const file = tmpPath('longer.mdx');
    fs.writeFileSync(file, '---\nlang: en\n---\nCodex app server is not just Codex.\n');

    const result = checker.checkFile(file, { glossary });

    expect(result.violations[0].term).toBe('Codex app server');
  });

  it('supports frontmatter glossaryIgnore', () => {
    const file = tmpPath('ignore.mdx');
    fs.writeFileSync(
      file,
      '---\nlang: zh-tw\nglossaryIgnore:\n  - Elixir\n---\n正文提到 Elixir 但刻意不連。\n'
    );

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([]);
  });
});

describe('glossary link fixer', () => {
  it('links only the first safe occurrence and is idempotent', () => {
    const input = '---\nlang: zh-tw\n---\n正文提到 Elixir。後面 Elixir 裸字保留。\n';

    const first = fixer.applyLinksToContent(input, {
      glossary,
      terms: ['Elixir'],
      filePath: 'post.mdx',
    });
    const second = fixer.applyLinksToContent(first.content, {
      glossary,
      terms: ['Elixir'],
      filePath: 'post.mdx',
    });

    expect(first.content).toContain('[Elixir](/glossary#elixir)');
    expect((first.content.match(/\/glossary#elixir/g) ?? []).length).toBe(1);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it('does not modify frontmatter, blockquotes, code, or existing links', () => {
    const input = [
      '---',
      'lang: zh-tw',
      'summary: "Elixir"',
      '---',
      '> Elixir quote',
      '`Elixir inline`',
      '[Elixir docs](https://elixir-lang.org)',
      '正文 Elixir safe。',
      '',
    ].join('\n');

    const result = fixer.applyLinksToContent(input, {
      glossary,
      terms: ['Elixir'],
      filePath: 'post.mdx',
    });

    expect(result.content).toContain('summary: "Elixir"');
    expect(result.content).toContain('> Elixir quote');
    expect(result.content).toContain('`Elixir inline`');
    expect(result.content).toContain('[Elixir docs](https://elixir-lang.org)');
    expect(result.content).toContain('正文 [Elixir](/glossary#elixir) safe。');
  });
});
