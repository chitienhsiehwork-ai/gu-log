import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  extractPostParts,
  readerRevisionCanonicalJSON,
} from '../scripts/lib/reader-revision-core.mjs';
import { collectReaderSurfaceLineRecords } from '../scripts/lib/reader-surface.mjs';
import {
  checkContentChanges,
  findEmojiSequences,
  parseAddedSourceLines,
  parseContentEmojiAllowlist,
  sha256Line,
} from '../scripts/check-content-emoji.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');
const POST_PATH = 'src/content/posts/gp-999-emoji-test.mdx';

function writeApprovalCorpus(root: string): void {
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'shroomdog-editorial-feedback.md'), approvalCorpus());
}

function approvalDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'GP-999-SPARKLE-20260816',
    decision: 'approve',
    path: POST_PATH,
    emoji: '✨',
    decidedAt: '2026-08-16',
    ...overrides,
  };
}

function approvalCorpus(decisions = [approvalDecision()]): string {
  return `# 回饋\n\n## GP-999 emoji 決策\n\n${decisions
    .map((decision) => `<!-- content-emoji-decision ${JSON.stringify(decision)} -->`)
    .join('\n')}\n\nShroomDog 明確核准這一處。\n`;
}

function validEntry(line: string, overrides: Record<string, unknown> = {}) {
  return {
    path: POST_PATH,
    emoji: '✨',
    lineHash: sha256Line(line),
    maxOccurrences: 1,
    approvedAt: '2026-08-16',
    reason: 'ShroomDog 明確要求保留這個語意性圖示。',
    approvalRef:
      'docs/shroomdog-editorial-feedback.md#content-emoji-approval:GP-999-SPARKLE-20260816',
    ...overrides,
  };
}

function checkFixture(options: {
  current: Record<string, string>;
  changedPath?: string;
  changedContent?: string;
  changedLines?: number[];
  entries?: Array<Record<string, unknown>>;
  root?: string;
}) {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-emoji-policy-'));
  writeApprovalCorpus(root);
  return checkContentChanges({
    repoRoot: root,
    changes: [
      {
        path: options.changedPath ?? POST_PATH,
        content: options.changedContent ?? options.current[POST_PATH],
        addedSourceLines: new Set(options.changedLines ?? [5]),
      },
    ],
    allowlist: { version: 1, entries: options.entries ?? [] },
    approvalCorpus: fs.readFileSync(
      path.join(root, 'docs', 'shroomdog-editorial-feedback.md'),
      'utf8'
    ),
    readCurrentPost: (postPath: string) => options.current[postPath] ?? null,
  });
}

describe('shared reader-surface projection', () => {
  it('maps reader-visible frontmatter and MDX surfaces back to source lines', () => {
    const content = `---
ticketId: GP-999
title: "標題 ❤️"
summary: "摘要"
metadata: { gateWarnings: ["emoji 😀 in hidden metadata"] }
---
import Icon from './emoji-😀.astro';
export const hidden = '🚀';

{/* hidden ❤️ */}

<MoguNote>讀者看得到 ❤️</MoguNote>

<Card label="按鈕 ✨" />

![替代文字 🖼️](/image.png)

\`\`\`txt
code output 🚀
\`\`\`
`;

    const records = collectReaderSurfaceLineRecords(content);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surfaceKind: 'frontmatter.title', sourceLine: 3 }),
        expect.objectContaining({ surfaceKind: 'mdx', sourceLine: 12 }),
        expect.objectContaining({ surfaceKind: 'mdx', sourceLine: 14 }),
        expect.objectContaining({ surfaceKind: 'mdx', sourceLine: 16 }),
        expect.objectContaining({ surfaceKind: 'mdx', sourceLine: 19 }),
      ])
    );
    const visible = records.map((record) => record.canonicalText).join('\n');
    expect(visible).toContain('標題 ❤️');
    expect(visible).toContain('讀者看得到 ❤️');
    expect(visible).toContain('按鈕 ✨');
    expect(visible).toContain('替代文字 🖼️');
    expect(visible).toContain('code output 🚀');
    expect(visible).not.toContain('emoji-😀.astro');
    expect(visible).not.toContain("hidden = '🚀'");
    expect(visible).not.toContain('hidden ❤️');
    expect(visible).not.toContain('hidden metadata');
  });

  it('projects parsed YAML values and every frontmatter field rendered by article pages', () => {
    const content = `---
title: "\\U0001F600"
summary: "\\u2764\\uFE0F"
warnReason: "警告 ✨"
warnOverrideComment: "覆核 🚀"
translatedBy:
  model: "Model 😀"
  harness: Codex
stage4Scores:
  degradedDimensions: ["敘事 ❤️"]
  isDegraded: true
scores:
  shroomDogVibe:
    score: 9
    date: "2026-08-16"
    note: "人工備註 🧭"
---
Body.
`;

    const records = collectReaderSurfaceLineRecords(content);
    const visible = records.map((record) => record.canonicalText).join('\n');
    expect(visible).toContain('😀');
    expect(visible).toContain('❤️');
    expect(visible).toContain('警告 ✨');
    expect(visible).toContain('覆核 🚀');
    expect(visible).toContain('Model 😀');
    expect(visible).toContain('敘事 ❤️');
    expect(visible).toContain('人工備註 🧭');
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surfaceKind: 'frontmatter.title', sourceLine: 2 }),
        expect.objectContaining({ surfaceKind: 'frontmatter.summary', sourceLine: 3 }),
        expect.objectContaining({ surfaceKind: 'frontmatter.warnReason', sourceLine: 4 }),
        expect.objectContaining({ surfaceKind: 'frontmatter.translatedBy', sourceLine: 7 }),
        expect.objectContaining({ surfaceKind: 'frontmatter.stage4Scores', sourceLine: 10 }),
        expect.objectContaining({ surfaceKind: 'frontmatter.scores', sourceLine: 16 }),
      ])
    );
  });

  it('decodes reader-visible MDX character references without losing source lines', () => {
    const content = `---
title: test
lang: zh-tw
---
讀者看見 &#x1F600;

<Card label="按鈕 &#x2764;&#xFE0F;" />
`;
    const records = collectReaderSurfaceLineRecords(content);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalText: expect.stringContaining('😀'), sourceLine: 5 }),
        expect.objectContaining({ canonicalText: expect.stringContaining('❤️'), sourceLine: 7 }),
      ])
    );
  });

  it.each([
    ['JSX prop string literal', '<Card label={"\\u2764\\uFE0F"} />', '❤️'],
    ['JSX prop static template', '<Card label={`\\u{1F600}`} />', '😀'],
    ['body string literal', '{"\\u2764\\uFE0F"}', '❤️'],
    ['body static template', '{`\\u{1F600}`}', '😀'],
  ])('decodes reader-visible emoji escapes in %s', (_label, expression, emoji) => {
    const content = `---
title: test
lang: zh-tw
---
${expression}
`;
    const visible = collectReaderSurfaceLineRecords(content)
      .map((record) => record.canonicalText)
      .join('\n');
    expect(visible).toContain(emoji);
  });

  it('does not decode a String.raw escape that renders as literal source text', () => {
    const content = `---
title: test
lang: zh-tw
---
{String.raw\`\\u2764\\uFE0F\`}
`;
    const visible = collectReaderSurfaceLineRecords(content)
      .map((record) => record.canonicalText)
      .join('\n');
    expect(visible).not.toContain('❤️');
  });

  it('keeps reader revision canonical bytes unchanged after extracting shared primitives', () => {
    const content = `---
ticketId: GP-999
title: Test
summary: Summary
lang: zh-tw
translatedBy:
  model: Hidden
---
import Note from './Note.astro';

Body.
`;
    const { frontmatter, body } = extractPostParts(content);
    const canonical = readerRevisionCanonicalJSON(frontmatter, body);
    expect(createHash('sha256').update(canonical).digest('hex').slice(0, 16)).toBe(
      'aa0bde067e7a0272'
    );
  });
});

describe('Unicode emoji and kaomoji boundary', () => {
  it.each([
    ['heart', '❤️', ['❤️']],
    ['plain heart pictograph', '♥', ['♥']],
    ['flag', '🇹🇼', ['🇹🇼']],
    ['keycap', '1️⃣', ['1️⃣']],
    ['ZWJ family', '👨‍👩‍👧‍👦', ['👨‍👩‍👧‍👦']],
    ['variation-selector symbol', '↗️', ['↗️']],
    [
      'England tag flag',
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
      ['\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'],
    ],
  ])('detects %s as one sequence', (_label, text, expected) => {
    expect(findEmojiSequences(text).map((match) => match.emoji)).toEqual(expected);
  });

  it.each(['(๑•̀ㅂ•́)و✧', '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧'])('does not flag kaomoji %s', (text) => {
    expect(findEmojiSequences(text)).toEqual([]);
  });

  it.each(['(◕‿◕)♡', '(♥‿♥)', '(❤‿❤)'])(
    'allows canonical text-heart overlap inside kaomoji %s',
    (text) => {
      expect(findEmojiSequences(text)).toEqual([]);
    }
  );

  it.each([
    ['rocket', '(◕‿◕🚀)', '🚀'],
    ['smiley', '(◕😀◕)', '😀'],
    ['ZWJ family', '(◕👨‍👩‍👧‍👦◕)', '👨‍👩‍👧‍👦'],
  ])('still detects %s smuggled inside a kaomoji-shaped span', (_label, text, emoji) => {
    expect(findEmojiSequences(text).map((match) => match.emoji)).toContain(emoji);
  });
});

describe('added-line ratchet and exact occurrence allowlist', () => {
  it('fails closed when a non-empty git diff has no parseable hunk', () => {
    expect(() => parseAddedSourceLines('Binary files differ\n')).toThrow(/無法解析 hunk/);
  });

  it('blocks emoji in a new or modified reader-visible line', () => {
    const content = '---\ntitle: test\nlang: zh-tw\n---\n新增 ❤️\n';
    const result = checkFixture({ current: { [POST_PATH]: content }, changedContent: content });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it.each([
    ['YAML U escape', '---\ntitle: "\\U0001F600"\nlang: zh-tw\n---\nclean\n', 2],
    ['YAML u escapes', '---\ntitle: "\\u2764\\uFE0F"\nlang: zh-tw\n---\nclean\n', 2],
    ['MDX numeric reference', '---\ntitle: test\nlang: zh-tw\n---\nnew &#x1F600;\n', 5],
    [
      'MDX joined numeric references',
      '---\ntitle: test\nlang: zh-tw\n---\nnew &#x2764;&#xFE0F;\n',
      5,
    ],
    ['MDX named reference', '---\ntitle: test\nlang: zh-tw\n---\nnew &hearts;\n', 5],
    [
      'MDX JSX prop string escape',
      '---\ntitle: test\nlang: zh-tw\n---\n<Card label={"\\u2764\\uFE0F"} />\n',
      5,
    ],
    [
      'MDX JSX prop code-point escape',
      '---\ntitle: test\nlang: zh-tw\n---\n<Card label={`\\u{1F600}`} />\n',
      5,
    ],
    ['MDX body string escape', '---\ntitle: test\nlang: zh-tw\n---\n{"\\u2764\\uFE0F"}\n', 5],
    ['MDX body code-point escape', '---\ntitle: test\nlang: zh-tw\n---\n{`\\u{1F600}`}\n', 5],
  ])('blocks reader-visible %s', (_label, content, changedLine) => {
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [changedLine],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it.each([
    [
      'decoded multiline quoted scalar',
      '---\ntitle: "clean\\nheart \\u2764\\uFE0F"\nlang: zh-tw\n---\nclean\n',
      2,
    ],
    [
      'physical second line of a quoted scalar',
      '---\ntitle: "clean\n  heart \\u2764\\uFE0F"\nlang: zh-tw\n---\nclean\n',
      3,
    ],
    [
      'reader-visible alias target anchor',
      '---\nhidden: &readerTitle "heart \\u2764\\uFE0F"\ntitle: *readerTitle\nlang: zh-tw\n---\nclean\n',
      2,
    ],
  ])('blocks emoji when %s is the added YAML source line', (_label, content, changedLine) => {
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [changedLine],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it('fails closed when String.raw prevents static rendered-string resolution', () => {
    const content = '---\ntitle: test\nlang: zh-tw\n---\n{String.raw`\\u2764\\uFE0F`}\n';
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
    });
    const errors = result.errors.join('\n');
    expect(errors).toContain(`${POST_PATH}:5 無法靜態解析讀者可見 MDX expression`);
    expect(errors).toContain('一般文字或純 static literal tree');
    expect(errors).toContain('identifier、call、spread、interpolation 與 tagged template');
  });

  it('ignores an ESTree-confirmed line-comment-only expression', () => {
    const content = '---\ntitle: test\nlang: zh-tw\n---\n{\n// internal note only\n}\n';
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5, 6, 7],
    });
    expect(result.errors).toEqual([]);
  });

  it.each([
    [
      'line comment followed by an identifier',
      '{\n// leading comment\nreaderLabel\n}',
      '無法靜態解析',
    ],
    ['line comment followed by a string emoji', '{\n// leading comment\n"❤️"\n}', '未授權 emoji'],
  ])('does not treat %s as a non-rendering comment', (_label, expression, expectedError) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5, 6, 7, 8],
    });
    expect(result.errors.join('\n')).toContain(expectedError);
  });

  it.each([
    ['body string escaped newline', '{"safe\\n❤️"}'],
    ['JSX prop string escaped newline', '<Card label={"safe\\n❤️"} />'],
    ['body template escaped newline', '{`safe\\n❤️`}'],
    ['MDX numeric newline reference', 'safe&#10;❤️'],
  ])('uses the physical source span when %s decodes to multiple lines', (_label, expression) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
    const records = collectReaderSurfaceLineRecords(content);
    const emojiRecord = records.find((record) => record.canonicalText.includes('❤️'));
    expect(emojiRecord).toBeDefined();
    expect([...(emojiRecord?.sourceLines ?? [])]).toContain(5);

    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it.each([
    ['string concatenation', '{"clean " + "text"}'],
    ['identifier', '{readerLabel}'],
    ['function call', '{renderLabel()}'],
    ['component prop identifier', '<Card label={readerLabel} />'],
    ['computed object key', '{{ [readerLabel]: true }}'],
    ['object spread', '{{ ...readerLabels }}'],
    ['component prop computed key', '<Card labels={{ [readerLabel]: true }} />'],
    ['component prop object spread', '<Card labels={{ ...readerLabels }} />'],
  ])('fails closed for a changed reader-visible %s', (_label, expression) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain(
      `${POST_PATH}:5 無法靜態解析讀者可見 MDX expression`
    );
  });

  it.each([
    ['body object', '{{ "❤️": true }}'],
    ['JSX prop object', '<Card labels={{ "❤️": true }} />'],
  ])('scans a quoted string key in a static %s', (_label, expression) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it('accepts the existing LevelUp static literal authoring contract', () => {
    const content = `---
title: test
lang: zh-tw
---
<LevelUpProgress current={0} total={6} enabled={true} optional={null} title="OAuth" />

<LevelUpQuiz
  question="安全問題"
  options={[
    { label: "A", text: "第一個答案" },
    { label: "B", text: "第二個答案" },
  ]}
  answer="B"
/>
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: Array.from({ length: 11 }, (_unused, index) => index + 5),
    });
    expect(result.errors).toEqual([]);
  });

  it('recursively scans static LevelUp options for emoji', () => {
    const content = `---
title: test
lang: zh-tw
---
<LevelUpQuiz
  options={[
    { label: "A", text: "安全答案" },
    { label: "B", text: "偷渡 ❤️" },
  ]}
/>
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [8],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it('keeps an untouched legacy emoji literal grandfathered within a multi-line prop', () => {
    const content = `---
title: test
lang: zh-tw
---
<LevelUpQuiz
  options={[
    { label: "A", text: "歷史 🤷" },
    { label: "B", text: "只改安全答案" },
  ]}
/>
`;
    const records = collectReaderSurfaceLineRecords(content);
    const legacyRecord = records.find((record) => record.canonicalText.includes('歷史 🤷'));
    expect([...(legacyRecord?.sourceLines ?? [])]).toEqual([7]);

    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [8],
    });
    expect(result.errors).toEqual([]);
  });

  it('blocks a changed legacy emoji literal within a multi-line prop', () => {
    const content = `---
title: test
lang: zh-tw
---
<LevelUpQuiz
  options={[
    { label: "A", text: "歷史 🤷" },
    { label: "B", text: "安全答案" },
  ]}
/>
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [7],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it('grandfathers an unresolved legacy expression when only another line changes', () => {
    const content = '---\ntitle: test\nlang: zh-tw\n---\n{legacyReaderLabel}\n只改這行文字\n';
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [6],
    });
    expect(result.errors).toEqual([]);
  });

  it('ignores untouched legacy emoji outside the added source lines', () => {
    const content = '---\ntitle: test\nlang: zh-tw\n---\n歷史 ❤️\n只改這行文字\n';
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [6],
    });
    expect(result.errors).toEqual([]);
  });

  it('allows only the approved exact occurrence', () => {
    const line = '核准火花 ✨';
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${line}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      entries: [validEntry(line)],
    });
    expect(result.errors).toEqual([]);
  });

  it.each([
    [
      'same glyph copied to another line',
      '核准火花 ✨\n另一行也放 ✨',
      [5, 6],
      validEntry('核准火花 ✨'),
    ],
    ['approved line changed', '改過的核准火花 ✨', [5], validEntry('核准火花 ✨')],
    ['count exceeded', '核准火花 ✨✨', [5], validEntry('核准火花 ✨')],
    [
      'stale line hash',
      '核准火花 ✨',
      [5],
      validEntry('核准火花 ✨', { lineHash: '0'.repeat(64) }),
    ],
    ['different glyph in same file', '核准火花 ✨ ❤️', [5], validEntry('核准火花 ✨')],
  ])('rejects %s', (_label, body, changedLines, entry) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${body}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines,
      entries: [entry],
    });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('does not let the same glyph and line hash authorize another file', () => {
    const line = '核准火花 ✨';
    const otherPath = 'src/content/posts/gp-998-other.mdx';
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${line}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content, [otherPath]: content },
      changedPath: otherPath,
      changedContent: content,
      entries: [validEntry(line)],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji');
  });

  it.each([
    ['missing approvalRef', { approvalRef: undefined }],
    ['unparseable approvalRef', { approvalRef: 'because user said so' }],
    ['missing approval heading', { approvalRef: 'docs/shroomdog-editorial-feedback.md#missing' }],
  ])('rejects %s', (_label, override) => {
    const line = '核准火花 ✨';
    const raw = { version: 1, entries: [validEntry(line, override)] };
    expect(() => parseContentEmojiAllowlist(raw, approvalCorpus())).toThrow();
  });

  it.each([
    [
      'generic heading',
      { approvalRef: 'docs/shroomdog-editorial-feedback.md#content-emoji-approval:回饋' },
      approvalCorpus(),
    ],
    ['duplicate approval marker', {}, approvalCorpus([approvalDecision(), approvalDecision()])],
    [
      'approval marker for another path',
      {},
      approvalCorpus([approvalDecision({ path: 'src/content/posts/gp-998-other.mdx' })]),
    ],
    ['approval marker for another emoji', {}, approvalCorpus([approvalDecision({ emoji: '❤️' })])],
    [
      'approval marker with another date',
      {},
      approvalCorpus([approvalDecision({ decidedAt: '2026-08-15' })]),
    ],
  ])(
    'rejects %s instead of treating arbitrary corpus content as approval',
    (_label, override, corpus) => {
      const raw = { version: 1, entries: [validEntry('核准火花 ✨', override)] };
      expect(() => parseContentEmojiAllowlist(raw, corpus)).toThrow();
    }
  );
});

describe('staged and PR-base CLI use the same validator', () => {
  it('fails the same emoji change in staged and PR-base modes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-emoji-git-'));
    fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'quality'), { recursive: true });
    writeApprovalCorpus(root);
    fs.writeFileSync(
      path.join(root, 'quality', 'content-emoji-allowlist.json'),
      '{"version":1,"entries":[]}\n'
    );
    fs.writeFileSync(path.join(root, POST_PATH), '---\ntitle: test\nlang: zh-tw\n---\nclean\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    fs.appendFileSync(path.join(root, POST_PATH), 'new ❤️\n');
    execFileSync('git', ['add', POST_PATH], { cwd: root });
    const staged = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'check-content-emoji.mjs'),
        '--staged',
        `--repo-root=${root}`,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(staged.status, staged.stdout + staged.stderr).toBe(1);

    execFileSync('git', ['commit', '-qm', 'emoji'], { cwd: root });
    const pr = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'check-content-emoji.mjs'),
        `--base=${base}`,
        `--repo-root=${root}`,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(pr.status, pr.stdout + pr.stderr).toBe(1);
    expect(staged.stderr).toContain('未授權 emoji');
    expect(pr.stderr).toContain('未授權 emoji');
  });

  it('does not let unstaged approval files authorize a staged post or committed PR head', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-emoji-snapshot-'));
    fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'quality'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    const clean = '---\ntitle: test\nlang: zh-tw\n---\nclean\n';
    const approvedLine = 'new ✨';
    const changed = `${clean}${approvedLine}\n`;
    fs.writeFileSync(path.join(root, POST_PATH), clean);
    fs.writeFileSync(
      path.join(root, 'quality', 'content-emoji-allowlist.json'),
      '{"version":1,"entries":[]}\n'
    );
    fs.writeFileSync(path.join(root, 'docs', 'shroomdog-editorial-feedback.md'), '# 回饋\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    fs.writeFileSync(path.join(root, POST_PATH), changed);
    execFileSync('git', ['add', POST_PATH], { cwd: root });

    fs.writeFileSync(
      path.join(root, 'quality', 'content-emoji-allowlist.json'),
      `${JSON.stringify({ version: 1, entries: [validEntry(approvedLine)] })}\n`
    );
    fs.writeFileSync(path.join(root, 'docs', 'shroomdog-editorial-feedback.md'), approvalCorpus());

    const staged = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'check-content-emoji.mjs'),
        '--staged',
        `--repo-root=${root}`,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(staged.status, staged.stdout + staged.stderr).toBe(1);
    expect(staged.stderr).toContain('未授權 emoji');

    execFileSync('git', ['commit', '-qm', 'emoji post only'], { cwd: root });
    const pr = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'check-content-emoji.mjs'),
        `--base=${base}`,
        `--repo-root=${root}`,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(pr.status, pr.stdout + pr.stderr).toBe(1);
    expect(pr.stderr).toContain('未授權 emoji');
  });

  it('wires pre-commit and CI to the same executable SSOT', () => {
    const hook = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-commit'), 'utf8');
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    expect(hook).toContain('scripts/check-content-emoji.mjs" --staged');
    expect(workflow).toContain('scripts/check-content-emoji.mjs "--base=$BASE_SHA"');
  });
});
