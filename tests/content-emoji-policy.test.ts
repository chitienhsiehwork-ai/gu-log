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
import {
  collectReaderSurfaceLineRecords,
  findTrustedComponentEmojiSequences,
  TRUSTED_CONTENT_COMPONENT_IMPORTS,
} from '../scripts/lib/reader-surface.mjs';
import {
  checkContentChanges,
  findEmojiSequences,
  parseAddedSourceLines,
  parseContentEmojiAllowlist,
  sha256Line,
} from '../scripts/check-content-emoji.mjs';
import { collectTrustedComponentStaticStrings } from './helpers/trusted-component-static-strings.mjs';

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
    sourceLine: 5,
    lineHash: sha256Line('核准火花 ✨'),
    maxOccurrences: 1,
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
    sourceLine: 5,
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
    [
      'Markdown srcdoc attribute',
      MARKDOWN_POST_PATH,
      String.raw`<iframe srcdoc="<script>document.body.textContent='\u{1F600}'</script>"></iframe>`,
    ],
    [
      'MDX srcdoc attribute',
      POST_PATH,
      String.raw`<iframe srcDoc="&lt;script&gt;document.body.textContent='\u{1F600}'&lt;/script&gt;"></iframe>`,
    ],
    [
      'Markdown javascript URL attribute',
      MARKDOWN_POST_PATH,
      String.raw`<a href="java&#x73;cript:document.body.textContent='\u{1F600}'">點</a>`,
    ],
    [
      'MDX javascript URL expression attribute',
      POST_PATH,
      String.raw`<a href={"javascript:document.body.textContent='\u{1F600}'"}>點</a>`,
    ],
    [
      'Markdown XHTML data URL in an iframe',
      MARKDOWN_POST_PATH,
      '<iframe src="data:application/xhtml+xml,%3Chtml%3E%26%23128512%3B%3C/html%3E"></iframe>',
    ],
    [
      'MDX opaque data URL in an object',
      POST_PATH,
      '<object data="data:text/plain,%F0%9F%98%80" />',
    ],
    [
      'Markdown dangerous second srcset candidate',
      MARKDOWN_POST_PATH,
      '<img srcset="/safe.png 1x, data:image/svg+xml,%3Csvg%3E%3Ctext%3E%26%23128512%3B%3C/text%3E%3C/svg%3E 2x" alt="safe">',
    ],
    [
      'MDX dangerous source srcSet candidate',
      POST_PATH,
      '<source srcSet="data:image/svg+xml;base64,PHN2Zz48dGV4dD7wn5iAPC90ZXh0Pjwvc3ZnPg== 1x" />',
    ],
    [
      'Markdown dangerous video poster',
      MARKDOWN_POST_PATH,
      '<video poster="data:image/svg+xml,%3Csvg%3E%3Ctext%3E%26%23128512%3B%3C/text%3E%3C/svg%3E"></video>',
    ],
    [
      'MDX dangerous PostVideo poster',
      POST_PATH,
      '<PostVideo poster="data:image/svg+xml;base64,PHN2Zz48dGV4dD7wn5iAPC90ZXh0Pjwvc3ZnPg==" />',
    ],
    [
      'Markdown data CSS stylesheet',
      MARKDOWN_POST_PATH,
      String.raw`<link rel="stylesheet" href="data:text/css,.emoji::after%7Bcontent:'\1F600'%7D"><span class="emoji"></span>`,
    ],
    [
      'MDX data CSS stylesheet',
      POST_PATH,
      String.raw`<link rel="stylesheet" href="data:text/css,.emoji::after%7Bcontent:'\1F600'%7D" /><span className="emoji" />`,
    ],
    [
      'Markdown linked stylesheet',
      MARKDOWN_POST_PATH,
      '<link rel="stylesheet" href="/emoji.css"><span class="emoji"></span>',
    ],
    [
      'MDX linked stylesheet',
      POST_PATH,
      '<link rel="stylesheet" href="/emoji.css" /><span className="emoji" />',
    ],
    ['Markdown linked SVG image', MARKDOWN_POST_PATH, '<img src="/emoji.svg" alt="safe">'],
    ['MDX linked SVG image', POST_PATH, '<PostImage src="/emoji.svg" alt="safe" />'],
    ['Markdown linked iframe document', MARKDOWN_POST_PATH, '<iframe src="/emoji.html"></iframe>'],
    ['MDX linked frame document', POST_PATH, '<frame src="/emoji.html" />'],
    ['Markdown linked object document', MARKDOWN_POST_PATH, '<object data="/emoji.html"></object>'],
    ['MDX linked embed document', POST_PATH, '<embed src="/emoji.html" />'],
    ['MDX side-effect stylesheet import', POST_PATH, "import './emoji.css';"],
    ['MDX bound CSS module import', POST_PATH, "import styles from './emoji.module.css';"],
    [
      'MDX CSS module re-export',
      POST_PATH,
      "export { default as styles } from './emoji.module.css';",
    ],
    ['MDX package-alias binding import', POST_PATH, "import styles from '@example/emoji-theme';"],
    ['MDX relative extensionless binding import', POST_PATH, "import styles from './theme';"],
    ['MDX unapproved Astro component import', POST_PATH, "import Note from './Note.astro';"],
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

  it.each([
    ['Markdown safe URL', MARKDOWN_POST_PATH, '<a href="/safe">safe</a>'],
    ['MDX safe URL', POST_PATH, '<a href="/safe">safe</a>'],
    ['Markdown safe link destination', MARKDOWN_POST_PATH, '[safe](/safe)'],
    ['Markdown safe image destination', MARKDOWN_POST_PATH, '![safe](/safe.png)'],
    ['Markdown ordinary SVG link', MARKDOWN_POST_PATH, '[diagram](/diagram.svg)'],
    [
      'Markdown inert raster data URL',
      MARKDOWN_POST_PATH,
      '<img src="data:image/png;base64,AAAA" alt="safe">',
    ],
    [
      'Markdown safe srcset candidates',
      MARKDOWN_POST_PATH,
      '<img srcset="/safe.png 1x, /safe@2x.png 2x" alt="safe">',
    ],
    [
      'MDX approved component binding import',
      POST_PATH,
      "import MoguNote from '../../components/MoguNote.astro';",
    ],
    ['MDX raster asset binding import', POST_PATH, "import hero from '../../assets/hero.png';"],
    [
      'Markdown preload link',
      MARKDOWN_POST_PATH,
      '<link rel="preload" href="/app.css" as="style">',
    ],
    ['MDX preload link', POST_PATH, '<link rel="preload" href="/app.css" as="style" />'],
  ])('allows a non-executable %s', (_label, changedPath, readerSurface) => {
    const content = `---\ntitle: test\nlang: zh-tw\n---\n${readerSurface}\n`;
    const result = checkFixture({
      current: { [changedPath]: content },
      changedPath,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors).toEqual([]);
  });

  it.each([
    ['HTML decimal entity', '<span>&#128512;</span>'],
    ['HTML hexadecimal entity', '<span>&#x1F600;</span>'],
    ['CSS escape', String.raw`<style>.x::after { content: "\1F600" }</style>`],
    ['JavaScript code-point escape', String.raw`const icon = "\u{1F600}";`],
    ['JavaScript surrogate escapes', String.raw`const icon = "\uD83D\uDE00";`],
    ['layered JavaScript-to-HTML escapes', String.raw`<Fragment set:html={'\u0026#128512;'} />`],
    [
      'layered JavaScript hexadecimal-to-HTML escapes',
      String.raw`<Fragment set:html={'\x26#128512;'} />`,
    ],
    ['layered JavaScript-to-CSS escapes', String.raw`<style>{'\u005c1F600'}</style>`],
  ])('detects encoded emoji in trusted component source via %s', (_label, source) => {
    expect(findTrustedComponentEmojiSequences(source).map((match) => match.emoji)).toContain('😀');
  });

  it.each([
    ["'&#' + '128512;'", "'&#' + '128512;'"],
    ['static template interpolation', "`${'&#'}${'128512;'}`"],
    ['static String.concat', "'&#'.concat('128512;')"],
    ['static Array.join', "['&#', '128512;'].join('')"],
    ['static String.fromCodePoint', 'String.fromCodePoint(0x1f600)'],
    ['static numeric calculation', 'String.fromCodePoint(128513 - 1)'],
  ])('projects trusted component %s before scanning', (_label, expression) => {
    const source = ['---', '---', `<Fragment set:html={${expression}} />`].join('\n');
    const projected = collectTrustedComponentStaticStrings(source);
    const emoji = projected.flatMap((value) =>
      findTrustedComponentEmojiSequences(value).map((match) => match.emoji)
    );
    expect(emoji).toContain('😀');
  });

  it('resolves immutable top-level bindings in trusted component output', () => {
    const source = [
      '---',
      "const prefix = '&#';",
      "const icon = prefix + '128512;';",
      '---',
      '<Fragment set:html={icon} />',
    ].join('\n');
    const projected = collectTrustedComponentStaticStrings(source);
    const emoji = projected.flatMap((value) =>
      findTrustedComponentEmojiSequences(value).map((match) => match.emoji)
    );
    expect(emoji).toContain('😀');
  });

  it.each([
    ['as const', "const prefix = '&#' as const;"],
    ['satisfies', "const prefix = '&#' satisfies string;"],
  ])('unwraps %s around immutable trusted component bindings', (_label, declaration) => {
    const source = [
      '---',
      declaration,
      "const icon = prefix + '128512;';",
      '---',
      '<Fragment set:html={icon} />',
    ].join('\n');
    const projected = collectTrustedComponentStaticStrings(source);
    const emoji = projected.flatMap((value) =>
      findTrustedComponentEmojiSequences(value).map((match) => match.emoji)
    );
    expect(emoji).toContain('😀');
  });

  it('resolves numeric calculations through immutable trusted component bindings', () => {
    const source = [
      '---',
      'const codePoint = 128513 - 1;',
      'const icon = String.fromCodePoint(codePoint);',
      '---',
      '<Fragment set:html={icon} />',
    ].join('\n');
    const projected = collectTrustedComponentStaticStrings(source);
    const emoji = projected.flatMap((value) =>
      findTrustedComponentEmojiSequences(value).map((match) => match.emoji)
    );
    expect(emoji).toContain('😀');
  });

  it.each([
    [
      'immutable array members',
      "const parts = ['&#', '128512;'];",
      'const icon = parts[0] + parts[1];',
    ],
    [
      'immutable object members',
      "const parts = { prefix: '&#', suffix: '128512;' };",
      'const icon = parts.prefix + parts.suffix;',
    ],
  ])('resolves %s in trusted component output', (_label, declaration, expression) => {
    const source = ['---', declaration, expression, '---', '<Fragment set:html={icon} />'].join(
      '\n'
    );
    const projected = collectTrustedComponentStaticStrings(source);
    const emoji = projected.flatMap((value) =>
      findTrustedComponentEmojiSequences(value).map((match) => match.emoji)
    );
    expect(emoji).toContain('😀');
  });

  it('keeps every trusted component source free of encoded or literal Unicode emoji', () => {
    const findings = TRUSTED_CONTENT_COMPONENT_IMPORTS.flatMap(([source, componentName]) => {
      const componentSource = fs.readFileSync(
        path.resolve(REPO_ROOT, 'src/content/posts', source),
        'utf8'
      );
      const projected = [
        componentSource,
        ...collectTrustedComponentStaticStrings(
          componentSource,
          path.resolve(REPO_ROOT, 'src/content/posts', source)
        ),
      ];
      return projected.flatMap((value) =>
        findTrustedComponentEmojiSequences(value).map((match) => ({
          componentName,
          emoji: match.emoji,
        }))
      );
    });
    expect(findings).toEqual([]);
  });

  it('tracks a trusted PostImage alias when classifying an SVG source', () => {
    const content = `---
title: test
lang: zh-tw
---
import Picture from '../../components/PostImage.astro';

<Picture src="/emoji.svg" alt="safe" />
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [7],
    });
    expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
  });

  it('allows a trusted raster binding through a PostImage alias', () => {
    const content = `---
title: test
lang: zh-tw
---
import Picture from '../../components/PostImage.astro';
import hero from '../../assets/hero.png';

<Picture src={hero} alt="safe" />
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [8],
    });
    expect(result.errors).toEqual([]);
  });

  it.each([
    ['decimal entity', '#128512;', '😀'],
    ['named entity', '#hearts;', '♥'],
  ])('projects a Mermaid %s before scanning', (_label, entity, emoji) => {
    const content = `---
title: test
lang: zh-tw
---
import Diagram from '../../components/Mermaid.astro';

<Diagram chart={"graph TD\\n  A[${entity}]"} />
`;
    const records = collectReaderSurfaceLineRecords(content);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalText: expect.stringContaining(emoji), sourceLine: 7 }),
      ])
    );
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [7],
    });
    expect(result.errors.join('\n')).toContain(`未授權 emoji ${JSON.stringify(emoji)}`);
  });

  it('keeps non-emoji Mermaid entity codes valid', () => {
    const content = `---
title: test
lang: zh-tw
---
import Mermaid from '../../components/Mermaid.astro';

<Mermaid chart={"graph TD\\n  A[#quot;safe#quot;]"} />
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedContent: content,
      changedLines: [7],
    });
    expect(result.errors).toEqual([]);
  });

  it.each([POST_PATH, MARKDOWN_POST_PATH])(
    'binds a linked stylesheet only to its rel and href lines in %s',
    (changedPath) => {
      const content = `---
title: test
lang: zh-tw
---
<link
  rel="stylesheet"
  href="/emoji.css"
  data-safe="changed"
/>
`;
      for (const changedLine of [6, 7]) {
        const result = checkFixture({
          current: { [changedPath]: content },
          changedPath,
          changedContent: content,
          changedLines: [changedLine],
        });
        expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
      }

      const safeLineResult = checkFixture({
        current: { [changedPath]: content },
        changedPath,
        changedContent: content,
        changedLines: [8],
      });
      expect(safeLineResult.errors).toEqual([]);
    }
  );

  it('binds potentially-rendering ESM to the exact statement lines', () => {
    const content = `---
title: test
lang: zh-tw
---
import './old.css';
export const safe = 'changed';
`;
    const dangerousLineResult = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(dangerousLineResult.errors.join('\n')).toContain(
      '無法靜態驗證可執行的 reader-visible markup'
    );

    const safeLineResult = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [6],
    });
    expect(safeLineResult.errors).toEqual([]);
  });

  it('binds a dynamic link rel to an adjacent href line', () => {
    const content = `---
title: test
lang: zh-tw
---
<link
  rel={runtimeRel}
  href="/emoji.css"
/>
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [7],
    });
    expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
  });

  it('fails closed for an executable Markdown link destination', () => {
    const content = `---
title: test
lang: zh-tw
---
[點](javascript:document.body.textContent=String.fromCodePoint(128512))
`;
    const result = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
  });

  it('binds an executable reference destination to the use and definition lines', () => {
    const content = `---
title: test
lang: zh-tw
---
[點][unsafe]

[unsafe]: javascript:document.body.textContent=String.fromCodePoint(128512)
`;
    for (const changedLine of [5, 7]) {
      const result = checkFixture({
        current: { [MARKDOWN_POST_PATH]: content },
        changedPath: MARKDOWN_POST_PATH,
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
    }
  });

  it('fails closed for an executable Markdown image destination', () => {
    const content = `---
title: test
lang: zh-tw
---
![點](data:image/svg+xml,<svg><text>&#128512;</text></svg>)
`;
    const result = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
  });

  it('fails closed for a normal SVG Markdown image destination', () => {
    const content = `---
title: test
lang: zh-tw
---
![圖](/emoji.svg)
`;
    const result = checkFixture({
      current: { [MARKDOWN_POST_PATH]: content },
      changedPath: MARKDOWN_POST_PATH,
      changedContent: content,
      changedLines: [5],
    });
    expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
  });

  it('binds a multiline srcset failure only to the dangerous candidate line', () => {
    const content = `---
title: test
lang: zh-tw
---
<img srcset="
  /safe.png 1x&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;&Tab;,
  data:image/svg+xml,%3Csvg%3E%3Ctext%3E%26%23128512%3B%3C/text%3E%3C/svg%3E 2x
" alt="safe" />
`;
    for (const changedPath of [POST_PATH, MARKDOWN_POST_PATH]) {
      const safeLineResult = checkFixture({
        current: { [changedPath]: content },
        changedPath,
        changedContent: content,
        changedLines: [6],
      });
      expect(safeLineResult.errors).toEqual([]);

      const dangerousLineResult = checkFixture({
        current: { [changedPath]: content },
        changedPath,
        changedContent: content,
        changedLines: [7],
      });
      expect(dangerousLineResult.errors.join('\n')).toContain(
        '無法靜態驗證可執行的 reader-visible markup'
      );
    }
  });

  it('binds an expression srcSet failure only to the dangerous candidate line', () => {
    const content = `---
title: test
lang: zh-tw
---
<img srcSet={\`
  /safe.png 1x,
  data:image/svg+xml,%3Csvg%3E%3Ctext%3E%26%23128512%3B%3C/text%3E%3C/svg%3E 2x
\`} alt="safe" />
`;
    const safeLineResult = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [6],
    });
    expect(safeLineResult.errors).toEqual([]);

    const dangerousLineResult = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [7],
    });
    expect(dangerousLineResult.errors.join('\n')).toContain(
      '無法靜態驗證可執行的 reader-visible markup'
    );
  });

  it('allows a trusted raster binding in an inert image source attribute', () => {
    const content = `---
title: test
lang: zh-tw
---
import PostImage from '../../components/PostImage.astro';
import hero from '../../assets/hero.png';

<PostImage src={hero} alt="safe" />
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [5, 6, 8],
    });
    expect(result.errors).toEqual([]);
  });

  it('does not allow a trusted raster binding in an arbitrary visible prop', () => {
    const content = `---
title: test
lang: zh-tw
---
import hero from '../../assets/hero.png';

<Card title={hero} />
`;
    const result = checkFixture({
      current: { [POST_PATH]: content },
      changedPath: POST_PATH,
      changedContent: content,
      changedLines: [7],
    });
    expect(result.errors.join('\n')).toContain('無法靜態解析讀者可見 MDX expression');
  });

  it('binds an executable image reference destination to the use and definition lines', () => {
    const content = `---
title: test
lang: zh-tw
---
![點][unsafe]

[unsafe]: data:image/svg+xml,<svg><text>&#128512;</text></svg>
`;
    for (const changedLine of [5, 7]) {
      const result = checkFixture({
        current: { [MARKDOWN_POST_PATH]: content },
        changedPath: MARKDOWN_POST_PATH,
        changedContent: content,
        changedLines: [changedLine],
      });
      expect(result.errors.join('\n')).toContain('無法靜態驗證可執行的 reader-visible markup');
    }
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
      entries: [validEntry('  prefix 👩\\', { emoji: '👩‍💻', sourceLine: 3 })],
      approvalDecisions: [
        approvalDecision({
          emoji: '👩‍💻',
          sourceLine: 3,
          lineHash: sha256Line('  prefix 👩\\'),
        }),
      ],
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

  it('invalidates an approval when surrounding source-line context changes', () => {
    const approvedLine = '安全前文 <span title="核准 ✨">A</span>';
    const approvedContent = `---\ntitle: test\nlang: zh-tw\n---\n${approvedLine}\n`;
    const approval = validEntry(approvedLine);
    const decisions = [approvalDecision({ lineHash: approval.lineHash })];
    const approvedResult = checkFixture({
      current: { [POST_PATH]: approvedContent },
      changedContent: approvedContent,
      entries: [approval],
      approvalDecisions: decisions,
    });
    expect(approvedResult.errors).toEqual([]);

    const changedContent = approvedContent.replace('安全前文', '新語境').replace('>A<', '>B<');
    const changedResult = checkFixture({
      current: { [POST_PATH]: changedContent },
      changedContent,
      entries: [approval],
      approvalDecisions: decisions,
    });
    expect(changedResult.errors.join('\n')).toContain('stale');
    expect(changedResult.errors.join('\n')).toContain('未授權 emoji');
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
    ['approved line moved', 'safe\n核准火花 ✨', [6], validEntry('核准火花 ✨')],
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
      approvalDecisions: [
        approvalDecision({
          path: entry.path,
          emoji: entry.emoji,
          sourceLine: entry.sourceLine,
          lineHash: entry.lineHash,
          maxOccurrences: entry.maxOccurrences,
          decidedAt: entry.approvedAt,
        }),
      ],
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
    ['missing sourceLine', { sourceLine: undefined }],
    ['invalid sourceLine', { sourceLine: 0 }],
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
      'approval marker without a source line',
      {},
      approvalCorpus([approvalDecision({ sourceLine: undefined })]),
    ],
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
    [
      'approval marker for another source line',
      {},
      approvalCorpus([approvalDecision({ sourceLine: 6 })]),
    ],
    [
      'approval marker for another line hash',
      {},
      approvalCorpus([approvalDecision({ lineHash: '0'.repeat(64) })]),
    ],
    [
      'approval marker for another count',
      {},
      approvalCorpus([approvalDecision({ maxOccurrences: 2 })]),
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
