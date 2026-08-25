import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_FILES = [
  'tribunal-helpers.sh',
  'tribunal-quota-loop.sh',
  'tribunal-run-control.sh',
  'tribunal-version.mjs',
] as const;
const fixtureRoots: string[] = [];

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'tribunal-quota-cli-'));
  const scriptsDir = path.join(root, 'scripts');
  mkdirSync(scriptsDir);
  fixtureRoots.push(root);

  for (const filename of FIXTURE_FILES) {
    copyFileSync(path.join(ROOT, 'scripts', filename), path.join(scriptsDir, filename));
  }

  return {
    root,
    loop: path.join(scriptsDir, 'tribunal-quota-loop.sh'),
  };
}

function runFixture(args: string[], inheritedEnv: NodeJS.ProcessEnv = process.env) {
  const fixture = createFixture();
  const result = spawnSync('bash', [fixture.loop, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...inheritedEnv,
      TRIBUNAL_DEPLOYED_MODE: '0',
      USAGE_MONITOR: path.join(fixture.root, 'missing-usage-monitor'),
    },
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    timeout: 2_000,
  });

  return { ...fixture, result };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Tribunal quota-loop CLI validation', () => {
  it.each([
    ['--workers', ['--workers']],
    ['--workers', ['--workers', '--dry-run']],
    ['--controller-once', ['--controller-once']],
    ['--controller-once', ['--controller-once', '--legacy-quota']],
  ])('%s requires an explicit value without hanging or consuming the next flag', (flag, args) => {
    const { root, result } = runFixture(args);

    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stderr).toContain(`ERROR: ${flag} requires a value`);
    expect(existsSync(path.join(root, '.score-loop'))).toBe(false);
  });

  it.each(['0', '-1', 'abc', '27', '999999999999999999999'])(
    'rejects --workers %s before creating runtime state',
    (workers) => {
      const { root, result } = runFixture(['--workers', workers, '--controller-once', '0']);

      expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.stderr).toContain(
        `ERROR: --workers must be an integer from 1 to 26 (got: ${workers})`
      );
      expect(existsSync(path.join(root, '.score-loop'))).toBe(false);
    }
  );

  it.each([
    ['-1', '2'],
    ['abc', '2'],
    ['01', '2'],
    ['3', '2'],
  ])(
    'rejects --controller-once %s when --workers is %s before creating runtime state',
    (activeWorkers, workers) => {
      const { root, result } = runFixture([
        '--workers',
        workers,
        '--controller-once',
        activeWorkers,
      ]);

      expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.stderr).toContain(
        `ERROR: --controller-once must be an integer from 0 to --workers (got: ${activeWorkers})`
      );
      expect(existsSync(path.join(root, '.score-loop'))).toBe(false);
    }
  );

  it.each([
    ['1', '0'],
    ['26', '26'],
  ])('accepts boundary values --workers %s --controller-once %s', (workers, activeWorkers) => {
    const { result } = runFixture(['--workers', workers, '--controller-once', activeWorkers]);

    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('isolates non-deployed CLI validation from ambient deployed mode', () => {
    const { result } = runFixture(['--workers', '1', '--controller-once', '0'], {
      ...process.env,
      TRIBUNAL_DEPLOYED_MODE: '1',
    });

    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('rejects an unknown flag without creating runtime state', () => {
    const { root, result } = runFixture(['--definitely-unknown']);

    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stderr).toContain('Unknown arg: --definitely-unknown');
    expect(existsSync(path.join(root, '.score-loop'))).toBe(false);
  });
});
