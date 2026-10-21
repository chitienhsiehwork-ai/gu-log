/**
 * #1164 回歸測試：pre-commit 的 score floor 也要檢查改名的文章。
 *
 * 跟 hooks-integration.test.ts 一樣，在拋棄式 git repo 裡跑真的
 * scripts/hooks/pre-commit；假的 node 讓 score-floor-check.mjs 印出
 * sentinel 並 exit 1，所以看得到 floor 有沒有被叫到。
 */
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, createPreCommitFixtures } from './helpers/pre-commit-repo';
import { useTestTempDirectories } from './helpers/temp-directories';

const REPO_ROOT = path.resolve(__dirname, '..');
const { makeFakeRepo, makeScoreGateProbeEnv } = createPreCommitFixtures(useTestTempDirectories());

describe('pre-commit: score floor covers renamed posts (#1164)', () => {
  // 手寫／CCC 流程：PENDING 草稿先 commit（floor 跳過 PENDING），merge 前用
  // allocate-ticket 換號，git 把這次換號記成改名（R）。
  const body = Array.from({ length: 12 }, (_, i) => `ShroomDog 寫的第 ${i} 段正文。`).join('\n\n');
  const postText = (ticketId: string) =>
    `---\nticketId: "${ticketId}"\nlang: zh-tw\n---\n\n${body}\n`;

  function makeRepo(): string {
    const repo = makeFakeRepo();
    fs.mkdirSync(path.join(repo, 'src', 'data'));
    for (const manifest of ['post-versions.json', 'post-reader-revisions.json']) {
      fs.writeFileSync(path.join(repo, 'src', 'data', manifest), '{}\n');
    }
    return repo;
  }

  function stageRename(repo: string, from: string, to: string, ticketId: string): string {
    const posts = path.join(repo, 'src', 'content', 'posts');
    fs.writeFileSync(path.join(posts, from), postText(ticketId));
    commitAll(repo, 'seed post');
    execSync(`git mv src/content/posts/${from} src/content/posts/${to}`, { cwd: repo });
    return execSync('git diff --cached --name-status -M', { cwd: repo, encoding: 'utf-8' });
  }

  function runHook(repo: string) {
    return spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-commit')], {
      cwd: repo,
      env: makeScoreGateProbeEnv(),
      encoding: 'utf-8',
    });
  }

  it('gates the allocate-ticket swap commit that git records as a rename', () => {
    const repo = makeRepo();
    const scripts = path.join(repo, 'scripts');
    fs.mkdirSync(scripts);
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'allocate-ticket.mjs'),
      path.join(scripts, 'allocate-ticket.mjs')
    );
    fs.writeFileSync(path.join(scripts, 'validate-posts.mjs'), 'process.exit(0);\n');
    const counter = Object.fromEntries(['GP', 'MP', 'SD', 'Lv'].map((p) => [p, { next: 7 }]));
    fs.writeFileSync(path.join(scripts, 'article-counter.json'), `${JSON.stringify(counter)}\n`);
    const posts = path.join(repo, 'src', 'content', 'posts');
    fs.writeFileSync(path.join(posts, 'sd-pending-20261021-draft.mdx'), postText('SD-PENDING'));
    commitAll(repo, 'draft PENDING post');

    execSync(`"${process.execPath}" scripts/allocate-ticket.mjs SD`, { cwd: repo });
    execSync('git add -A', { cwd: repo });
    const staged = execSync('git diff --cached --name-status -M', { cwd: repo, encoding: 'utf-8' });
    expect(staged).toMatch(
      /^R\d+\tsrc\/content\/posts\/sd-pending-20261021-draft\.mdx\tsrc\/content\/posts\/sd-7-20261021-draft\.mdx$/m
    );

    const r = runHook(repo);
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
    expect(r.status).toBe(1);
  });

  it('keeps slug renames of an existing ticket and PENDING-to-PENDING renames exempt', () => {
    for (const [from, to, ticketId] of [
      ['sd-5-old-slug.mdx', 'sd-5-new-slug.mdx', 'SD-5'],
      ['sd-pending-old-slug.mdx', 'sd-pending-new-slug.mdx', 'SD-PENDING'],
    ]) {
      const repo = makeRepo();
      expect(stageRename(repo, from, to, ticketId)).toMatch(/^R\d+\t/m);

      const r = runHook(repo);
      expect(r.stdout + r.stderr).not.toContain('score-check-sentinel');
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
  });
});
