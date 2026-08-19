import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_TIMEOUT_MS = 15_000;
const tempRoots = new Set<string>();
const oldDefaultPaths = new Set<string>();
const activeRuns = new Set<ActiveRun>();

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS });

interface Fixture {
  root: string;
  wrapper: string;
  postFile: string;
  syncDir: string;
  tmpDir: string;
  oldDefaultPath: string;
}

interface RunOptions {
  outputPath?: string;
  waitForRelease?: boolean;
  outputMode?: 'valid' | 'invalid';
  pathPrefix?: string;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ActiveRun {
  child: ReturnType<typeof spawn>;
  fixture: Fixture;
  runId: string;
  result: Promise<RunResult>;
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-vibe-wrapper-'));
  const scriptsDir = path.join(root, 'scripts');
  const postsDir = path.join(root, 'src/content/posts');
  const syncDir = path.join(root, 'sync');
  const tmpDir = path.join(root, 'tmp');
  const postFile = 'fixture.mdx';
  const ticketId = `VIBE-${path.basename(root).replace(/[^A-Za-z0-9-]/g, '')}`;
  const oldDefaultPath = path.join('/tmp', `vibe-score-${ticketId}.json`);

  tempRoots.add(root);
  oldDefaultPaths.add(oldDefaultPath);
  fs.rmSync(oldDefaultPath, { force: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(postsDir, { recursive: true });
  fs.mkdirSync(syncDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts/vibe-scorer.sh'),
    path.join(scriptsDir, 'vibe-scorer.sh')
  );
  fs.copyFileSync(
    path.join(ROOT, 'scripts/tribunal-helpers.sh'),
    path.join(scriptsDir, 'tribunal-helpers.sh')
  );
  fs.writeFileSync(path.join(postsDir, postFile), `---\nticketId: "${ticketId}"\n---\nfixture\n`);

  const fakeTribunal = path.join(scriptsDir, 'tribunal.sh');
  fs.writeFileSync(
    fakeTribunal,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      ': "${TRIBUNAL_SCORE_OUTPUT:?}"',
      ': "${RUN_ID:?}"',
      ': "${SYNC_DIR:?}"',
      'if [ "${OUTPUT_MODE:-valid}" = "invalid" ]; then',
      '  printf \'not-json\\n\' > "$TRIBUNAL_SCORE_OUTPUT"',
      'else',
      '  printf \'{"dimensions":{"persona":8,"moguNote":8,"vibe":8},"run":"%s"}\\n\' "$RUN_ID" > "$TRIBUNAL_SCORE_OUTPUT"',
      'fi',
      ': > "$SYNC_DIR/${RUN_ID}.written"',
      'if [ "${WAIT_FOR_RELEASE:-1}" = "1" ]; then',
      '  attempts=0',
      '  while [ ! -e "$SYNC_DIR/release-${RUN_ID}" ]; do',
      '    attempts=$((attempts + 1))',
      '    [ "$attempts" -le 500 ] || exit 70',
      '    sleep 0.01',
      '  done',
      'fi',
      '',
    ].join('\n')
  );
  fs.chmodSync(fakeTribunal, 0o755);

  return {
    root,
    wrapper: path.join(scriptsDir, 'vibe-scorer.sh'),
    postFile,
    syncDir,
    tmpDir,
    oldDefaultPath,
  };
}

function startWrapper(fixture: Fixture, runId: string, options: RunOptions = {}) {
  const args = [
    fixture.wrapper,
    fixture.postFile,
    ...(options.outputPath ? [options.outputPath] : []),
  ];
  const child = spawn('bash', args, {
    cwd: fixture.root,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      RUN_ID: runId,
      SYNC_DIR: fixture.syncDir,
      TMPDIR: fixture.tmpDir,
      WAIT_FOR_RELEASE: options.waitForRelease === false ? '0' : '1',
      OUTPUT_MODE: options.outputMode ?? 'valid',
      PATH: options.pathPrefix
        ? `${options.pathPrefix}${path.delimiter}${process.env.PATH ?? ''}`
        : process.env.PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const result = new Promise<RunResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
  const activeRun = { child, fixture, runId, result };
  activeRuns.add(activeRun);
  result.then(
    () => activeRuns.delete(activeRun),
    () => activeRuns.delete(activeRun)
  );

  return { result };
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for fixture signal: ${file}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function release(fixture: Fixture, runId: string): void {
  fs.writeFileSync(path.join(fixture.syncDir, `release-${runId}`), '');
}

async function waitForActiveRuns(timeoutMs: number): Promise<void> {
  const pending = [...activeRuns].map(({ result }) => result.catch(() => undefined));
  if (pending.length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

function signalRun({ child }: ActiveRun, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

afterEach(async () => {
  for (const { fixture, runId } of activeRuns) {
    if (fs.existsSync(fixture.syncDir)) {
      release(fixture, runId);
    }
  }
  await waitForActiveRuns(500);
  for (const activeRun of activeRuns) signalRun(activeRun, 'SIGTERM');
  await waitForActiveRuns(500);
  for (const activeRun of activeRuns) signalRun(activeRun, 'SIGKILL');
  await waitForActiveRuns(500);
  activeRuns.clear();

  for (const oldDefaultPath of oldDefaultPaths) {
    fs.rmSync(oldDefaultPath, { force: true });
  }
  oldDefaultPaths.clear();
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe('vibe-scorer compatibility wrapper output isolation', () => {
  it('keeps parallel implicit outputs attributed to their own invocation', async () => {
    const fixture = makeFixture();
    const runA = startWrapper(fixture, 'A');
    await waitForFile(path.join(fixture.syncDir, 'A.written'));

    const runB = startWrapper(fixture, 'B');
    await waitForFile(path.join(fixture.syncDir, 'B.written'));

    release(fixture, 'A');
    const resultA = await runA.result;
    release(fixture, 'B');
    const resultB = await runB.result;

    expect(resultA.status).toBe(0);
    expect(resultB.status).toBe(0);
    expect(JSON.parse(resultA.stdout)).toMatchObject({ run: 'A' });
    expect(JSON.parse(resultB.stdout)).toMatchObject({ run: 'B' });
    expect(fs.readdirSync(fixture.tmpDir)).toEqual([]);
    expect(fs.existsSync(fixture.oldDefaultPath)).toBe(false);
  });

  it('preserves an explicit output path after exit with stdout-identical bytes', async () => {
    const fixture = makeFixture();
    const outputPath = path.join(fixture.root, 'artifacts/score.json');
    const run = startWrapper(fixture, 'EXPLICIT', {
      outputPath,
      waitForRelease: false,
    });
    const result = await run.result;

    expect(result.status).toBe(0);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe(result.stdout);
    expect(JSON.parse(result.stdout)).toMatchObject({ run: 'EXPLICIT' });
  });

  it('cleans an implicit output after validation failure', async () => {
    const fixture = makeFixture();
    const run = startWrapper(fixture, 'INVALID', {
      waitForRelease: false,
      outputMode: 'invalid',
    });
    const result = await run.result;

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Scorer output missing or invalid');
    expect(fs.readdirSync(fixture.tmpDir)).toEqual([]);
    expect(fs.existsSync(fixture.oldDefaultPath)).toBe(false);
  });

  it('fails closed before Tribunal when a private output cannot be created', async () => {
    const fixture = makeFixture();
    const binDir = path.join(fixture.root, 'bin');
    const mktempShim = path.join(binDir, 'mktemp');
    fs.mkdirSync(binDir);
    fs.writeFileSync(mktempShim, '#!/usr/bin/env bash\nexit 42\n');
    fs.chmodSync(mktempShim, 0o755);

    const run = startWrapper(fixture, 'MKTEMP-FAIL', {
      waitForRelease: false,
      pathPrefix: binDir,
    });
    const result = await run.result;

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unable to create private score output');
    expect(fs.existsSync(path.join(fixture.syncDir, 'MKTEMP-FAIL.written'))).toBe(false);
    expect(fs.existsSync(fixture.oldDefaultPath)).toBe(false);
  });
});
