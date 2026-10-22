import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useTestTempDirectories } from './helpers/temp-directories';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = path.join(ROOT, 'scripts/tests/test-tribunal-safety-contract.sh');
const RUNNER_ERROR_GUARD = path.join(ROOT, 'scripts/tests/test-tribunal-runner-error-guard.sh');
const DEPLOY_READINESS = path.join(ROOT, 'scripts/tests/test-tribunal-deploy-readiness.sh');
const RUN_CONTROL_CLAIMS = path.join(ROOT, 'scripts/tests/test-tribunal-run-control-claims.sh');
const RECOVER_FIXTURES = '--recover-fixtures';
const linuxIt = process.platform === 'linux' ? it : it.skip;
const makeTempDirectory = useTestTempDirectories();

type ShellRun = { status: number | null; output: string; timedOut: boolean; restored: string[] };

// 逾時只能用 SIGKILL 砍（不然可能卡住），腳本的 EXIT trap 不會跑；只砍 bash 的話，
// 底下還在跑的 tribunal.sh 也會繼續寫檔。所以逾時就砍整個 process group，等全部
// 結束後，有改寫追蹤文章的腳本（runner-error-guard）再用 --recover-fixtures 照它在
// 鎖底下記的 journal 還原。
function runShellTest(
  script: string,
  timeout: number,
  { root = ROOT, recover = false } = {}
): Promise<ShellRun> {
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
      let restored: string[] = [];
      if (timedOut && recover) {
        const recovery = spawnSync('bash', [script, RECOVER_FIXTURES], {
          cwd: root,
          env: process.env,
          encoding: 'utf8',
          timeout: 30_000,
        });
        output += `\n[${RECOVER_FIXTURES}]\n${recovery.stdout}${recovery.stderr}`;
        restored = [...recovery.stdout.matchAll(/^recovered (.+)$/gm)].map((match) =>
          path.relative(root, match[1])
        );
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
      expectPassed(await runShellTest(RUNNER_ERROR_GUARD, 120_000, { recover: true }));
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
  it('kills the whole group on timeout, then runs the recovery mode', async () => {
    const root = makeTempDirectory('gu-log-shell-runner-');
    const post = path.join(root, 'post.mdx');
    writeFileSync(post, 'pristine\n');
    const script = path.join(root, 'slow.sh');
    // 背景子行程在 bash 被砍之後才寫檔，模擬還在跑的 tribunal.sh
    writeFileSync(
      script,
      [
        `if [ "\${1:-}" = ${RECOVER_FIXTURES} ]; then`,
        '  printf "pristine\\n" > post.mdx; echo "recovered $PWD/post.mdx"; exit 0',
        'fi',
        'echo "gpt-test" >> post.mdx',
        '(sleep 1; echo "late write" >> post.mdx) &',
        'sleep 30',
      ].join('\n')
    );

    const run = await runShellTest(script, 500, { root, recover: true });

    expect(run.timedOut).toBe(true);
    expect(run.restored).toEqual(['post.mdx']);
    await new Promise((done) => setTimeout(done, 1_500));
    expect(readFileSync(post, 'utf8')).toBe('pristine\n');
  }, 10_000);

  linuxIt(
    'restores the posts a killed guard run left behind',
    () => {
      const lock = path.join(ROOT, '.score-loop/locks/tracked-gp-1-20260128-demo.lock');
      const journal = path.join(ROOT, '.score-loop/locks/tracked-fixture-journal');
      const name = 'sd-1-20260209-openclaw-talk-deep-dive.mdx';
      const post = path.join(ROOT, 'src/content/posts', name);
      const pristine = readFileSync(post);
      mkdirSync(path.dirname(lock), { recursive: true });
      // 跟 guard 拿同一把鎖，模擬它記好 journal、改寫文章到一半就被 SIGKILL
      const setup = spawnSync(
        'flock',
        [
          '-x',
          lock,
          'bash',
          '-c',
          'mkdir -p "$1" && cp -p "$2" "$1/" && echo gpt-test >> "$2"',
          'setup',
          journal,
          post,
        ],
        { encoding: 'utf8' }
      );
      expect(setup.status, setup.stderr).toBe(0);
      expect(readFileSync(post).equals(pristine)).toBe(false);

      const recovery = spawnSync('bash', [RUNNER_ERROR_GUARD, RECOVER_FIXTURES], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
      });

      expect(recovery.status, recovery.stdout + recovery.stderr).toBe(0);
      expect(recovery.stdout).toContain(`recovered ${post}`);
      expect(readFileSync(post).equals(pristine)).toBe(true);
      expect(existsSync(journal)).toBe(false);
    },
    35_000
  );
});
