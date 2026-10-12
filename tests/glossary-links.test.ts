import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkerModule from '../scripts/check-glossary-links.mjs';
import * as fixerModule from '../scripts/apply-glossary-links.mjs';
import * as anchorModule from '../src/lib/glossary-anchor.mjs';
import realGlossary from '../src/data/glossary.json';
import { useTestTempDirectories } from './helpers/temp-directories';

/* eslint-disable @typescript-eslint/no-explicit-any */
const checker = checkerModule as any;
const fixer = fixerModule as any;
const anchors = anchorModule as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
const TMP = makeTempDirectory('gugl-');
const tmpPath = (name: string) => path.join(TMP, path.basename(name));
const CHECKER_CLI = fileURLToPath(new URL('../scripts/check-glossary-links.mjs', import.meta.url));

const glossary = [
  {
    term: 'Agent',
    forbiddenZhTw: ['代理人'],
    linking: { enabled: true, anchor: 'agent', match: ['Agent'], caseSensitive: true },
  },
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

describe('glossary anchor rule', () => {
  it('gives a punctuated term the same anchor on the page, in the checker and in the fixer', () => {
    const entry = realGlossary.find((item) => item.term === 'Software 3.0');
    const pageId = anchors.glossaryAnchor(entry);
    const checkerAnchor = checker
      .normalizeGlossary(realGlossary)
      .find((term: { term: string }) => term.term === 'Software 3.0').anchor;
    const post = '---\nlang: zh-tw\n---\nSoftware 3.0 改變了寫程式的方式。\n';
    const expected = checker.checkContent(post, {
      glossary: realGlossary,
      terms: ['Software 3.0'],
    }).violations[0].expectedHref;
    const fixed = fixer.applyLinksToContent(post, {
      glossary: realGlossary,
      terms: ['Software 3.0'],
      filePath: 'post.mdx',
    });

    expect(pageId).toBe('software-30');
    expect(checkerAnchor).toBe(pageId);
    expect(expected).toBe(`/glossary#${pageId}`);
    expect(fixed.content).toContain(`[Software 3.0](/glossary#${pageId})`);
  });

  it('prefers linking.anchor over the derived slug', () => {
    expect(anchors.glossaryAnchor({ term: 'GPT-5.6 系列', linking: { anchor: 'gpt-5-6' } })).toBe(
      'gpt-5-6'
    );
    expect(
      anchors.relatedGlossaryAnchor(
        [{ term: 'GPT-5.6 系列', linking: { anchor: 'gpt-5-6' } }],
        'GPT-5.6 系列'
      )
    ).toBe('gpt-5-6');
  });

  it('names a pure-Chinese term that has no linking.anchor', () => {
    const problems = anchors.findGlossaryAnchorProblems([
      { term: 'Kubernetes' },
      { term: '容器編排' },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^容器編排: /);
    expect(problems[0]).toContain('linking.anchor');
  });

  it('names the entry whose anchor collides with an earlier one', () => {
    const problems = anchors.findGlossaryAnchorProblems([
      { term: 'Software 3.0' },
      { term: 'Software 30' },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Software 30: /);
    expect(problems[0]).toContain('#software-30');
    expect(problems[0]).toContain('Software 3.0');
  });

  it('keeps every current glossary anchor non-empty and unique', () => {
    expect(anchors.findGlossaryAnchorProblems(realGlossary)).toEqual([]);
  });
});

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

  // openspec〈只改連結的證明 SHALL 確認文章解析出來的結構沒有其他變化〉：檢查器不要求在不能放
  // 連結的位置加連結，第一處不能放就改看下一處。
  it.each([
    ['inside a ~~~ code block', '~~~\nElixir in code\n~~~'],
    ['inside a code block wrapped in a longer fence', '````md\n```\nElixir\n```\n````'],
    ['inside inline code that wraps onto the next line', '用 `mix 跑\nElixir` 專案'],
    ['inside an MDX expression', '看 {"Elixir"} 這段'],
    ['inside a tag whose attributes span lines', '<div\n  title="Elixir"\n>\n內容\n</div>'],
    ['inside the text of a link that wraps', '[看看\nElixir 文件](https://example.com)'],
    ['on a term glued to bold', '這是**Elixir**的核心'],
    ['on a term right after a backslash', '路徑是 C:\\Elixir 底下'],
  ])('does not ask for a link %s', (_name, body) => {
    const content = `---\nlang: zh-tw\n---\n${body}\n`;

    expect(checker.checkContent(content, { filePath: 'post.mdx', glossary }).violations).toEqual(
      []
    );
  });

  it('asks for the next occurrence when the first one cannot take a link', () => {
    const content = '---\nlang: zh-tw\n---\n這是**Elixir**的核心。\n後面 Elixir 再出現。\n';

    expect(checker.checkContent(content, { filePath: 'post.mdx', glossary }).violations).toEqual([
      expect.objectContaining({ kind: 'missing-link', term: 'Elixir', line: 5 }),
    ]);
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

  it('reports every forbidden term in body prose and blockquotes', () => {
    const file = tmpPath('forbidden-body.mdx');
    fs.writeFileSync(
      file,
      '---\nlang: zh-tw\n---\n第一個代理人。\n> 引文裡的代理人也看得到。\n最後一個代理人。\n'
    );

    const result = checker.checkFile(file, { glossary });
    const canonical = result.violations.filter(
      (violation: { kind: string }) => violation.kind === 'canonical-term'
    );

    expect(canonical).toHaveLength(3);
    expect(canonical[0]).toMatchObject({
      forbidden: '代理人',
      canonicalTerm: 'Agent',
      expectedHref: '/glossary#agent',
      line: 4,
    });
    expect(canonical.map((violation: { line: number }) => violation.line)).toEqual([4, 5, 6]);
  });

  it.each([
    ['title', 'title: "代理人標題"'],
    ['summary', 'summary: 代理人摘要'],
    ['inline tags', 'tags: [AI, 代理人]'],
    ['block-list tags', 'tags:\n  - AI\n  - 代理人'],
  ])('checks reader-visible %s frontmatter', (_label, field) => {
    const file = tmpPath(`frontmatter-${String(_label).replaceAll(' ', '-')}.mdx`);
    fs.writeFileSync(file, `---\nlang: zh-tw\n${field}\n---\n安全正文。\n`);

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'canonical-term',
        forbidden: '代理人',
        canonicalTerm: 'Agent',
      }),
    ]);
  });

  it('ignores forbidden terms in non-prose syntax while still checking visible component children', () => {
    const file = tmpPath('forbidden-unsafe.mdx');
    fs.writeFileSync(
      file,
      [
        '---',
        'lang: zh-tw',
        'internalKey: 代理人',
        '---',
        '```txt',
        '代理人 in code',
        '```',
        '`代理人 inline`',
        '[安全標籤](https://example.com/代理人)',
        'https://example.com/代理人',
        'import 代理人 from "./fixture";',
        'export const 代理人 = true;',
        '<Thing label="代理人" />',
        '<Thing label="safe">元件子元素的代理人</Thing>',
        '{"會顯示的代理人"}',
        '{`模板顯示的代理人 } 仍顯示`}',
        '{({ label: "代理人", value: 1 })}',
        '{/* 代理人 */}',
        '     const 五格代理人 = true',
        '        const 八格代理人 = true',
        '',
      ].join('\n')
    );

    const result = checker.checkFile(file, { glossary });
    const canonical = result.violations.filter(
      (violation: { kind: string }) => violation.kind === 'canonical-term'
    );

    expect(canonical).toEqual([
      expect.objectContaining({ text: '代理人', line: 14, canonicalTerm: 'Agent' }),
      expect.objectContaining({ text: '代理人', line: 15, canonicalTerm: 'Agent' }),
      expect.objectContaining({ text: '代理人', line: 16, canonicalTerm: 'Agent' }),
      expect.objectContaining({ text: '代理人', line: 19, canonicalTerm: 'Agent' }),
      expect.objectContaining({ text: '代理人', line: 20, canonicalTerm: 'Agent' }),
    ]);
  });

  it('checks folded reader-visible frontmatter scalars', () => {
    const file = tmpPath('forbidden-block-scalar.mdx');
    fs.writeFileSync(file, '---\nlang: zh-tw\nsummary: >\n  代理人摘要\n---\n正文安全\n');

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'canonical-term', text: '代理人', line: 4 }),
    ]);
  });

  it('checks block scalars with explicit indentation and chomping indicators', () => {
    const file = tmpPath('forbidden-block-scalar-indicators.mdx');
    fs.writeFileSync(
      file,
      '---\nlang: zh-tw\nsummary: |2-\n  代理人摘要\ntitle: >2+\n  代理人標題\n---\n正文安全\n'
    );

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'canonical-term', text: '代理人', line: 4 }),
      expect.objectContaining({ kind: 'canonical-term', text: '代理人', line: 6 }),
    ]);
  });

  it('checks multiline quoted reader-visible frontmatter scalars', () => {
    const file = tmpPath('forbidden-multiline-quoted-scalar.mdx');
    fs.writeFileSync(file, '---\nlang: zh-tw\nsummary: "安全前綴\n  代理人摘要"\n---\n正文安全\n');

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'canonical-term', text: '代理人', line: 4 }),
    ]);
  });

  it('does not apply zh-tw forbidden terms to English posts', () => {
    const file = tmpPath('en-forbidden.mdx');
    fs.writeFileSync(file, '---\nlang: en\ntitle: 代理人\n---\n代理人\n');

    const result = checker.checkFile(file, { glossary });

    expect(
      result.violations.filter((violation: { kind: string }) => violation.kind === 'canonical-term')
    ).toEqual([]);
  });

  it('does not let glossaryIgnore bypass canonical terminology', () => {
    const file = tmpPath('forbidden-ignore.mdx');
    fs.writeFileSync(
      file,
      '---\nlang: zh-tw\nglossaryIgnore:\n  - Agent\n---\n<!-- glossary-ignore Agent -->\n代理人\n'
    );

    const result = checker.checkFile(file, { glossary });

    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'canonical-term', canonicalTerm: 'Agent' }),
    ]);
  });

  it('treats forbiddenZhTw changes as changed glossary terms', () => {
    const before = [{ term: 'Agent', linking: { enabled: true } }];
    const after = [{ term: 'Agent', forbiddenZhTw: ['代理人'], linking: { enabled: true } }];

    expect(checker.changedGlossaryTermsFromEntries(before, after)).toEqual(['Agent']);
  });

  it('CLI exits non-zero and renders canonical terminology diagnostics', () => {
    const file = tmpPath('forbidden-cli.mdx');
    fs.writeFileSync(file, '---\nlang: zh-tw\n---\n代理人\n');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const status = checker.runCLI(['--format', 'json', '--files', file], {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    });

    expect(status).toBe(1);
    expect(stderr).toEqual([]);
    const report = JSON.parse(stdout.join('\n'));
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({
        kind: 'canonical-term',
        forbidden: '代理人',
        canonicalTerm: 'Agent',
        expectedHref: '/glossary#agent',
      })
    );
  });
});

describe('glossary link targets', () => {
  // openspec glossary-link-coverage〈Glossary 連結 SHALL 指向存在的錨點與文章的語言〉
  const targets = [
    { term: 'Agent', category: 'concepts', related: ['Thread'] },
    { term: 'Thread', category: 'concepts', linking: { anchor: 'thread', enabled: false } },
  ];
  const zhPost = (body: string, frontmatter = 'lang: zh-tw') =>
    `---\n${frontmatter}\n---\n${body}\n`;
  const enPost = (body: string) => zhPost(body, 'lang: en');

  it('reports an anchor no entry has, including a case mismatch', () => {
    const { violations } = checker.checkLinkTargets(
      zhPost('[Opus](/glossary#Opus) 負責想。\n[agentic coding](/glossary#Agent) 的世界'),
      { filePath: 'mp-212.mdx', glossary: targets }
    );

    expect(violations).toEqual([
      expect.objectContaining({ kind: 'dead-anchor', line: 4, href: '/glossary#Opus' }),
      expect.objectContaining({ kind: 'dead-anchor', line: 5, href: '/glossary#Agent' }),
    ]);
  });

  it('reports a link to the glossary in the other language', () => {
    expect(
      checker.checkLinkTargets(enPost('One [Agent](/glossary#agent) is not enough.'), {
        filePath: 'en-mp-245.mdx',
        glossary: targets,
      }).violations
    ).toEqual([
      expect.objectContaining({
        kind: 'wrong-language',
        href: '/glossary#agent',
        expectedHref: '/en/glossary#agent',
      }),
    ]);
    expect(
      checker.checkLinkTargets(zhPost('[Agent](/en/glossary#agent) 一個不夠。'), {
        filePath: 'mp-245.mdx',
        glossary: targets,
      }).violations
    ).toEqual([
      expect.objectContaining({ kind: 'wrong-language', expectedHref: '/glossary#agent' }),
    ]);
  });

  it('does not treat a link to an entry with automatic linking disabled as dead', () => {
    expect(
      checker.checkLinkTargets(zhPost('[Thread](/glossary#thread) 一直開著。'), {
        filePath: 'mp-1.mdx',
        glossary: targets,
      }).violations
    ).toEqual([]);
  });

  it('ignores link syntax inside frontmatter and code', () => {
    const content = zhPost(
      '範例：`[Opus](/glossary#Opus)`\n```md\n[Opus](/glossary#Opus)\n```',
      'lang: zh-tw\nsummary: "[Opus](/glossary#Opus)"'
    );

    expect(
      checker.checkLinkTargets(content, { filePath: 'mp-1.mdx', glossary: targets }).violations
    ).toEqual([]);
  });

  it('names the entry and the related name that does not exist', () => {
    expect(
      checker.findMissingRelated([...targets, { term: 'MCP', related: ['Agent', 'Tool Use'] }])
    ).toEqual([
      expect.objectContaining({ kind: 'missing-related', term: 'MCP', missing: 'Tool Use' }),
    ]);
  });

  it('CLI exits non-zero and lists file and anchor, or entry and missing name', () => {
    const root = makeTempDirectory('gugl-targets-');
    const postsDirectory = path.join(root, 'src', 'content', 'posts');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    fs.mkdirSync(postsDirectory, { recursive: true });
    fs.copyFileSync(CHECKER_CLI, path.join(root, 'scripts', 'check-glossary-links.mjs'));
    fs.copyFileSync(
      fileURLToPath(new URL('../src/lib/glossary-anchor.mjs', import.meta.url)),
      path.join(root, 'src', 'lib', 'glossary-anchor.mjs')
    );
    fs.symlinkSync(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      path.join(root, 'node_modules')
    );
    const writeGlossary = (entries: object[]) =>
      fs.writeFileSync(path.join(root, 'src', 'data', 'glossary.json'), JSON.stringify(entries));
    const writePost = (name: string, content: string) =>
      fs.writeFileSync(path.join(postsDirectory, name), content);
    const run = () =>
      spawnSync(
        process.execPath,
        [path.join(root, 'scripts', 'check-glossary-links.mjs'), '--all'],
        {
          encoding: 'utf8',
        }
      );

    writeGlossary([...targets, { term: 'MCP', category: 'concepts', related: ['Tool Use'] }]);
    writePost('mp-1-dead.mdx', zhPost('[Agent](/glossary#agent) 與 [Opus](/glossary#Opus)。'));
    writePost('en-mp-1-dead.mdx', enPost('One [Agent](/glossary#agent) is not enough.'));
    writePost('mp-2-thread.mdx', zhPost('[Thread](/glossary#thread) 一直開著。'));
    const failing = run();

    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain('src/content/posts/mp-1-dead.mdx:4 /glossary#Opus');
    expect(failing.stderr).toContain(
      'src/content/posts/en-mp-1-dead.mdx:4 /glossary#agent → /en/glossary#agent'
    );
    expect(failing.stderr).toContain('src/data/glossary.json: MCP lists related "Tool Use"');
    expect(failing.stderr).not.toContain('#thread');

    writeGlossary([...targets, { term: 'MCP', category: 'concepts', related: ['Agent'] }]);
    writePost('mp-1-dead.mdx', zhPost('[Agent](/glossary#agent) 與 Opus。'));
    writePost('en-mp-1-dead.mdx', enPost('One [Agent](/en/glossary#agent) is not enough.'));
    const passing = run();

    expect(passing.status, passing.stderr).toBe(0);
  });
});

describe('canonical terminology migration proof', () => {
  it('accepts forbidden-term replacement plus glossary link wrapping', () => {
    const before = '---\nsummary: 讓代理人做事\n---\nAI 代理人會工作。\n';
    const after = '---\nsummary: 讓 Agent 做事\n---\nAI [Agent](/glossary#agent) 會工作。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(true);
  });

  it('accepts collapsing a redundant English-plus-forbidden parenthetical', () => {
    const before = '把 agency 交給 agent（代理人）。\n';
    const after = '把 agency 交給 [Agent](/glossary#agent)。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(true);
  });

  it('rejects any adjacent prose rewrite', () => {
    const before = '代理人會工作。下一句保持原樣。\n';
    const after = 'Agent 會把整間公司一次救起來。下一句保持原樣。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(false);
  });

  it('rejects replacing a canonical term with the forbidden term', () => {
    expect(
      checker.isCanonicalTerminologyOnlyChange('Agent 會工作。\n', '代理人會工作。\n', glossary)
    ).toBe(false);
  });

  it('rejects a whitespace-only change around an existing canonical term', () => {
    expect(
      checker.isCanonicalTerminologyOnlyChange('讓 Agent 工作。\n', '讓Agent工作。\n', glossary)
    ).toBe(false);
  });

  it('rejects bundling unrelated canonical-term whitespace with a valid replacement', () => {
    const before = '代理人會工作。\n讓 Agent 工作。\n';
    const after = 'Agent 會工作。\n讓Agent工作。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(false);
  });

  it('rejects an unrelated glossary wrapper', () => {
    const before = '代理人會工作。保留正常文字。\n';
    const after = 'Agent 會工作。[保留正常文字](/glossary#made-up-anchor)。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(false);
  });

  it('rejects a canonical term linked to the wrong anchor', () => {
    const before = '代理人會工作。\n';
    const after = '[Agent](/glossary#proxy) 會工作。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(false);
  });

  it('rejects removing an existing glossary wrapper', () => {
    const before = '[Proxy](/glossary#proxy) 轉發資料，代理人負責判斷。\n';
    const after = 'Proxy 轉發資料，Agent 負責判斷。\n';

    expect(checker.isCanonicalTerminologyOnlyChange(before, after, glossary)).toBe(false);
  });

  it('fails closed on malformed forbidden-term configuration', () => {
    const malformed = [{ ...glossary[0], forbiddenZhTw: '代理人' }];

    expect(() => checker.normalizeGlossary(malformed)).toThrow(/forbiddenZhTw/);
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
