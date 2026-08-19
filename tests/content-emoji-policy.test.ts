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
const MARKDOWN_POST_PATH = 'src/content/posts/gp-997-emoji-test.md';
const BACKSLASH = String.fromCharCode(92);

function writeApprovalCorpus(
  root: string,
  decisions: Array<Record<string, unknown>> = [approvalDecision()]
): void {
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'shroomdog-editorial-feedback.md'),
    approvalCorpus(decisions)
  );
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
  approvalDecisions?: Array<Record<string, unknown>>;
  root?: string;
}) {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-emoji-policy-'));
  writeApprovalCorpus(root, options.approvalDecisions);
  return checkContentChanges({
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
  it('treats ESM-like source as visible prose in Markdown mode', () => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\nexport const message = "😀";\n`;
    const visible = collectReaderSurfaceLineRecords(content, { format: 'md' })
      .map((record) => record.canonicalText)
      .join('\n');
    expect(visible).toContain('export const message = "😀";');
  });

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
    ['named attribute reference', '<img alt="&hearts;">', '♥'],
    ['named title reference', '<abbr title="&hearts;">', '♥'],
    ['unterminated hexadecimal attribute reference', '<img alt="&#x1F600">', '😀'],
    ['unterminated decimal attribute reference', '<img alt="&#128512">', '😀'],
  ])('decodes %s in Markdown raw HTML', (_label, rawHtml, emoji) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${rawHtml}\n`;
    const result = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain(`未授權 emoji ${JSON.stringify(emoji)}`);
  });

  it('keeps decoded raw HTML on its physical source line', () => {
    const content = `---
title: test
lang: zh-tw
---
<div title="&#10;">
<img alt="😀">
</div>
`;
    const emojiRecord = collectReaderSurfaceLineRecords(content, { format: 'md' }).find((record) =>
      record.canonicalText.includes('😀')
    );
    expect(emojiRecord).toMatchObject({ sourceLine: 6 });
    expect([...(emojiRecord?.sourceLines ?? [])]).toEqual([6]);

    const safeResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(safeResult.errors).toEqual([]);

    const emojiResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [6],
    });
    expect(emojiResult.errors.join('\n')).toContain('未授權 emoji');
  });

  it('ignores HTML comments without hiding visible content between them', () => {
    const content = `---
title: test
lang: zh-tw
---
<!-- hidden 🚀 -->😀<!-- hidden ❤️ -->
`;
    const result = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('未授權 emoji "😀"');
    expect(result.errors.join('\n')).not.toContain('🚀');
    expect(result.errors.join('\n')).not.toContain('❤️');
  });

  it.each(['<!-->😀-->', '<!-- hidden --!>😀<!-- x -->'])(
    'uses HTML tokenizer boundaries for malformed comments: %s',
    (readerSurface) => {
      const content = `---\ntitle: test\nlang: zh-tw\n---\n${readerSurface}\n`;
      const result = checkFixture({
        current: { [MARKDOWN_POST_PATH]: content },
        changedPath: MARKDOWN_POST_PATH,
        changedContent: content,
        changedLines: [5],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji "😀"');
    }
  );

  it.each([
    [
      'Markdown raw style',
      MARKDOWN_POST_PATH,
      String.raw`<style>.emoji::after { content: "\1F600" }</style><span class="emoji"></span>`,
    ],
    [
      'Markdown raw script',
      MARKDOWN_POST_PATH,
      String.raw`<script>document.body.textContent = "\uD83D\uDE00"</script>`,
    ],
    [
      'MDX style element',
      POST_PATH,
      '<style>{`' + String.raw`.emoji::after { content: "\\1F600" }` + '`}</style>',
    ],
    [
      'MDX script element',
      POST_PATH,
      String.raw`<script>document.body.textContent = "\uD83D\uDE00"</script>`,
    ],
    [
      'Markdown inline style attribute',
      MARKDOWN_POST_PATH,
      String.raw`<ol style="list-style-type:'\1F600'"><li>x</li></ol>`,
    ],
    [
      'MDX inline style attribute',
      POST_PATH,
      String.raw`<ol style="list-style-type:'\1F600'"><li>x</li></ol>`,
    ],
    [
      'MDX uppercase inline style attribute',
      POST_PATH,
      String.raw`<ol STYLE="list-style-type:'\1F600'"><li>x</li></ol>`,
    ],
    [
      'Markdown inline event attribute',
      MARKDOWN_POST_PATH,
      String.raw`<button onclick="this.textContent='\u{1F600}'">點</button>`,
    ],
    [
      'MDX inline event attribute',
      POST_PATH,
      String.raw`<button onclick="this.textContent='\u{1F600}'">點</button>`,
    ],
  ])('fails closed for executable %s', (_label, changedPath, readerSurface) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${readerSurface}\n`;
    const result = checkFixture({
      current: { [changedPath]: content },
      changedPath,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
  });

  it('allows executable markup examples inside fenced code', () => {
    const content = [
      '---',
      'title: test',
      'lang: zh-tw',
      '---',
      '```html',
      String.raw`<style>.emoji::after { content: "\1F600" }</style>`,
      '```',
      '',
    ].join('\n');
    const result = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5, 6, 7],
    });
    expect(result.errors).toEqual([]);
  });

  it('binds raw HTML executable markup only to its physical tag span', () => {
    const content = [
      '---',
      'title: test',
      'lang: zh-tw',
      '---',
      '<div>',
      '只改安全文字',
      '<style>',
      String.raw`.emoji::after { content: "\1F600" }`,
      '</style>',
      '</div>',
      '',
    ].join('\n');
    const safeResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [6],
    });
    expect(safeResult.errors).toEqual([]);

    const executableResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [8],
    });
    expect(executableResult.errors.join('\n')).toContain(
      '無法靜態驗證可執行的 reader-visible markup'
    );
  });

  it('binds a raw HTML style attribute only to its physical attribute span', () => {
    const content = [
      '---',
      'title: test',
      'lang: zh-tw',
      '---',
      '<div>',
      '只改安全文字',
      '<ol',
      String.raw`  style="list-style-type:'\1F600'"`,
      '>',
      '<li>x</li>',
      '</ol>',
      '</div>',
      '',
    ].join('\n');
    const safeResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [6],
    });
    expect(safeResult.errors).toEqual([]);

    const executableResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [8],
    });
    expect(executableResult.errors.join('\n')).toContain(
      '無法靜態驗證可執行的 reader-visible markup'
    );
  });

  it.each([
    ['Markdown text', MARKDOWN_POST_PATH, 'safe&#10;\n歷史 😀'],
    ['Markdown image alt', MARKDOWN_POST_PATH, '![safe&#10;\n歷史 😀](/image.png)'],
    ['Markdown link title', MARKDOWN_POST_PATH, '[link](/target "safe&#10;\n歷史 😀")'],
    ['MDX quoted prop', POST_PATH, '<Card label="safe&#10;\n歷史 😀" />'],
  ])(
    'keeps decoded entity newlines on their physical source line in %s',
    (_label, changedPath, readerSurface) => {
      const content = `---\ntitle: test\nlang: zh-tw\n---\n${readerSurface}\n`;
      const format = changedPath.endsWith('.md') ? 'md' : 'mdx';
      const emojiRecord = collectReaderSurfaceLineRecords(content, { format }).find((record) =>
        record.canonicalText.includes('😀')
      );
      expect(emojiRecord).toMatchObject({ sourceLine: 6 });
      expect([...(emojiRecord?.sourceLines ?? [])]).toEqual([6]);

      const safeResult = checkFixture({
        current: { [changedPath]: content },
        changedPath,
        changedContent: content,
        changedLines: [5],
      });
      expect(safeResult.errors).toEqual([]);

      const emojiResult = checkFixture({
        current: { [changedPath]: content },
        changedPath,
        changedContent: content,
        changedLines: [6],
      });
      expect(emojiResult.errors.join('\n')).toContain('未授權 emoji');
    }
  );

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

  it.each([
    ['UTF-8 BOM', `\uFEFF---\ntitle: "\\U0001F600"\nlang: zh-tw\n---\nBody.\n`, 2, 5],
    ['CRLF', ['---', 'title: "\\U0001F600"', 'lang: zh-tw', '---', 'Body.', ''].join('\r\n'), 2, 5],
    [
      'UTF-8 BOM and CRLF',
      `\uFEFF${['---', 'title: "\\U0001F600"', 'lang: zh-tw', '---', 'Body.', ''].join('\r\n')}`,
      2,
      5,
    ],
    ['leading blank line', `\n---\ntitle: "\\U0001F600"\nlang: zh-tw\n---\nBody.\n`, 3, 6],
    ['TOML delimiter', `+++\ntitle = "\\U0001F600"\nlang = "zh-tw"\n+++\nBody.\n`, 2, 5],
  ])(
    'extracts Astro-compatible %s frontmatter before scanning emoji',
    (_label, content, titleLine, expectedBodyStartLine) => {
      const { frontmatter, body, bodyStartLine } = extractPostParts(content);
      expect(frontmatter.title).toBe('😀');
      expect(body).toBe(content.includes('\r\n') ? 'Body.\r\n' : 'Body.\n');
      expect(bodyStartLine).toBe(expectedBodyStartLine);

      const result = checkFixture({
        current: { [MARKDOWN_POST_PATH]: content },
        changedPath: MARKDOWN_POST_PATH,
        changedContent: content,
        changedLines: [titleLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji "😀"');
    }
  );

  it('expands top-level YAML merges with anchor and alias source lines', () => {
    const content = `---
warning: &warning
  warnReason: "\\U0001F600"
  warnedByStage0: true
<<: *warning
title: test
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content);
    const warningRecord = records.find((record) => record.surfaceKind === 'frontmatter.warnReason');
    expect(warningRecord).toMatchObject({ canonicalText: '😀', sourceLine: 3 });
    expect([...(warningRecord?.sourceLines ?? [])]).toEqual([3, 5]);

    for (const changedLine of [3, 5]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji "😀"');
    }

    const safeResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [4],
    });
    expect(safeResult.errors).toEqual([]);
  });

  it('does not scan a merged YAML value overridden by an explicit top-level key', () => {
    const content = `---
warning: &warning
  warnReason: "\\U0001F600"
<<: *warning
warnReason: safe
title: test
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content);
    expect(records.filter((record) => record.surfaceKind === 'frontmatter.warnReason')).toEqual([
      expect.objectContaining({ canonicalText: 'safe', sourceLine: 5, sourceLines: new Set([5]) }),
    ]);
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [2, 3, 4, 5],
    });
    expect(result.errors).toEqual([]);
  });

  it('resolves an alias used as a reader-visible YAML top-level key', () => {
    const content = `---
readerKey: &readerKey title
*readerKey : "\\U0001F600"
lang: zh-tw
---
Body.
`;
    const titleRecord = collectReaderSurfaceLineRecords(content).find(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(titleRecord).toMatchObject({ canonicalText: '😀', sourceLine: 3 });
    expect([...(titleRecord?.sourceLines ?? [])].sort()).toEqual([2, 3]);

    for (const changedLine of [2, 3]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji "😀"');
    }
  });

  it('projects TOML frontmatter values onto their physical source lines', () => {
    const content = `+++
title = "只改安全文字"
summary = "歷史 \\U0001F600"
lang = "zh-tw"
+++
Body.
`;
    const records = collectReaderSurfaceLineRecords(content, { format: 'md' });
    const titleRecord = records.find((record) => record.surfaceKind === 'frontmatter.title');
    const summaryRecord = records.find((record) => record.surfaceKind === 'frontmatter.summary');
    expect(titleRecord).toMatchObject({ canonicalText: '只改安全文字', sourceLine: 2 });
    expect([...(titleRecord?.sourceLines ?? [])]).toEqual([2]);
    expect(summaryRecord).toMatchObject({ canonicalText: '歷史 😀', sourceLine: 3 });
    expect([...(summaryRecord?.sourceLines ?? [])]).toEqual([3]);

    const safeResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [2],
    });
    expect(safeResult.errors).toEqual([]);

    const emojiResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [3],
    });
    expect(emojiResult.errors.join('\n')).toContain('未授權 emoji "😀"');
  });

  it('keeps TOML literal-string escapes literal while scanning basic-string escapes', () => {
    const content = `+++
title = 'literal \\U0001F600'
summary = "reader \\U0001F600"
lang = "zh-tw"
+++
Body.
`;
    const records = collectReaderSurfaceLineRecords(content, { format: 'md' });
    expect(records.find((record) => record.surfaceKind === 'frontmatter.title')).toMatchObject({
      canonicalText: 'literal \\U0001F600',
      sourceLine: 2,
    });
    expect(records.find((record) => record.surfaceKind === 'frontmatter.summary')).toMatchObject({
      canonicalText: 'reader 😀',
      sourceLine: 3,
    });
  });

  it('projects a multiline TOML string one physical line at a time', () => {
    const content = `+++
title = """只改安全文字
歷史 \\U0001F600"""
lang = "zh-tw"
+++
Body.
`;
    const records = collectReaderSurfaceLineRecords(content, { format: 'md' }).filter(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalText: '只改安全文字', sourceLines: new Set([2]) }),
        expect.objectContaining({ canonicalText: '歷史 😀', sourceLines: new Set([3]) }),
      ])
    );

    const safeResult = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [2],
    });
    expect(safeResult.errors).toEqual([]);
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
    ['text-default modifier base', '☝🏽', ['☝🏽']],
    ['text-default modifier base with VS16', '✌️🏽', ['✌️🏽']],
    ['modified ZWJ sequence', '👩🏽‍💻', ['👩🏽‍💻']],
    ['non-modifier base followed by modifier', '🚀🏽', ['🚀', '🏽']],
    ['invalid modifier ZWJ chain', '🚀🏽‍👨', ['🚀', '🏽', '👨']],
  ])('tokenizes %s into complete emoji sequences', (_label, text, expected) => {
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
    '（版本 A • 支援 ❤）',
    '（版本 B · 支援 ♥）',
    '（版本 C - 支援 ❤）',
    '（版本 D ･ 支援 ♥）',
  ])('does not treat ordinary bullet parenthetical as kaomoji: %s', (text) => {
    expect(findEmojiSequences(text).map((match) => match.emoji)).toEqual([
      text.includes('❤') ? '❤' : '♥',
    ]);
  });

  it('does not treat an ordinary status legend as a heart-bearing kaomoji', () => {
    expect(
      findEmojiSequences('（狀態：□ 未選，■ 已選，支援 ❤）').map((match) => match.emoji)
    ).toEqual(['❤']);
  });

  it('does not combine unrelated legend glyphs into a heart-bearing kaomoji', () => {
    expect(
      findEmojiSequences('（□ 正常 △ 注意 ■ 異常，支援 ❤）').map((match) => match.emoji)
    ).toEqual(['❤']);
  });

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

  it('does not let a later-line emoji contaminate an earlier safe continuation line', () => {
    const content = `---
title: "只改安全文字\\
  歷史 ❤️"
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content).filter(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual([
      ['只改安全文字', [2]],
      ['歷史 ❤️', [3]],
    ]);

    const safeResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [2],
    });
    expect(safeResult.errors).toEqual([]);

    const changedResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [3],
    });
    expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
  });

  it('keeps unrelated earlier continuation text out of a cross-line emoji hash', () => {
    const content = `---
title: "safe\\
  prefix 👩\\
  \\u200D\\
  💻"
lang: zh-tw
---
Body.
`;
    const bridgeRecord = collectReaderSurfaceLineRecords(content).find(
      (record) => record.emojiMatches?.[0]?.emoji === '👩‍💻'
    );
    expect(bridgeRecord).toMatchObject({ canonicalText: 'prefix 👩‍💻', sourceLine: 3 });
    expect([...(bridgeRecord?.sourceLines ?? [])]).toEqual([3, 4, 5]);

    const changedContent = content.replace('safe', 'safer');
    const safeResult = checkFixture({
      current: { [POST_PATH]: changedContent },
      changedContent,
      changedLines: [2],
      entries: [validEntry('prefix 👩‍💻', { emoji: '👩‍💻' })],
      approvalDecisions: [approvalDecision({ emoji: '👩‍💻' })],
    });
    expect(safeResult.errors).toEqual([]);
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

  it('scans reference-style image alt text and title from both physical source sites', () => {
    const content = `---
title: test
lang: zh-tw
---
![safe alt][pic]

[pic]: /x "❤️"
`;
    const records = collectReaderSurfaceLineRecords(content);
    const titleRecord = records.find((record) => record.canonicalText === '❤️');
    expect([...(titleRecord?.sourceLines ?? [])]).toEqual([7, 5]);

    for (const changedLine of [5, 7]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji');
    }

    const emojiAlt = content.replace('safe alt', '😀').replace(' "❤️"', '');
    const altResult = checkFixture({
      current: { [POST_PATH]: emojiAlt },
      changedContent: emojiAlt,
      changedLines: [5],
    });
    expect(altResult.errors.join('\n')).toContain('未授權 emoji');
  });

  it('scans a reference-style link title from the use and definition lines', () => {
    const content = `---
title: test
lang: zh-tw
---
[safe link][pic]

[pic]: /x "❤️"
`;
    for (const changedLine of [5, 7]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji');
    }
  });

  it('keeps a safe multiline reference destination separate from its legacy title', () => {
    const content = `---
title: test
lang: zh-tw
---
![safe alt][pic]

[pic]: /x
  "safe title
  legacy ❤️"
`;
    const records = collectReaderSurfaceLineRecords(content);
    const safeTitleRecord = records.find((record) => record.canonicalText === 'safe title');
    const emojiTitleRecord = records.find((record) => record.canonicalText === 'legacy ❤️');
    expect([...(safeTitleRecord?.sourceLines ?? [])]).toEqual([8, 5]);
    expect(emojiTitleRecord).toMatchObject({ sourceLine: 9 });
    expect([...(emojiTitleRecord?.sourceLines ?? [])]).toEqual([9, 5]);

    for (const changedLine of [7, 8]) {
      const safeResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(safeResult.errors).toEqual([]);
    }

    for (const changedLine of [5, 9]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji');
    }
  });

  it.each([
    ['double-quoted image', '![safe alt]', '"', '"'],
    ['single-quoted link', '[safe link]', "'", "'"],
    ['parenthesized image', '![safe alt]', '(', ')'],
  ])(
    'maps a multiline inline %s title to its physical title lines',
    (_label, opener, titleOpen, titleClose) => {
      const content = `---
title: test
lang: zh-tw
---
${opener}(
  /x
  ${titleOpen}safe title
  legacy ❤️${titleClose}
)
`;
      const records = collectReaderSurfaceLineRecords(content);
      const safeTitleRecord = records.find((record) => record.canonicalText === 'safe title');
      const emojiTitleRecord = records.find((record) => record.canonicalText === 'legacy ❤️');
      expect([...(safeTitleRecord?.sourceLines ?? [])]).toEqual([7]);
      expect([...(emojiTitleRecord?.sourceLines ?? [])]).toEqual([8]);

      for (const changedLine of [5, 6, 7, 9]) {
        const safeResult = checkFixture({
          current: { [POST_PATH]: content },
          changedContent: content,
          changedLines: [changedLine],
        });
        expect(safeResult.errors).toEqual([]);
      }

      const changedResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [8],
      });
      expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
    }
  );

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

  it.each([
    ['body negative number', '{-1}'],
    ['body positive number', '{+1}'],
    ['body negative bigint', '{-1n}'],
    ['JSX prop negative number', '<LevelUpProgress current={-1} />'],
    ['JSX prop positive number', '<LevelUpProgress current={+1} />'],
    ['JSX prop negative bigint', '<LevelUpProgress current={-1n} />'],
  ])('accepts a static signed numeric %s', (_label, expression) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
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

  it.each([
    ['body template', '{`只改安全文字\n歷史 ❤️`}'],
    ['JSX prop template', '<Card label={`只改安全文字\n歷史 ❤️`} />'],
    ['body string', `{"只改安全文字${BACKSLASH}\n歷史 ❤️"}`],
    ['JSX prop string', `<Card label={"只改安全文字${BACKSLASH}\n歷史 ❤️"} />`],
  ])(
    'grandfathers an untouched legacy emoji on another multiline static %s line',
    (_label, expression) => {
      const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
      const records = collectReaderSurfaceLineRecords(content).filter(
        (record) => record.surfaceKind === 'mdx'
      );
      expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual(
        expect.arrayContaining([
          ['只改安全文字', [5]],
          ['歷史 ❤️', [6]],
        ])
      );

      const safeResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [5],
      });
      expect(safeResult.errors).toEqual([]);

      const changedResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [6],
      });
      expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
    }
  );

  it.each([
    ['template', ['{`safe', `split 👩${BACKSLASH}`, `\\u200D${BACKSLASH}`, '💻`}'].join('\n')],
    [
      'string',
      [`{"safe${BACKSLASH}`, `split 👩${BACKSLASH}`, `\\u200D${BACKSLASH}`, '💻"}'].join('\n'),
    ],
  ])('bridges an emoji split across static-%s escaped line continuations', (_label, expression) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${expression}\n`;
    const bridgeRecord = collectReaderSurfaceLineRecords(content).find(
      (record) => record.emojiMatches?.[0]?.emoji === '👩‍💻'
    );
    expect(bridgeRecord).toMatchObject({ canonicalText: 'split 👩‍💻', sourceLine: 6 });
    expect([...(bridgeRecord?.sourceLines ?? [])]).toEqual([6, 7, 8]);

    const safeResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
    });
    expect(safeResult.errors).toEqual([]);

    for (const changedLine of [6, 7, 8]) {
      const changedResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
    }
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

  it('grandfathers an untouched legacy emoji on another YAML block-scalar line', () => {
    const content = `---
title: |-
  第一行
  只改安全文字
  歷史 ❤️
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content).filter(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual([
      ['第一行', [3]],
      ['只改安全文字', [4]],
      ['歷史 ❤️', [5]],
    ]);

    const untouchedResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [4],
    });
    expect(untouchedResult.errors).toEqual([]);

    const changedResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [5],
    });
    expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
  });

  it.each([
    ['double', '"', '\\u2764\\uFE0F'],
    ['single', "'", '❤️'],
  ])(
    'grandfathers an untouched legacy emoji on another multiline %s-quoted YAML line',
    (_label, quote, emojiSource) => {
      const content = `---
title: ${quote}只改安全文字
  歷史 ${emojiSource}${quote}
lang: zh-tw
---
Body.
`;
      const records = collectReaderSurfaceLineRecords(content).filter(
        (record) => record.surfaceKind === 'frontmatter.title'
      );
      expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual([
        ['只改安全文字', [2]],
        ['歷史 ❤️', [3]],
      ]);

      const safeResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [2],
      });
      expect(safeResult.errors).toEqual([]);

      const changedResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [3],
      });
      expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
    }
  );

  it('grandfathers an untouched legacy emoji on another multiline plain YAML line', () => {
    const content = `---
title: 只改安全文字
  歷史 ❤️
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content).filter(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual([
      ['只改安全文字', [2]],
      ['歷史 ❤️', [3]],
    ]);

    const safeResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [2],
    });
    expect(safeResult.errors).toEqual([]);

    const changedResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [3],
    });
    expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
  });

  it('tracks an aliased multiline plain YAML scalar per physical line', () => {
    const content = `---
hidden: &readerTitle 只改安全文字
  歷史 ❤️
title: *readerTitle
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content).filter(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual([
      ['只改安全文字', [2, 4]],
      ['歷史 ❤️', [3, 4]],
    ]);

    const safeTargetResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [2],
    });
    expect(safeTargetResult.errors).toEqual([]);

    for (const changedLine of [3, 4]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji');
    }
  });

  it.each([
    [
      'surrogate pair',
      `---
title: "safe
  split \\uD83D\\
  \\uDE00"
lang: zh-tw
---
Body.
`,
      'split 😀',
      [3, 4],
    ],
    [
      'modifier sequence',
      `---
title: "safe
  split ☝\\
  🏽"
lang: zh-tw
---
Body.
`,
      'split ☝🏽',
      [3, 4],
    ],
    [
      'surrogate pair across an empty continuation fragment',
      `---
title: "safe
  split \\uD83D\\
  \\
  \\uDE00"
lang: zh-tw
---
Body.
`,
      'split 😀',
      [3, 4, 5],
    ],
    [
      'ZWJ sequence',
      `---
title: "safe
  split 👩\\
  \\u200D\\
  💻"
lang: zh-tw
---
Body.
`,
      'split 👩‍💻',
      [3, 4, 5],
    ],
  ])(
    'keeps an emoji %s split across YAML escaped line continuations detectable',
    (_label, content, canonicalEmojiLine, emojiSourceLines) => {
      const records = collectReaderSurfaceLineRecords(content).filter(
        (record) => record.surfaceKind === 'frontmatter.title'
      );
      const crossLineRecord = records.find(
        (record) =>
          record.canonicalText === canonicalEmojiLine &&
          record.emojiMatches?.[0]?.emoji === canonicalEmojiLine.replace('split ', '')
      );
      expect(crossLineRecord).toMatchObject({ sourceLine: emojiSourceLines[0] });
      expect([...(crossLineRecord?.sourceLines ?? [])]).toEqual(emojiSourceLines);

      const safeResult = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [2],
      });
      expect(safeResult.errors).toEqual([]);

      for (const changedLine of emojiSourceLines) {
        const changedResult = checkFixture({
          current: { [POST_PATH]: content },
          changedContent: content,
          changedLines: [changedLine],
        });
        expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
      }
    }
  );

  it.each(['|-', '>-'])('tracks an aliased YAML %s block scalar per physical line', (style) => {
    const content = `---
hidden: &readerTitle ${style}
  只改安全文字
  歷史 ❤️
title: *readerTitle
lang: zh-tw
---
Body.
`;
    const records = collectReaderSurfaceLineRecords(content).filter(
      (record) => record.surfaceKind === 'frontmatter.title'
    );
    expect(records.map((record) => [record.canonicalText, [...record.sourceLines]])).toEqual([
      ['只改安全文字', [3, 5]],
      ['歷史 ❤️', [4, 5]],
    ]);

    const safeTargetResult = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [3],
    });
    expect(safeTargetResult.errors).toEqual([]);

    for (const changedLine of [4, 5]) {
      const result = checkFixture({
        current: { [POST_PATH]: content },
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('未授權 emoji');
    }
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

  it('accepts an exact approval for a Markdown post loaded by Astro', () => {
    const line = '核准火花 ✨';
    const raw = {
      version: 1,
      entries: [validEntry(line, { path: MARKDOWN_POST_PATH })],
    };
    const corpus = approvalCorpus([approvalDecision({ path: MARKDOWN_POST_PATH })]);
    expect(() => parseContentEmojiAllowlist(raw, corpus)).not.toThrow();
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
  it.each([
    ['MDX', POST_PATH, 'new ❤️'],
    ['Markdown', MARKDOWN_POST_PATH, 'export const message = "😀";'],
  ])(
    'fails the same emoji change in staged and PR-base modes for %s posts',
    (_label, postPath, changedLine) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-emoji-git-'));
      fs.mkdirSync(path.join(root, 'src', 'content', 'posts'), { recursive: true });
      fs.mkdirSync(path.join(root, 'quality'), { recursive: true });
      writeApprovalCorpus(root);
      fs.writeFileSync(
        path.join(root, 'quality', 'content-emoji-allowlist.json'),
        '{"version":1,"entries":[]}\n'
      );
      fs.writeFileSync(path.join(root, postPath), '---\ntitle: test\nlang: zh-tw\n---\nclean\n');
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
      const base = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();

      fs.appendFileSync(path.join(root, postPath), `${changedLine}\n`);
      execFileSync('git', ['add', postPath], { cwd: root });
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
    }
  );

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
