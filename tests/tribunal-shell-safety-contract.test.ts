import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
type Snapshot = { file: string; bytes: Buffer; mode: number };

// 腳本裡點名的文章（連同 en- 版）就是它可能改寫的 fixture；只有這些會在逾時時還原，
// 其他檔就算在測試期間被改，也是別人的工作，不能動。
function fixtureSnapshots(script: string, root: string): Snapshot[] {
  const postsDir = path.join(root, 'src/content/posts');
  const names = new Set<string>();
  for (const name of readFileSync(script, 'utf8').match(/[\w.-]+\.mdx\b/g) ?? []) {
    names.add(name);
    names.add(`en-${name}`);
  }
  return [...names]
    .map((name) => path.join(postsDir, name))
    .filter((file) => existsSync(file) && lstatSync(file).isFile())
    .map((file) => ({ file, bytes: readFileSync(file), mode: statSync(file).mode }));
}

function restoreSnapshots(snapshots: Snapshot[], root: string): string[] {
  const restored: string[] = [];
  for (const { file, bytes, mode } of snapshots) {
    const unchanged =
      existsSync(file) && lstatSync(file).isFile() && readFileSync(file).equals(bytes);
    if (unchanged) continue;
    rmSync(file, { recursive: true, force: true });
    writeFileSync(file, bytes);
    chmodSync(file, mode);
    restored.push(path.relative(root, file));
  }
  return restored;
}

// 這幾支 shell 測試會暫時改寫追蹤的文章（例如 SD-1 會被寫進 gpt-test 分數），靠 EXIT
// trap 還原。逾時只能用 SIGKILL 砍（不然可能卡住），trap 不會跑；只砍 bash 的話，底下
// 還在跑的 tribunal.sh 也會繼續寫檔。所以逾時就砍整個 process group，等全部結束後，
// 把腳本點名的 fixture 還原成跑之前的 bytes。
function runShellTest(script: string, timeout: number, root = ROOT): Promise<ShellRun> {
  const snapshots = fixtureSnapshots(script, root);
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
      const restored = timedOut ? restoreSnapshots(snapshots, root) : [];
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
  it('kills the whole group on timeout and restores only the fixtures the script names', async () => {
    const root = makeTempDirectory('gu-log-shell-runner-');
    const posts = path.join(root, 'src/content/posts');
    const post = (name: string) => path.join(posts, name);
    mkdirSync(posts, { recursive: true });
    // 跑之前就有的修改要原樣還原，不是退回 HEAD
    writeFileSync(post('sd-1-demo.mdx'), 'work in progress\n');
    writeFileSync(post('en-sd-1-demo.mdx'), 'english\n', { mode: 0o600 });
    writeFileSync(post('other.mdx'), 'before\n');
    // 背景子行程在 bash 被砍之後才寫檔，模擬還在跑的 tribunal.sh；en 版被換成目錄
    const script = path.join(root, 'slow.sh');
    writeFileSync(
      script,
      [
        'p=src/content/posts',
        'echo "gpt-test" >> "$p/sd-1-demo.mdx"',
        'rm "$p/en-$(basename "$p/sd-1-demo.mdx")" && mkdir "$p/en-sd-1-demo.mdx"',
        '(sleep 1; echo "late write" >> "$p/sd-1-demo.mdx") &',
        'sleep 30',
      ].join('\n')
    );

    const running = runShellTest(script, 500, root);
    // 測試期間別人改的檔不在腳本點名的範圍內，不能被還原
    writeFileSync(post('other.mdx'), 'edited during the run\n');
    const run = await running;

    expect(run.timedOut).toBe(true);
    expect(run.restored.sort()).toEqual([
      'src/content/posts/en-sd-1-demo.mdx',
      'src/content/posts/sd-1-demo.mdx',
    ]);
    await new Promise((done) => setTimeout(done, 1_500));
    expect(readFileSync(post('sd-1-demo.mdx'), 'utf8')).toBe('work in progress\n');
    expect(readFileSync(post('en-sd-1-demo.mdx'), 'utf8')).toBe('english\n');
    expect(statSync(post('en-sd-1-demo.mdx')).mode & 0o777).toBe(0o600);
    expect(readFileSync(post('other.mdx'), 'utf8')).toBe('edited during the run\n');
  }, 10_000);
});
