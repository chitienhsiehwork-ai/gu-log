import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function copySetupFixture(repo: string): void {
  const scriptsDir = path.join(repo, 'scripts');
  const hooksDir = path.join(scriptsDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(path.join(repo, '.githooks'));

  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'setup-hooks.sh'),
    path.join(scriptsDir, 'setup-hooks.sh')
  );
  fs.chmodSync(path.join(scriptsDir, 'setup-hooks.sh'), 0o755);

  for (const hook of fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'hooks'))) {
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'hooks', hook), path.join(hooksDir, hook));
  }
}

describe('setup-hooks linked-worktree isolation', () => {
  it('keeps hooksPath per-worktree while merge drivers remain clone-scoped', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-setup-hooks-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    copySetupFixture(repo);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'setup fixture');

    const worktrees = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-linked-worktrees-'));
    const first = path.join(worktrees, 'first');
    const second = path.join(worktrees, 'second');
    git(repo, 'worktree', 'add', '-q', '-b', 'test-first', first, 'HEAD');
    git(repo, 'worktree', 'add', '-q', '-b', 'test-second', second, 'HEAD');

    const commonDir = path.resolve(repo, git(repo, 'rev-parse', '--git-common-dir'));
    const commonConfig = path.join(commonDir, 'config');
    const legacySharedHooksPath = path.join(git(first, 'rev-parse', '--absolute-git-dir'), 'hooks');
    git(repo, 'config', '--file', commonConfig, 'core.hooksPath', legacySharedHooksPath);
    expect(git(repo, 'config', '--file', commonConfig, '--get', 'core.hooksPath')).toBe(
      legacySharedHooksPath
    );

    execFileSync('bash', ['scripts/setup-hooks.sh'], { cwd: first });
    const firstHooksPath = git(first, 'config', '--worktree', '--get', 'core.hooksPath');

    const migratedCommonHooksPath = spawnSync(
      'git',
      ['config', '--file', commonConfig, '--get', 'core.hooksPath'],
      { encoding: 'utf-8' }
    );
    expect(migratedCommonHooksPath.status).toBe(1);

    execFileSync('bash', ['scripts/setup-hooks.sh'], { cwd: second });
    const secondHooksPath = git(second, 'config', '--worktree', '--get', 'core.hooksPath');

    expect(firstHooksPath).toBe(path.join(git(first, 'rev-parse', '--absolute-git-dir'), 'hooks'));
    expect(secondHooksPath).toBe(
      path.join(git(second, 'rev-parse', '--absolute-git-dir'), 'hooks')
    );
    expect(firstHooksPath).not.toBe(secondHooksPath);
    expect(git(first, 'config', '--worktree', '--get', 'core.hooksPath')).toBe(firstHooksPath);

    const commonHooksPath = spawnSync(
      'git',
      ['config', '--file', commonConfig, '--get', 'core.hooksPath'],
      { encoding: 'utf-8' }
    );
    expect(commonHooksPath.status).toBe(1);

    for (const [worktree, hooksPath] of [
      [first, firstHooksPath],
      [second, secondHooksPath],
    ]) {
      expect(fs.readFileSync(path.join(hooksPath, 'pre-commit'), 'utf-8')).toBe(
        fs.readFileSync(path.join(worktree, 'scripts', 'hooks', 'pre-commit'), 'utf-8')
      );
    }

    expect(
      git(
        repo,
        'config',
        '--file',
        path.join(commonDir, 'config'),
        '--get',
        'merge.post-versions-regen.driver'
      )
    ).toBe('scripts/merge-post-versions.sh %O %A %B %P');
    expect(
      git(
        repo,
        'config',
        '--file',
        path.join(commonDir, 'config'),
        '--get',
        'merge.article-counter-max.driver'
      )
    ).toBe('scripts/merge-article-counter.sh %O %A %B %P');
  });
});
