import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
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
// runner-error-guard 改寫 fixture 之前會拿這把鎖（見腳本開頭）
const FIXTURE_LOCK = '.score-loop/locks/tracked-gp-1-20260128-demo.lock';
const linuxIt = process.platform === 'linux' ? it : it.skip;
const makeTempDirectory = useTestTempDirectories();

type ShellRun = { status: number | null; output: string; timedOut: boolean; restored: string[] };
type Snapshot = { file: string; bytes: Buffer; mode: number };

// 別的 run 拿著 fixture 鎖時，文章可能正被它改寫：這時不拍快照、也不還原，讓拿鎖的
// 那一方自己收拾。鎖檔不存在或沒有 flock（例如 macOS）都當成沒人拿。
function fixtureLockHeld(root: string): boolean {
  const run = spawnSync('flock', ['-n', '-E', '75', path.join(root, FIXTURE_LOCK), 'true']);
  return run.status === 75;
}

// 讀一般檔的 bytes 和權限；不存在、或已經不是一般檔就回 null。用同一個 fd 讀，
// 不會在檢查和讀取之間被換掉。
function readRegularFile(file: string): Omit<Snapshot, 'file'> | null {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    return stat.isFile() ? { bytes: readFileSync(fd), mode: stat.mode } : null;
  } finally {
    closeSync(fd);
  }
}

// 腳本裡點名的文章（連同 en- 版）就是它可能改寫的 fixture；只有這些會在逾時時還原，
// 其他檔就算在測試期間被改，也是別人的工作，不能動。
function fixtureSnapshots(script: string, root: string): Snapshot[] {
  if (fixtureLockHeld(root)) return [];
  const postsDir = path.join(root, 'src/content/posts');
  const names = new Set<string>();
  for (const name of readFileSync(script, 'utf8').match(/[\w.-]+\.mdx\b/g) ?? []) {
    names.add(name);
    names.add(`en-${name}`);
  }
  return [...names].flatMap((name) => {
    const file = path.join(postsDir, name);
    const current = readRegularFile(file);
    return current ? [{ file, ...current }] : [];
  });
}

function restoreSnapshots(snapshots: Snapshot[], root: string): string[] {
  if (snapshots.length === 0 || fixtureLockHeld(root)) return [];
  const restored: string[] = [];
  for (const { file, bytes, mode } of snapshots) {
    if (readRegularFile(file)?.bytes.equals(bytes)) continue;
    // 被換成目錄的也要清掉；flag wx 確保寫進去的是剛建立的新檔
    rmSync(file, { recursive: true, force: true });
    const fd = openSync(file, 'wx');
    try {
      writeFileSync(fd, bytes);
      fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
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

  it('uses the lock the guard script takes before rewriting fixtures', () => {
    const source = readFileSync(RUNNER_ERROR_GUARD, 'utf8');
    expect(source).toContain(`fixture_lock_dir="$ROOT_DIR/${path.dirname(FIXTURE_LOCK)}"`);
    expect(source).toContain(`$fixture_lock_dir/${path.basename(FIXTURE_LOCK)}`);
  });

  linuxIt(
    'leaves fixtures alone while another run holds the fixture lock',
    async () => {
      const root = makeTempDirectory('gu-log-shell-runner-locked-');
      const posts = path.join(root, 'src/content/posts');
      mkdirSync(posts, { recursive: true });
      mkdirSync(path.join(root, path.dirname(FIXTURE_LOCK)), { recursive: true });
      writeFileSync(path.join(posts, 'sd-1-demo.mdx'), 'pristine\n');
      const script = path.join(root, 'slow.sh');
      writeFileSync(script, 'echo "gpt-test" >> src/content/posts/sd-1-demo.mdx\nsleep 30\n');
      // 另一個 run 正拿著鎖改寫文章：它的快照才是乾淨的，這邊不能拿自己的快照蓋回去
      const holder = spawn('flock', ['-x', path.join(root, FIXTURE_LOCK), 'sleep', '30']);
      try {
        await new Promise((done) => setTimeout(done, 300));
        const run = await runShellTest(script, 500, root);
        expect(run.timedOut).toBe(true);
        expect(run.restored).toEqual([]);
        expect(readFileSync(path.join(posts, 'sd-1-demo.mdx'), 'utf8')).toBe(
          'pristine\ngpt-test\n'
        );
      } finally {
        holder.kill('SIGKILL');
      }
    },
    10_000
  );
});
