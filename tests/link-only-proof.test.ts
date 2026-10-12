import { describe, expect, it } from 'vitest';
import * as checkerModule from '../scripts/check-glossary-links.mjs';
import * as fixerModule from '../scripts/apply-glossary-links.mjs';
import * as proofModule from '../scripts/lib/link-only-proof.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const checker = checkerModule as any;
const fixer = fixerModule as any;
const proof = proofModule as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const glossary = [
  { term: 'Kubernetes', en: 'Kubernetes', aliases: ['K8s'], category: 'platforms' },
  {
    term: 'Codex',
    linking: { enabled: true, anchor: 'codex', match: ['Codex'], caseSensitive: true },
  },
  { term: 'Agent', linking: { enabled: true, anchor: 'agent', match: ['Agent'] } },
  { term: 'Thread', linking: { anchor: 'thread', enabled: false } },
];

const LEGACY_FRONTMATTER = 'ticketId: "MP-212"\ntitle: "舊文"\nlang: "zh-tw"';
const EN_FRONTMATTER = 'ticketId: "MP-212"\ntitle: "Old post"\nlang: "en"';
const ZH_FILE = 'src/content/posts/mp-212-legacy.mdx';
const POST_LABEL = 'MP-316: 目標文章';
const POST_URL = '/posts/mp-316-target/';
const K8S_LINK = '[Kubernetes](/glossary#kubernetes)';

function post(body: string, frontmatter = LEGACY_FRONTMATTER): string {
  return `---\n${frontmatter}\n---\n\nimport MoguNote from '../../components/MoguNote.astro';\n\n${body}\n`;
}

function validatePostLink(label: string, href: string): void {
  if (label !== POST_LABEL || href !== POST_URL) throw new Error('not the canonical target');
}

function zhProof(before: string, after: string, beforeFrontmatter?: string): boolean {
  return proof.isLinkOnlyChange(post(before, beforeFrontmatter), post(after), {
    filePath: ZH_FILE,
    glossary,
    validatePostLink,
  });
}

// The edit the fixer would make at the first `Kubernetes`, whether or not it may.
function wrapFirstKubernetes(body: string): string {
  return body.replace('Kubernetes', K8S_LINK);
}

function enProof(before: string, after: string): boolean {
  return proof.isLinkOnlyChange(post(before, EN_FRONTMATTER), post(after, EN_FRONTMATTER), {
    filePath: 'src/content/posts/en-mp-212-legacy.mdx',
    glossary,
    validatePostLink,
  });
}

describe('link-only proof: new glossary entry backfills a legacy post', () => {
  it('accepts wrapping the term in the post language link', () => {
    expect(
      zhProof('Kubernetes 會把狀態拉回來。', '[Kubernetes](/glossary#kubernetes) 會把狀態拉回來。')
    ).toBe(true);
    expect(
      enProof(
        'Kubernetes pulls state back.',
        '[Kubernetes](/en/glossary#kubernetes) pulls state back.'
      )
    ).toBe(true);
  });

  it('compares the whole file without trimming or sorting', () => {
    expect(zhProof('第一段\n第二段', '第二段\n第一段')).toBe(false);
    expect(zhProof('Kubernetes 很穩。', 'Kubernetes 很穩。 ')).toBe(false);
  });

  it('treats an unchanged file as link-only', () => {
    expect(zhProof('Kubernetes 很穩。', 'Kubernetes 很穩。')).toBe(true);
  });

  it.each([
    ['literal brackets around the term', '[Kubernetes] 是括號裡的字。'],
    ['a bracket left open in inline code', '用 `arr[` 開頭的 Kubernetes'],
  ])('accepts a new link after a bracket that opens no link: %s', (_name, before) => {
    expect(zhProof(before, wrapFirstKubernetes(before))).toBe(true);
  });
});

describe('link-only proof: correcting existing links', () => {
  it('accepts a case fix that keeps the original link text', () => {
    expect(
      zhProof(
        '詳見 [glossary 有完整拆解](/glossary#Codex)。',
        '詳見 [glossary 有完整拆解](/glossary#codex)。'
      )
    ).toBe(true);
    expect(
      zhProof(
        '[agentic coding](/glossary#Agent) 的世界',
        '[agentic coding](/glossary#agent) 的世界'
      )
    ).toBe(true);
  });

  it('accepts removing a link to an anchor that does not exist', () => {
    expect(zhProof('[Opus](/glossary#Opus) 負責想。', 'Opus 負責想。')).toBe(true);
  });

  it('accepts moving an English post link to the English glossary', () => {
    expect(
      enProof(
        'One [Agent](/glossary#agent) is not enough.',
        'One [Agent](/en/glossary#agent) is not enough.'
      )
    ).toBe(true);
  });

  it('accepts retargeting an internal post link to a validated canonical post', () => {
    expect(
      zhProof(
        '延伸閱讀：[GP-53: 舊標題](/posts/gp-53-old/)',
        `延伸閱讀：[${POST_LABEL}](${POST_URL})`
      )
    ).toBe(true);
    expect(
      zhProof(
        '延伸閱讀：[GP-53: 舊標題](/posts/gp-53-old/)',
        '延伸閱讀：[GP-54: 隨便](/posts/gp-54-x/)'
      )
    ).toBe(false);
  });
});

describe('link-only proof: edits riding along with link maintenance', () => {
  it('rejects a prose edit next to a valid new link', () => {
    expect(
      zhProof(
        'Kubernetes 會把狀態拉回來。',
        '[Kubernetes](/glossary#kubernetes) 會自動把狀態拉回來。'
      )
    ).toBe(false);
  });

  it('rejects a frontmatter edit next to a valid new link', () => {
    expect(
      zhProof(
        'Kubernetes 會把狀態拉回來。',
        '[Kubernetes](/glossary#kubernetes) 會把狀態拉回來。',
        'ticketId: "MP-212"\ntitle: "舊文的舊標題"\nlang: "zh-tw"'
      )
    ).toBe(false);
  });

  it('rejects swapping a link in frontmatter for a faked post link placeholder', () => {
    // Frontmatter only goes through the source comparison, where the fake would strip to the
    // same text as the internal post link it replaced.
    const withSummary = (summary: string) => `${LEGACY_FRONTMATTER}\nsummary: "${summary}"`;
    expect(
      proof.isLinkOnlyChange(
        post('正文', withSummary(`看 [${POST_LABEL}](${POST_URL})`)),
        post('正文', withSummary('看 \uE000INTERNAL_POST_LINK\uE001')),
        { filePath: ZH_FILE, glossary, validatePostLink }
      )
    ).toBe(false);
  });
});

describe('link-only proof: links that point at the wrong place', () => {
  const withPostLink = (link: string) => [
    `Kubernetes 很穩。\n延伸閱讀：[GP-53: 舊標題](/posts/gp-53-old/)`,
    `${link} 很穩。\n延伸閱讀：[${POST_LABEL}](${POST_URL})`,
  ];

  it.each([
    ['a missing anchor', '[Kubernetes](/glossary#kube)'],
    ['a case-mismatched anchor', '[Kubernetes](/glossary#Kubernetes)'],
    ['the other language path', '[Kubernetes](/en/glossary#kubernetes)'],
  ])('rejects %s even beside a valid internal post link', (_name, link) => {
    const [before, after] = withPostLink(link);
    expect(zhProof(before, after)).toBe(false);
  });

  it('rejects a new link to an entry with automatic linking disabled', () => {
    expect(zhProof('Thread 一直開著。', '[Thread](/glossary#thread) 一直開著。')).toBe(false);
  });

  it('rejects an English post linking the zh-tw glossary', () => {
    expect(enProof('Kubernetes is steady.', '[Kubernetes](/glossary#kubernetes) is steady.')).toBe(
      false
    );
  });
});

describe('link-only proof: links where the checker would never put one', () => {
  it.each([
    [
      'a fenced code block',
      '```txt\nKubernetes\n```',
      '```txt\n[Kubernetes](/glossary#kubernetes)\n```',
    ],
    ['inline code', '執行 `Kubernetes` 指令。', '執行 `[Kubernetes](/glossary#kubernetes)` 指令。'],
    [
      'a JSX attribute',
      '<Figure caption="Kubernetes" />',
      '<Figure caption="[Kubernetes](/glossary#kubernetes)" />',
    ],
    [
      'an inline JSX attribute',
      '看 <Badge label="Kubernetes" /> 這個。',
      '看 <Badge label="[Kubernetes](/glossary#kubernetes)" /> 這個。',
    ],
  ])('rejects a new link inside %s', (_name, before, after) => {
    expect(zhProof(before, after)).toBe(false);
  });

  // openspec〈只改連結的證明 SHALL 確認文章解析出來的結構沒有其他變化〉「其他寫法的 code 與 MDX 區塊」
  it.each([
    ['a ~~~ code block', '~~~yaml\nkind: Kubernetes\n~~~'],
    ['a code block wrapped in a longer fence', '````md\n```yaml\nKubernetes\n```\n````'],
    ['inline code that wraps onto the next line', '用 `kubectl 管\nKubernetes` 叢集'],
    ['an MDX expression', '看 {"Kubernetes"} 這段'],
    ['a tag whose attributes span lines', '<div\n  title="Kubernetes"\n>\n內容\n</div>'],
  ])('rejects a new link inside %s', (_name, before) => {
    expect(zhProof(before, wrapFirstKubernetes(before))).toBe(false);
  });

  it('rejects a new link inside frontmatter', () => {
    expect(
      proof.isLinkOnlyChange(
        post('正文', 'ticketId: "MP-212"\nsummary: "Kubernetes 入門"\nlang: "zh-tw"'),
        post(
          '正文',
          'ticketId: "MP-212"\nsummary: "[Kubernetes](/glossary#kubernetes) 入門"\nlang: "zh-tw"'
        ),
        { filePath: ZH_FILE, glossary, validatePostLink }
      )
    ).toBe(false);
  });

  it('rejects unwrapping link syntax inside code', () => {
    expect(zhProof('範例：`[Agent](/glossary#agent)`', '範例：`Agent`')).toBe(false);
  });
});

describe('link-only proof: links that change how the post renders', () => {
  // openspec〈只改連結的證明 SHALL 確認文章解析出來的結構沒有其他變化〉
  it.each([
    ['splits the bold around it', '這是**Kubernetes**的核心'],
    ['lands inside a link whose text wraps', '[看看\nKubernetes 文件](https://example.com)'],
    ['follows a backslash', '路徑是 C:\\Kubernetes 底下'],
  ])('rejects a new link that %s', (_name, before) => {
    expect(zhProof(before, wrapFirstKubernetes(before))).toBe(false);
  });

  it('rejects unwrapping a link that had broken the bold, which brings the bold back', () => {
    expect(zhProof(`這是**${K8S_LINK}**的核心`, '這是**Kubernetes**的核心')).toBe(false);
  });

  it('rejects an anchor fix on link syntax a backslash keeps as visible text', () => {
    expect(
      zhProof(
        '路徑是 C:\\[Kubernetes](/glossary#Kubernetes) 底下',
        '路徑是 C:\\[Kubernetes](/glossary#kubernetes) 底下'
      )
    ).toBe(false);
  });

  it('rejects a post whose body does not parse', () => {
    expect(zhProof('<div\nKubernetes 很穩。', `<div\n${K8S_LINK} 很穩。`)).toBe(false);
  });
});

describe('link-only proof: what the fixer writes', () => {
  // openspec「第一次出現的位置不能放連結」：修正器改連下一處，檢查器與證明都接受。
  it.each([
    [
      'glued to bold',
      '這是**Kubernetes**的核心。\n之後 Kubernetes 會把狀態拉回來。',
      `這是**Kubernetes**的核心。\n之後 ${K8S_LINK} 會把狀態拉回來。`,
    ],
    [
      'the text of a reference link',
      '先看 [Kubernetes 文件][k8s]。\n之後 Kubernetes 很穩。\n\n[k8s]: https://kubernetes.io',
      `先看 [Kubernetes 文件][k8s]。\n之後 ${K8S_LINK} 很穩。\n\n[k8s]: https://kubernetes.io`,
    ],
  ])('links the next occurrence when the first one is %s', (_name, body, linked) => {
    const before = post(body);
    const fixed = fixer.applyLinksToContent(before, { filePath: ZH_FILE, glossary });

    expect(checker.checkContent(before, { filePath: ZH_FILE, glossary }).violations).toEqual([
      expect.objectContaining({ kind: 'missing-link', term: 'Kubernetes', line: 10 }),
    ]);
    expect(fixed.content).toBe(post(linked));
    expect(checker.checkContent(fixed.content, { filePath: ZH_FILE, glossary }).violations).toEqual(
      []
    );
    expect(
      proof.isLinkOnlyChange(before, fixed.content, {
        filePath: ZH_FILE,
        glossary,
        validatePostLink,
      })
    ).toBe(true);
  });

  // openspec〈只改連結的證明 SHALL 確認文章解析出來的結構沒有其他變化〉：檢查器要求的連結，
  // 修正器寫出來後證明放行；證明不收的位置，檢查器不要求。null 是哪裡都不能放。
  it.each([
    [
      'a full reference link',
      '先看 [Kubernetes 文件][k8s]。\n\n[k8s]: https://kubernetes.io',
      null,
    ],
    [
      'a collapsed reference link',
      '先看 [Kubernetes][]。\n\n[Kubernetes]: https://kubernetes.io',
      null,
    ],
    [
      'a shortcut reference link',
      '先看 [Kubernetes]。\n\n[Kubernetes]: https://kubernetes.io',
      null,
    ],
    ['a link definition', '[Kubernetes]: https://kubernetes.io\n\n正文。', null],
    ['a footnote', '正文[^Kubernetes]。\n\n[^Kubernetes]: 註解。', null],
    [
      'a link whose URL wraps to the next line',
      '[看 Kubernetes 文件](\nhttps://kubernetes.io)',
      null,
    ],
    ['an autolink with parentheses in its URL', '見 https://x.io/a_(b)/Kubernetes 吧', null],
    [
      'a fence that ends with its list item',
      '- 項目\n\n  ```js\n  x\n```\n\nKubernetes 在 fence 裡\n```',
      null,
    ],
    ['an export that spans lines', 'export const tags = [\n  "Kubernetes",\n]\n\n正文。', null],
    ['literal brackets', '[Kubernetes] 是括號裡的字。', `[${K8S_LINK}] 是括號裡的字。`],
    [
      'a shortcut reference right before the term',
      '見 [官方]Kubernetes 文件。\n\n[官方]: https://kubernetes.io',
      null,
    ],
    ['a glossary link glued before the term', '[Agent](/glossary#agent)Kubernetes 很穩。', null],
    ['a glossary link glued after the term', 'Kubernetes[代理](/glossary#agent) 很穩。', null],
    [
      'a glossary link a slash away',
      '[Agent](/glossary#agent)/Kubernetes 很穩。',
      `[Agent](/glossary#agent)/${K8S_LINK} 很穩。`,
    ],
  ])('agrees with the checker and the fixer on %s', (_name, body, linked) => {
    const before = post(body);
    const missing = checker.checkContent(before, { filePath: ZH_FILE, glossary }).violations;
    const fixed = fixer.applyLinksToContent(before, { filePath: ZH_FILE, glossary });

    if (linked === null) {
      for (let at = body.indexOf('Kubernetes'); at >= 0; at = body.indexOf('Kubernetes', at + 1)) {
        const wrapped = `${body.slice(0, at)}${K8S_LINK}${body.slice(at + 'Kubernetes'.length)}`;
        expect(zhProof(body, wrapped), wrapped).toBe(false);
      }
      expect(missing).toEqual([]);
      expect(fixed.changed).toBe(false);
    } else {
      expect(missing).toEqual([expect.objectContaining({ term: 'Kubernetes' })]);
      expect(fixed.content).toBe(post(linked));
      expect(
        proof.isLinkOnlyChange(before, fixed.content, {
          filePath: ZH_FILE,
          glossary,
          validatePostLink,
        })
      ).toBe(true);
    }
  });
});

describe('link-only proof: new link text must be the term', () => {
  it('rejects wrapping arbitrary words', () => {
    expect(zhProof('細節看這裡。', '細節看[這裡](/glossary#kubernetes)。')).toBe(false);
  });

  it('rejects wrapping an alias that is not a configured match', () => {
    expect(zhProof('K8s 很難。', '[K8s](/glossary#kubernetes) 很難。')).toBe(false);
  });

  it('rejects wrapping a term glued to other letters', () => {
    expect(zhProof('Kubernetesish 很難。', '[Kubernetes](/glossary#kubernetes)ish 很難。')).toBe(
      false
    );
  });
});
