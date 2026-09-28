import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectRatchetInput,
  evaluateTakedownRatchet,
} from '../scripts/check-takedown-ratchet.mjs';
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

function baseInput(overrides: Partial<Parameters<typeof evaluateTakedownRatchet>[0]> = {}) {
  return {
    baseTakenDown: [{ path: GP35, content: tombstone('GP-35', GP35_URL) }],
    headContents: new Map([[GP35, tombstone('GP-35', GP35_URL)]]),
    addedPosts: [],
    headTakenDown: [{ path: GP35, content: tombstone('GP-35', GP35_URL) }],
    addedSourcePaths: [],
    baseTicketIds: new Set(['GP-1', 'GP-35', 'MP-7']),
    gpPaused: true,
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

  it('blocks new GP posts while GP is paused, but not renames of existing tickets', () => {
    const newGp = evaluateTakedownRatchet(
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
    expect(newGp.filter((error) => error.includes('new GP posts are paused'))).toHaveLength(2);

    const existingTicket = evaluateTakedownRatchet(
      baseInput({
        addedPosts: [
          {
            path: 'src/content/posts/gp-1-renamed.mdx',
            content: livePost('GP-1', 'https://example.com/demo'),
          },
        ],
      })
    );
    expect(existingTicket).toEqual([]);

    const unpaused = evaluateTakedownRatchet(
      baseInput({
        gpPaused: false,
        addedPosts: [
          {
            path: 'src/content/posts/gp-400-x.mdx',
            content: livePost('GP-400', 'https://a.example/2'),
          },
        ],
      })
    );
    expect(unpaused).toEqual([]);
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
    expect([...input.baseTicketIds].sort()).toEqual(['GP-1', 'GP-35']);
    const errors = evaluateTakedownRatchet({ ...input, gpPaused: true });
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
    run(cwd, ['add', '-A']);
    run(cwd, ['commit', '-q', '-m', 'head']);

    const errors = evaluateTakedownRatchet({
      ...collectRatchetInput({ mode: 'range', base, cwd }),
      gpPaused: true,
    });
    expect(errors.join('\n')).toMatch(
      /gp-35-20260206-agent-teams\.mdx: taken-down post was deleted/
    );
    expect(errors.join('\n')).toMatch(/gp-400-new\.mdx: new GP posts are paused/);
  });
});
