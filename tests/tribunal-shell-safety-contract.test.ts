import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useTestTempDirectories } from './helpers/temp-directories';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = path.join(ROOT, 'scripts/tests/test-tribunal-safety-contract.sh');
const RUNNER_ERROR_GUARD = path.join(ROOT, 'scripts/tests/test-tribunal-runner-error-guard.sh');
const DEPLOY_READINESS = path.join(ROOT, 'scripts/tests/test-tribunal-deploy-readiness.sh');
const RUN_CONTROL_CLAIMS = path.join(ROOT, 'scripts/tests/test-tribunal-run-control-claims.sh');
const linuxIt = process.platform === 'linux' ? it : it.skip;
const makeTempDirectory = useTestTempDirectories();

type ShellRun = { status: number | null; output: string; timedOut: boolean; restored: string[] };

// 跟 HEAD 不同的追蹤檔；不在 git checkout 裡就回 null，不做還原。
function changedTrackedFiles(root: string): Set<string> | null {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

// 這幾支 shell 測試會暫時改 repo 裡追蹤的文章（例如 SD-1 會被寫進 gpt-test 分數），
// 靠 EXIT trap 還原。逾時只能用 SIGKILL 砍（不然可能卡住），trap 不會跑；只砍 bash
// 的話，底下還在跑的 tribunal.sh 也會繼續寫檔。所以逾時就砍整個 process group，
// 等全部結束後，把「跑之前乾淨、跑完變髒」的追蹤檔還原成 HEAD 的版本。
function runShellTest(script: string, timeout: number, root = ROOT): Promise<ShellRun> {
  const changedBefore = changedTrackedFiles(root);
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script], { cwd: root, env: process.env, detached: true });
    let output = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // group 已經結束
      }
    }, timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      const changedAfter = timedOut ? changedTrackedFiles(root) : null;
      const restored =
        changedBefore && changedAfter
          ? [...changedAfter].filter((file) => !changedBefore.has(file))
          : [];
      if (restored.length > 0) {
        execFileSync('git', ['checkout', 'HEAD', '--', ...restored], { cwd: root });
      }
      resolve({ status, output, timedOut, restored });
    });
  });
}

function expectPassed(run: ShellRun): void {
  const detail = run.restored.length
    ? `逾時被砍，已還原：${run.restored.join(', ')}\n${run.output}`
    : run.output;
  expect(run.timedOut, detail).toBe(false);
  expect(run.status, detail).toBe(0);
}

describe('Tribunal shell safety contract', () => {
  it('passes the blocking shell contract', async () => {
    expectPassed(await runShellTest(CONTRACT, 30_000));
  }, 35_000);

  linuxIt(
    'fails closed on runner and provenance infrastructure errors',
    async () => {
      expectPassed(await runShellTest(RUNNER_ERROR_GUARD, 120_000));
    },
    125_000
  );

  linuxIt(
    'serializes stale-claim recovery across concurrent supervisors',
    async () => {
      expectPassed(await runShellTest(RUN_CONTROL_CLAIMS, 20_000));
    },
    25_000
  );

  it('passes deployment readiness with the hermetic writer runner', async () => {
    expectPassed(await runShellTest(DEPLOY_READINESS, 60_000));
  }, 65_000);
});

describe('shell test runner', () => {
  it('kills the whole group on timeout and restores tracked files the run dirtied', async () => {
    const repo = makeTempDirectory('gu-log-shell-runner-');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
    git('init', '-q');
    writeFileSync(path.join(repo, 'post.mdx'), 'pristine\n');
    writeFileSync(path.join(repo, 'draft.mdx'), 'committed\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'seed');
    // 跑之前就改過的檔不能被還原掉
    writeFileSync(path.join(repo, 'draft.mdx'), 'work in progress\n');
    // 背景的子行程在 bash 被砍之後才寫檔，模擬還在跑的 tribunal.sh
    writeFileSync(
      path.join(repo, 'slow.sh'),
      [
        'echo "gpt-test" >> post.mdx',
        '(sleep 1; echo "late write" >> post.mdx) &',
        'sleep 30',
      ].join('\n')
    );

    const run = await runShellTest('slow.sh', 300, repo);

    expect(run.timedOut).toBe(true);
    expect(run.restored).toEqual(['post.mdx']);
    expect(readFileSync(path.join(repo, 'post.mdx'), 'utf8')).toBe('pristine\n');
    await new Promise((done) => setTimeout(done, 1_500));
    expect(readFileSync(path.join(repo, 'post.mdx'), 'utf8')).toBe('pristine\n');
    expect(readFileSync(path.join(repo, 'draft.mdx'), 'utf8')).toBe('work in progress\n');
  }, 10_000);
});
