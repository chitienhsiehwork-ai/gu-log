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
const RECOVERY_TIMEOUT = 30_000;
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
    let settled = false;
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
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let restored: string[] = [];
      if (timedOut && recover) {
        // 還原要先拿 fixture 鎖：另開 process group（set -m、setsid）逃過砍除的子行程
        // 還拿著鎖時，會等它們結束，不會搶在它們最後一次寫檔之前還原
        const recovery = spawnSync('bash', [script, RECOVER_FIXTURES], {
          cwd: root,
          env: process.env,
          encoding: 'utf8',
          timeout: RECOVERY_TIMEOUT,
        });
        output += `\n[${RECOVER_FIXTURES}]\n${recovery.stdout}${recovery.stderr}`;
        if (recovery.status !== 0) {
          output += `\n${RECOVER_FIXTURES} 沒有完成；journal 留著，下一次跑 guard 會先還原`;
        }
        restored = [...recovery.stdout.matchAll(/^recovered (.+)$/gm)].map((match) =>
          path.relative(root, match[1])
        );
      }
      resolve({ status, output, timedOut, restored });
    };
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // 逾時後逃過砍除的子行程可能還拿著輸出管線，不等管線關閉
    child.on('exit', (status) => {
      if (!timedOut) return;
      child.stdout.destroy();
      child.stderr.destroy();
      finish(status);
    });
    child.on('close', (status) => finish(status));
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
    125_000 + RECOVERY_TIMEOUT
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
    'waits for an escaped process group that still holds the lock before recovering',
    async () => {
      const root = makeTempDirectory('gu-log-shell-runner-escaped-');
      const post = path.join(root, 'post.mdx');
      writeFileSync(post, 'pristine\n');
      const script = path.join(root, 'slow.sh');
      // 模擬 guard：拿鎖後改寫文章；setsid 開的背景行程繼承鎖和輸出管線，逃過整組砍除，
      // 一秒後才最後一次寫檔。還原模式也要先拿同一把鎖
      writeFileSync(
        script,
        [
          'exec 9>>lock',
          'flock -x 9',
          `if [ "\${1:-}" = ${RECOVER_FIXTURES} ]; then`,
          '  printf "pristine\\n" > post.mdx; echo "recovered $PWD/post.mdx"; exit 0',
          'fi',
          'echo "gpt-test" >> post.mdx',
          'setsid bash -c \'sleep 1; echo "escaped write" >> post.mdx; exec 9>&-; sleep 5\' &',
          'sleep 30',
        ].join('\n')
      );

      const started = Date.now();
      const run = await runShellTest(script, 300, { root, recover: true });

      expect(run.timedOut).toBe(true);
      expect(run.restored).toEqual(['post.mdx']);
      // 不等它放掉輸出管線：拿到鎖就還原
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(readFileSync(post, 'utf8')).toBe('pristine\n');
    },
    15_000
  );

  linuxIt(
    'restores the posts a killed guard run left behind',
    () => {
      const lock = path.join(ROOT, '.score-loop/locks/tracked-gp-1-20260128-demo.lock');
      const journal = path.join(ROOT, '.score-loop/locks/tracked-fixture-journal');
      const name = 'sd-1-20260209-openclaw-talk-deep-dive.mdx';
      const post = path.join(ROOT, 'src/content/posts', name);
      const recover = () =>
        spawnSync('bash', [RUNNER_ERROR_GUARD, RECOVER_FIXTURES], {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 30_000,
        });
      // 先收掉之前被砍的 run 留下的 journal，讀到的才是真正的原檔
      expect(recover().status).toBe(0);
      const pristine = readFileSync(post);
      mkdirSync(path.dirname(lock), { recursive: true });
      // 跟 guard 拿同一把鎖，模擬它記好 journal、改寫文章到一半就被 SIGKILL。
      // journal 已經存在就不碰：那是別人的唯一備份
      const setup = spawnSync(
        'flock',
        [
          '-x',
          lock,
          'bash',
          '-c',
          '[ ! -e "$1" ] && mkdir -p "$1" && cp -p "$2" "$1/" && echo gpt-test >> "$2"',
          'setup',
          journal,
          post,
        ],
        { encoding: 'utf8' }
      );
      expect(setup.status, setup.stderr).toBe(0);
      expect(readFileSync(post).equals(pristine)).toBe(false);

      const recovery = recover();

      expect(recovery.status, recovery.stdout + recovery.stderr).toBe(0);
      expect(recovery.stdout).toContain(`recovered ${post}`);
      expect(readFileSync(post).equals(pristine)).toBe(true);
      expect(existsSync(journal)).toBe(false);
    },
    35_000
  );
});
