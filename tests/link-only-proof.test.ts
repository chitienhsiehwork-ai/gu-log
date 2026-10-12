import { describe, expect, it } from 'vitest';
import * as proofModule from '../scripts/lib/link-only-proof.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
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
const POST_LABEL = 'MP-316: 目標文章';
const POST_URL = '/posts/mp-316-target/';

function post(body: string, frontmatter = LEGACY_FRONTMATTER): string {
  return `---\n${frontmatter}\n---\n\nimport MoguNote from '../../components/MoguNote.astro';\n\n${body}\n`;
}

function validatePostLink(label: string, href: string): void {
  if (label !== POST_LABEL || href !== POST_URL) throw new Error('not the canonical target');
}

function zhProof(before: string, after: string, beforeFrontmatter?: string): boolean {
  return proof.isLinkOnlyChange(post(before, beforeFrontmatter), post(after), {
    filePath: 'src/content/posts/mp-212-legacy.mdx',
    glossary,
    validatePostLink,
  });
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

  it('rejects a new link inside frontmatter', () => {
    expect(
      proof.isLinkOnlyChange(
        post('正文', 'ticketId: "MP-212"\nsummary: "Kubernetes 入門"\nlang: "zh-tw"'),
        post(
          '正文',
          'ticketId: "MP-212"\nsummary: "[Kubernetes](/glossary#kubernetes) 入門"\nlang: "zh-tw"'
        ),
        { filePath: 'src/content/posts/mp-212-legacy.mdx', glossary, validatePostLink }
      )
    ).toBe(false);
  });

  it('rejects unwrapping link syntax inside code', () => {
    expect(zhProof('範例：`[Agent](/glossary#agent)`', '範例：`Agent`')).toBe(false);
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
