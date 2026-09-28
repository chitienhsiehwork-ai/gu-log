import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectRatchetInput,
  evaluateTakedownRatchet,
} from '../scripts/check-takedown-ratchet.mjs';
import {
  POLICY,
  parseFrontmatter,
  segmentGuide,
  subjectFingerprint,
  writeStamp,
} from '../scripts/lib/source-distance.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });

const tombstone = (ticketId: string, sourceUrl: string, body = '') =>
  [
    '---',
    `ticketId: "${ticketId}"`,
    'title: "標題"',
    `sourceUrl: "${sourceUrl}"`,
    'summary: "這篇翻譯已下架。"',
    'status: "taken-down"',
    'takenDownAt: "2026-09-27"',
    'sourceTitle: "Source title"',
    '---',
    body,
  ].join('\n');

const livePost = (ticketId: string, sourceUrl: string, extra: string[] = []) =>
  [
    '---',
    `ticketId: "${ticketId}"`,
    'title: "新文章"',
    `sourceUrl: "${sourceUrl}"`,
    'summary: "摘要"',
    ...extra,
    '---',
    '正文 (◕‿◕)',
    '',
  ].join('\n');

const GP35 = 'src/content/posts/gp-35-20260206-agent-teams.mdx';
const GP35_URL = 'https://code.claude.com/docs/en/agent-teams';

/** A post with a valid source-distance stamp (openspec source-distance-stamp). */
function stamped(content: string) {
  const data = parseFrontmatter(content);
  const english = data.lang === 'en';
  return writeStamp(content, {
    policy: POLICY.version,
    verdict: 'PASS',
    subjectSha256: subjectFingerprint(data.sourceUrl, segmentGuide(content)),
    sourceSha256: 'a'.repeat(64),
    sourceUnits: 120,
    metrics: english
      ? { ngramContainment: 0, maxVerbatimWords: 0, quotedWords: 0 }
      : { maxRun: 1, sourceRatio: 0.05, alignedSentences: 1 },
    ...(english ? {} : { aligner: 'claude-sonnet-5', rewrites: 0, alignerCalls: 2 }),
    checkedAt: '2026-09-28',
  });
}

function baseInput(overrides: Partial<Parameters<typeof evaluateTakedownRatchet>[0]> = {}) {
  return {
    baseTakenDown: [{ path: GP35, content: tombstone('GP-35', GP35_URL) }],
    headContents: new Map([[GP35, tombstone('GP-35', GP35_URL)]]),
    addedPosts: [],
    headTakenDown: [{ path: GP35, content: tombstone('GP-35', GP35_URL) }],
    addedSourcePaths: [],
    ...overrides,
  };
}

describe('takedown ratchet — pure rules (post-takedown design D8)', () => {
  it('passes when every tombstone stays a tombstone', () => {
    expect(evaluateTakedownRatchet(baseInput())).toEqual([]);
  });

  it('blocks writing the article back, reviving the status, or deleting the tombstone', () => {
    const rewritten = evaluateTakedownRatchet(
      baseInput({
        headContents: new Map([[GP35, tombstone('GP-35', GP35_URL, '整篇譯文又回來了\n')]]),
      })
    );
    expect(rewritten.join('\n')).toMatch(/body must stay empty/);

    const revived = evaluateTakedownRatchet(
      baseInput({
        headContents: new Map([
          [GP35, tombstone('GP-35', GP35_URL).replace('"taken-down"', '"published"')],
        ]),
      })
    );
    expect(revived.join('\n')).toMatch(/cannot change status to "published"/);

    const deleted = evaluateTakedownRatchet(baseInput({ headContents: new Map([[GP35, null]]) }));
    expect(deleted.join('\n')).toMatch(/was deleted or renamed/);
  });

  it('no longer refuses new GP posts for being GP', () => {
    const errors = evaluateTakedownRatchet(
      baseInput({
        addedPosts: [
          {
            path: 'src/content/posts/gp-pending-x.mdx',
            content: livePost('GP-PENDING', 'https://a.example/1'),
          },
          {
            path: 'src/content/posts/gp-400-x.mdx',
            content: livePost('GP-400', 'https://a.example/2'),
          },
        ],
      })
    );
    expect(errors).toEqual([]);
  });

  it('blocks a new post that reuses a taken-down source (URL, share link, tweet or video ID)', () => {
    const tweetTombstone = 'src/content/posts/gp-50-x.mdx';
    const errors = evaluateTakedownRatchet(
      baseInput({
        headTakenDown: [
          { path: GP35, content: tombstone('GP-35', GP35_URL) },
          {
            path: tweetTombstone,
            content: tombstone('GP-50', 'https://x.com/karpathy/status/12345'),
          },
          {
            path: 'src/content/posts/gp-88-video.mdx',
            content: tombstone('GP-88', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
          },
          {
            path: 'src/content/posts/mp-114-nyt.mdx',
            content: tombstone('MP-114', 'https://www.nytimes.com/2026/02/23/opinion/ai.html'),
          },
        ],
        addedPosts: [
          {
            path: 'src/content/posts/mp-500-a.mdx',
            content: livePost('MP-500', `${GP35_URL}/?utm_source=x`),
          },
          {
            path: 'src/content/posts/mp-501-b.mdx',
            content: livePost('MP-501', 'https://twitter.com/karpathy/status/12345'),
          },
          {
            path: 'src/content/posts/mp-502-c.mdx',
            content: livePost('MP-502', 'https://fresh.example/post'),
          },
          {
            path: 'src/content/posts/mp-503-d.mdx',
            content: livePost('MP-503', 'https://youtu.be/dQw4w9WgXcQ'),
          },
          {
            path: 'src/content/posts/mp-504-e.mdx',
            content: livePost(
              'MP-504',
              'https://nytimes.com/2026/02/23/opinion/ai.html?smid=url-share'
            ),
          },
        ],
      })
    );
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/mp-500-a\.mdx: source is blocked .* taken down as GP-35/);
    expect(errors[1]).toMatch(/mp-501-b\.mdx: source is blocked .* taken down as GP-50/);
    expect(errors[2]).toMatch(
      /mp-503-d\.mdx: source is blocked .* taken down as GP-88 \(YouTube video ID match/
    );
    expect(errors[3]).toMatch(/mp-504-e\.mdx: source is blocked .* taken down as MP-114/);
  });

  it('lets a stamped GP reading guide and its English version reuse a source taken down only as GP', () => {
    const zh = stamped(livePost('GP-400', `${GP35_URL}/`));
    const en = stamped(livePost('GP-400', GP35_URL, ['lang: "en"']));
    const input = baseInput({
      addedPosts: [
        { path: 'src/content/posts/gp-400-guide.mdx', content: zh },
        { path: 'src/content/posts/en-gp-400-guide.mdx', content: en },
      ],
    });
    expect(evaluateTakedownRatchet(input)).toEqual([]);
    // 那篇下架文章維持原狀，棘輪照樣守著它。
    expect(input.headContents.get(GP35)).toBe(tombstone('GP-35', GP35_URL));

    // 沒帶章、章過期、或不是 GP，都照樣封鎖。
    const unstamped = evaluateTakedownRatchet(
      baseInput({
        addedPosts: [
          { path: 'src/content/posts/gp-401-guide.mdx', content: livePost('GP-401', GP35_URL) },
          {
            path: 'src/content/posts/gp-402-guide.mdx',
            content: zh.replace('正文 (◕‿◕)', '改過的正文'),
          },
          {
            path: 'src/content/posts/mp-400-guide.mdx',
            content: livePost('MP-400', GP35_URL),
          },
        ],
      })
    );
    expect(unstamped).toHaveLength(3);
    expect(unstamped[0]).toMatch(
      /gp-401-guide\.mdx: source is blocked .*only with a valid sourceDistance stamp/
    );
    expect(unstamped[1]).toMatch(/gp-402-guide\.mdx: source is blocked/);
    expect(unstamped[2]).toMatch(/mp-400-guide\.mdx: source is blocked .* taken down as GP-35/);
  });

  it('blocks a stamped GP reading guide when the source was also taken down as MP', () => {
    const MP114 = 'src/content/posts/mp-114-agent-teams.mdx';
    const errors = evaluateTakedownRatchet(
      baseInput({
        headTakenDown: [
          { path: GP35, content: tombstone('GP-35', GP35_URL) },
          { path: MP114, content: tombstone('MP-114', `${GP35_URL}?ref=feed`) },
        ],
        addedPosts: [
          {
            path: 'src/content/posts/gp-400-guide.mdx',
            content: stamped(livePost('GP-400', GP35_URL)),
          },
        ],
      })
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/gp-400-guide\.mdx: source is blocked .* taken down as MP-114/);
    expect(errors[0]).not.toMatch(/GP-35/);
  });

  it('blocks an existing post whose sourceUrl moves to a taken-down source', () => {
    const errors = evaluateTakedownRatchet(
      baseInput({
        changedSourcePosts: [
          {
            path: 'src/content/posts/mp-7-existing.mdx',
            content: livePost('MP-7', `${GP35_URL}?utm_medium=share`),
          },
        ],
      })
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/mp-7-existing\.mdx: source is blocked .* taken down as GP-35/);
  });

  it('only lets sources/chatgpt/ grow', () => {
    const errors = evaluateTakedownRatchet(
      baseInput({
        addedSourcePaths: ['sources/chatgpt/2026-09-27-idea.md', 'sources/x/thread.md'],
      })
    );
    expect(errors).toEqual([
      'sources/x/thread.md: third-party source captures stay outside the repo; only sources/chatgpt/ may grow',
    ]);
  });
});

describe('takedown ratchet — git adapter', () => {
  const run = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  function repoWithTombstone() {
    const cwd = makeTempDirectory('gu-log-ratchet-');
    run(cwd, ['init', '-q', '-b', 'main']);
    run(cwd, ['config', 'user.email', 'test@example.com']);
    run(cwd, ['config', 'user.name', 'Ratchet Test']);
    fs.mkdirSync(path.join(cwd, 'src/content/posts'), { recursive: true });
    fs.writeFileSync(path.join(cwd, GP35), tombstone('GP-35', GP35_URL));
    fs.writeFileSync(
      path.join(cwd, 'src/content/posts/gp-1-demo.mdx'),
      livePost('GP-1', 'https://example.com/demo')
    );
    run(cwd, ['add', '-A']);
    run(cwd, ['commit', '-q', '-m', 'base']);
    return cwd;
  }

  it('reads HEAD → index for pre-commit', () => {
    const cwd = repoWithTombstone();
    fs.writeFileSync(path.join(cwd, GP35), tombstone('GP-35', GP35_URL, '寫回的全文\n'));
    fs.mkdirSync(path.join(cwd, 'sources/x'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'sources/x/capture.md'), 'third-party text\n');
    fs.writeFileSync(
      path.join(cwd, 'src/content/posts/mp-9-blocked.mdx'),
      livePost('MP-9', GP35_URL)
    );
    run(cwd, ['add', '-A']);

    const input = collectRatchetInput({ mode: 'staged', cwd });
    expect(input.baseTakenDown.map((post: { path: string }) => post.path)).toEqual([GP35]);
    const errors = evaluateTakedownRatchet(input);
    expect(errors.join('\n')).toMatch(
      /gp-35-20260206-agent-teams\.mdx: taken-down post body must stay empty/
    );
    expect(errors.join('\n')).toMatch(/mp-9-blocked\.mdx: source is blocked/);
    expect(errors.join('\n')).toMatch(/sources\/x\/capture\.md: third-party source captures/);
  });

  it('reads base...HEAD for CI', () => {
    const cwd = repoWithTombstone();
    const base = run(cwd, ['rev-parse', 'HEAD']).trim();
    fs.rmSync(path.join(cwd, GP35));
    fs.writeFileSync(
      path.join(cwd, 'src/content/posts/gp-400-new.mdx'),
      livePost('GP-400', 'https://fresh.example/new')
    );
    // 既有文章改用下架文章的來源；只改正文、不動 sourceUrl 的不算。
    fs.writeFileSync(path.join(cwd, 'src/content/posts/gp-1-demo.mdx'), livePost('GP-1', GP35_URL));
    run(cwd, ['add', '-A']);
    run(cwd, ['commit', '-q', '-m', 'head']);

    const input = collectRatchetInput({ mode: 'range', base, cwd });
    expect(input.changedSourcePosts.map((post: { path: string }) => post.path)).toEqual([
      'src/content/posts/gp-1-demo.mdx',
    ]);
    const errors = evaluateTakedownRatchet(input);
    expect(errors.join('\n')).toMatch(
      /gp-35-20260206-agent-teams\.mdx: taken-down post was deleted/
    );
    expect(errors.join('\n')).not.toMatch(/gp-400-new\.mdx/);
  });

  it('does not re-check an existing post whose sourceUrl stayed the same', () => {
    const cwd = repoWithTombstone();
    const base = run(cwd, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(
      path.join(cwd, 'src/content/posts/gp-1-demo.mdx'),
      livePost('GP-1', 'https://example.com/demo').replace('正文', '改過的正文')
    );
    run(cwd, ['add', '-A']);
    run(cwd, ['commit', '-q', '-m', 'body edit']);
    expect(collectRatchetInput({ mode: 'range', base, cwd }).changedSourcePosts).toEqual([]);
  });
});
