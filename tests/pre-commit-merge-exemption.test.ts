/**
 * #1164 回歸測試：pre-commit 的 merge 豁免在 linked worktree 也要成立。
 *
 * linked worktree 的 `.git` 是一個檔案，MERGE_HEAD 放在主 repo 的
 * `.git/worktrees/<名稱>/` 底下。豁免條件如果寫死成 `$REPO_ROOT/.git/MERGE_HEAD`，
 * 在 worktree 解完衝突 commit 時就永遠不成立，另一條 branch 帶進來、早就在來源
 * branch 通過 gate 的文章會被 score gate 再擋一次。假的 node 讓 score-floor-check.mjs 印出
 * sentinel 並 exit 1，看得到 score gate 有沒有被叫到。
 */
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, createPreCommitFixtures } from './helpers/pre-commit-repo';
import { useTestTempDirectories } from './helpers/temp-directories';

const makeTempDirectory = useTestTempDirectories();
const { makeFakeRepo, makeScoreGateProbeEnv } = createPreCommitFixtures(makeTempDirectory);
const POST = path.join('src', 'content', 'posts', 'sd-5-20260101-legacy.mdx');

const git = (cwd: string, cmd: string) => execSync(`git ${cmd}`, { cwd, encoding: 'utf-8' }).trim();

function writePost(repo: string, body: string) {
  fs.writeFileSync(path.join(repo, POST), `---\nticketId: "SD-5"\nlang: zh-tw\n---\n\n${body}\n`);
}

/** 主 checkout 留在預設 branch，另開一個 linked worktree 在 feature branch。 */
function seedRepoWithWorktree() {
  const repo = makeFakeRepo();
  fs.mkdirSync(path.join(repo, 'src', 'data'));
  for (const manifest of ['post-versions.json', 'post-reader-revisions.json']) {
    fs.writeFileSync(path.join(repo, 'src', 'data', manifest), '{}\n');
  }
  writePost(repo, '舊版正文，當初在來源 branch 上就通過 gate。');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'base\n');
  commitAll(repo, 'seed');

  const worktree = path.join(makeTempDirectory('gu-log-hook-wt-'), 'feature');
  git(repo, `worktree add -q -b feature "${worktree}"`);
  return { repo, worktree };
}

function commitThroughHook(cwd: string, hooksRepo: string) {
  const r = spawnSync(
    'git',
    ['-c', `core.hooksPath=${path.join(hooksRepo, '.githooks')}`, 'commit', '-q', '--no-edit'],
    { cwd, env: makeScoreGateProbeEnv(), encoding: 'utf-8' }
  );
  return { status: r.status, output: r.stdout + r.stderr };
}

describe('pre-commit: merge exemption works in every checkout (#1164)', () => {
  it.each(['linked worktree', 'main checkout'])(
    'skips content gates when finishing a conflicted merge in a %s',
    (where) => {
      const { repo, worktree } = seedRepoWithWorktree();
      const [into, from] = where === 'linked worktree' ? [worktree, repo] : [repo, worktree];
      expect(fs.statSync(path.join(into, '.git')).isFile()).toBe(where === 'linked worktree');

      // 被合進來的那邊改了文章正文（reader-visible），兩邊都改 notes.txt 製造衝突。
      writePost(from, '新版正文，已在來源 branch 上過完 Tribunal。');
      fs.writeFileSync(path.join(from, 'notes.txt'), 'incoming side\n');
      commitAll(from, 'rewrite post on the incoming branch');
      fs.writeFileSync(path.join(into, 'notes.txt'), 'receiving side\n');
      commitAll(into, 'receiving branch change');

      const branch = git(from, 'rev-parse --abbrev-ref HEAD');
      const merge = spawnSync('git', ['merge', '-q', branch], { cwd: into, encoding: 'utf-8' });
      expect(merge.status, 'notes.txt 應該衝突').not.toBe(0);
      fs.writeFileSync(path.join(into, 'notes.txt'), 'incoming side\nreceiving side\n');
      git(into, 'add notes.txt');
      expect(git(into, 'diff --cached --name-only')).toContain('sd-5-20260101-legacy.mdx');

      const r = commitThroughHook(into, repo);
      expect(r.status, r.output).toBe(0);
      expect(r.output).toContain('merge commit detected');
      expect(r.output).not.toContain('score-check-sentinel');
      expect(git(into, 'rev-list --parents -n 1 HEAD').split(' ')).toHaveLength(3);
    }
  );

  it('still gates the same post change as an ordinary commit in a linked worktree', () => {
    const { repo, worktree } = seedRepoWithWorktree();
    writePost(worktree, '在 worktree 裡直接改寫的正文。');
    git(worktree, 'add -A');

    const r = commitThroughHook(worktree, repo);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('score-check-sentinel');
    expect(r.output).not.toContain('merge commit detected');
  });
});
