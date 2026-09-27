import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  cleanMetadataValue,
  extractHtmlMetadata,
  findOrphanAssetDirs,
  firstSentence,
  hostMatchesDomain,
  loadTakedownList,
  matchRule,
  planTakedown,
  readPosts,
  takeDownSource,
  tweetMetadata,
} from '../scripts/take-down-posts.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });

const LIST = {
  authorization: {
    by: 'ShroomDog（owner）',
    date: '2026-09-27',
    channel: 'chat',
    scope: '依規則下架',
  },
  rules: [
    {
      id: 'gp-all',
      series: 'GP',
      excludeTickets: [{ ticketId: 'GP-1', reason: '自寫示範文' }],
    },
    {
      id: 'mp-paid-news-domain',
      series: 'MP',
      domains: [{ domain: 'nytimes.com' }, { domain: 'bloomberg.com' }],
    },
  ],
  boundaryCases: [{ ticketId: 'MP-72', category: 'source 欄提到' }],
};

function post(file: string, fields: Record<string, unknown>, body = '正文 (◕‿◕)\n') {
  const fm = Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  return `---\n${fm}\n---\n${body}`;
}

function writeCorpus(files: Record<string, string>) {
  const dir = makeTempDirectory('gu-log-takedown-tool-');
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

describe('takedown rules and plan', () => {
  it('refuses a batch without an owner authorization record', () => {
    const dir = makeTempDirectory('gu-log-takedown-list-');
    const listPath = path.join(dir, 'list.json');
    fs.writeFileSync(listPath, JSON.stringify({ ...LIST, authorization: { by: 'someone' } }));
    expect(() => loadTakedownList(listPath)).toThrow(/no owner authorization/);
    fs.writeFileSync(listPath, JSON.stringify(LIST));
    expect(loadTakedownList(listPath).rules).toHaveLength(2);
  });

  it('matches paid-news domains by sourceUrl host only, including subdomains', () => {
    expect(hostMatchesDomain('nytimes.com', 'nytimes.com')).toBe(true);
    expect(hostMatchesDomain('cooking.nytimes.com', 'nytimes.com')).toBe(true);
    expect(hostMatchesDomain('nytimes.com.example.io', 'nytimes.com')).toBe(false);
    expect(hostMatchesDomain('notnytimes.com', 'nytimes.com')).toBe(false);
    const mp = (sourceUrl: string, source = 'x') =>
      matchRule(LIST.rules, { ticketId: 'MP-9', sourceUrl, source });
    expect(mp('https://www.nytimes.com/2026/02/23/tech/ai.html')).toBe('mp-paid-news-domain');
    expect(mp('https://x.com/someone/status/1', 'Bloomberg 報導')).toBeNull();
    expect(
      matchRule(LIST.rules, { ticketId: 'GP-1', sourceUrl: 'https://example.com' })
    ).toBeNull();
    expect(
      matchRule(LIST.rules, { ticketId: 'SD-3', sourceUrl: 'https://nytimes.com' })
    ).toBeNull();
    expect(matchRule(LIST.rules, { ticketId: 'GP-2', sourceUrl: 'https://a.example' })).toBe(
      'gp-all'
    );
  });

  it('plans with lowercase canonical ids and keeps GP-1 public', () => {
    const dir = writeCorpus({
      'gp-1-20260128-demo.mdx': post('x', { ticketId: 'GP-1', sourceUrl: 'https://example.com' }),
      'gp-63-20260214-GP63-benson.mdx': post('x', {
        ticketId: 'GP-63',
        sourceUrl: 'https://x.com/benson/status/1',
      }),
      'en-gp-63-20260214-GP63-benson.mdx': post('x', {
        ticketId: 'GP-63',
        lang: 'en',
        sourceUrl: 'https://x.com/benson/status/1',
      }),
      'mp-114-20260223-paulford.mdx': post('x', {
        ticketId: 'MP-114',
        sourceUrl: 'https://www.nytimes.com/2026/02/23/opinion/ai.html',
      }),
      'mp-72-20260212-electricity.mdx': post('x', {
        ticketId: 'MP-72',
        source: 'Bloomberg 引述',
        sourceUrl: 'https://x.com/anthropic/status/2',
      }),
    });
    const plan = planTakedown({ list: LIST, posts: readPosts(dir) });
    expect(plan.posts.map((entry: { id: string }) => entry.id).sort()).toEqual([
      'en-gp-63-20260214-gp63-benson',
      'gp-63-20260214-gp63-benson',
      'mp-114-20260223-paulford',
    ]);
    expect(plan.counts).toMatchObject({
      files: 3,
      tickets: 2,
      byRule: {
        'gp-all': { tickets: 1, zh: 1, en: 1 },
        'mp-paid-news-domain': { tickets: 1, zh: 1, en: 0 },
      },
    });
  });

  it('fails when a recorded boundary case would be taken down by a rule', () => {
    const dir = writeCorpus({
      'mp-72-x.mdx': post('x', { ticketId: 'MP-72', sourceUrl: 'https://www.bloomberg.com/a' }),
    });
    expect(() => planTakedown({ list: LIST, posts: readPosts(dir) })).toThrow(/boundary cases/);
  });
});

describe('takeDownSource', () => {
  const original = [
    '---',
    'ticketId: "GP-35"',
    'title: "Agent Teams 深入解析"',
    'originalDate: "2026-02-05"',
    'translatedDate: "2026-02-06"',
    'translatedBy:',
    '  model: "Opus 4.6"',
    '  harness: "Claude Code"',
    'source: "Claude Code Docs"',
    'sourceUrl: "https://code.claude.com/docs/en/agent-teams"',
    'summary: >-',
    '  這是一段很長的譯文摘要，',
    '  橫跨兩行。',
    'lang: "zh-tw"',
    'tags: ["claude-code", "agent-teams"]',
    'status: "deprecated"',
    'deprecatedReason: "Duplicate of GP-105"',
    'deprecatedBy: "GP-105"',
    'sourceType: primary',
    'authorCanonical: anthropic',
    'scores:',
    '  vibe:',
    '    score: 8',
    '    date: "2026-03-01"',
    '---',
    '',
    "import MoguNote from '../../components/MoguNote.astro';",
    '',
    '## 譯文標題',
    '',
    '譯文段落 (◕‿◕)',
    '',
  ].join('\n');

  it('keeps every other field, neutralises the summary and empties the body', () => {
    const result = takeDownSource(original, {
      file: 'gp-35.mdx',
      date: '2026-09-27',
      sourceTitle: 'Orchestrate teams of Claude Code sessions',
      author: 'Anthropic',
    });
    expect(result.changed).toBe(true);
    expect(result.content.endsWith('---\n')).toBe(true);
    expect(result.content).not.toContain('譯文');
    const fm = parse(result.content.split('---\n')[1]);
    expect(fm).toMatchObject({
      ticketId: 'GP-35',
      title: 'Agent Teams 深入解析',
      translatedBy: { model: 'Opus 4.6', harness: 'Claude Code' },
      tags: ['claude-code', 'agent-teams'],
      sourceType: 'primary',
      authorCanonical: 'anthropic',
      scores: { vibe: { score: 8, date: '2026-03-01' } },
      summary: '這篇翻譯已下架。',
      status: 'taken-down',
      takenDownAt: '2026-09-27',
      sourceTitle: 'Orchestrate teams of Claude Code sessions',
      author: 'Anthropic',
    });
    expect(fm.deprecatedBy).toBeUndefined();
    expect(fm.deprecatedReason).toBeUndefined();
  });

  it('uses the series and language neutral sentence and adds status when absent', () => {
    const mpEn = post(
      'en-mp-114.mdx',
      {
        ticketId: 'MP-114',
        title: 'CEO confession',
        lang: 'en',
        sourceUrl: 'https://www.nytimes.com/a',
        summary: 'Old English summary',
      },
      'Body\n'
    );
    const result = takeDownSource(mpEn, {
      file: 'en-mp-114.mdx',
      date: '2026-09-27',
      sourceTitle: 'The Final Bottleneck',
    });
    const fm = parse(result.content.split('---\n')[1]);
    expect(fm.summary).toBe('This rewrite has been taken down.');
    expect(fm.status).toBe('taken-down');
    expect(fm.author).toBeUndefined();
  });

  it('is idempotent and refuses a sourceTitle equal to the gu-log title', () => {
    const once = takeDownSource(original, {
      file: 'gp-35.mdx',
      date: '2026-09-27',
      sourceTitle: 'Source',
    }).content;
    expect(
      takeDownSource(once, { file: 'gp-35.mdx', date: '2026-09-28', sourceTitle: 'Other' })
    ).toEqual({ changed: false, content: once });
    expect(() =>
      takeDownSource(original, {
        file: 'gp-35.mdx',
        date: '2026-09-27',
        sourceTitle: 'Agent Teams 深入解析',
      })
    ).toThrow(/must not be the gu-log title/);
    expect(() =>
      takeDownSource(original, { file: 'gp-35.mdx', date: '27/09/2026', sourceTitle: 'x' })
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe('source metadata helpers', () => {
  it('prefers og:title, decodes entities and keeps author names', () => {
    const html = `<html><head><title>Site | Page</title>
      <meta property="og:title" content="The human &amp; the loop">
      <meta name="author" content="Brent Fitzgerald"></head></html>`;
    expect(extractHtmlMetadata(html)).toEqual({
      title: 'The human & the loop',
      author: 'Brent Fitzgerald',
    });
    expect(extractHtmlMetadata('<title> Only\n title </title>')).toEqual({
      title: 'Only title',
      author: null,
    });
  });

  it('uses the X Article title, else the first sentence of the tweet', () => {
    expect(
      tweetMetadata({
        tweet: { article: { title: 'Long-form post' }, text: 'x', author: { name: 'A' } },
      })
    ).toEqual({ title: 'Long-form post', author: 'A' });
    expect(
      tweetMetadata({
        tweet: { text: 'Vibe coding is here. More below https://t.co/x', author: { name: 'K' } },
      })
    ).toEqual({ title: 'Vibe coding is here.', author: 'K' });
    expect([...firstSentence('a'.repeat(200))]).toHaveLength(80);
    expect(firstSentence('大家在服務器上部署。經常把它玩壞。')).toBe('大家在服務器上部署。');
    expect(firstSentence('Ship v1.2 today. Then rest.')).toBe('Ship v1.2 today.');
  });

  it('strips emoji, collapses whitespace and rejects the gu-log title', () => {
    expect(cleanMetadataValue('🚀 Ship   it 🎉 now')).toBe('Ship it now');
    expect(cleanMetadataValue('前端 &laquo; 鑫空間')).toBe('前端 « 鑫空間');
    expect(cleanMetadataValue('Introduction {#intro}')).toBe('Introduction');
    expect(cleanMetadataValue('Same title', { forbid: ['Same title'] })).toBeNull();
    expect(cleanMetadataValue('   ')).toBeNull();
    expect([...(cleanMetadataValue('b'.repeat(300)) ?? '')]).toHaveLength(160);
  });
});

describe('orphan post assets', () => {
  it('lists asset folders used only by taken-down posts', () => {
    const assetsDir = makeTempDirectory('gu-log-takedown-assets-');
    for (const dir of ['takedown-only-fixture', 'still-live-fixture']) {
      fs.mkdirSync(path.join(assetsDir, dir));
    }
    const posts = [
      {
        source: "import a from '../../assets/posts/takedown-only-fixture/a.png';",
        data: { status: 'taken-down' },
      },
      {
        source: "import b from '../../assets/posts/still-live-fixture/b.png';",
        data: { status: 'published' },
      },
    ];
    expect(findOrphanAssetDirs({ posts, assetsDir })).toEqual(['takedown-only-fixture']);
  });
});
