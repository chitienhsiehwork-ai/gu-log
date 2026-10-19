import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const SMOKE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'ccc-smoke-test.sh');

function runSmoke(
  fixtureRoot: string,
  env: NodeJS.ProcessEnv
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['scripts/ccc-smoke-test.sh'], {
      cwd: fixtureRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

describe('CCC smoke diagnostic logs', () => {
  it('fails before smoke checks when a private log directory cannot be created', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-ccc-smoke-bad-tmp-'));
    try {
      const scriptsDir = path.join(fixtureRoot, 'scripts');
      fs.mkdirSync(scriptsDir);
      fs.copyFileSync(SMOKE_SCRIPT, path.join(scriptsDir, 'ccc-smoke-test.sh'));
      const invalidTmpDir = path.join(fixtureRoot, 'not-a-directory');
      fs.writeFileSync(invalidTmpDir, '');

      const result = await runSmoke(fixtureRoot, { ...process.env, TMPDIR: invalidTmpDir });

      expect(result.status).toBe(1);
      expect(result.output).toContain('unable to create private smoke log directory');
      expect(result.output).not.toContain('== 1. 身份');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('uses a private log directory for each parallel invocation', async () => {
    const source = fs.readFileSync(SMOKE_SCRIPT, 'utf-8');
    expect(source).not.toMatch(/\/tmp\/ccc-[^\s"']+\.log/);

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-ccc-smoke-fixture-'));
    try {
      const scriptsDir = path.join(fixtureRoot, 'scripts');
      const pipelineDir = path.join(fixtureRoot, 'tools', 'gp-pipeline');
      const binDir = path.join(fixtureRoot, 'bin');
      const tmpDir = path.join(fixtureRoot, 'tmp');
      const homeDir = path.join(fixtureRoot, 'home');
      for (const directory of [scriptsDir, pipelineDir, binDir, tmpDir, homeDir]) {
        fs.mkdirSync(directory, { recursive: true });
      }
      fs.copyFileSync(SMOKE_SCRIPT, path.join(scriptsDir, 'ccc-smoke-test.sh'));

      const doctorPath = path.join(pipelineDir, 'gp-pipeline');
      fs.writeFileSync(
        doctorPath,
        `#!/bin/sh
printf '%s-start\\n' "$RUN_MARKER"
sleep 0.1
printf '%s-end\\n' "$RUN_MARKER"
exit 7
`,
        { mode: 0o755 }
      );
      for (const [name, body] of [
        ['curl', "#!/bin/sh\nprintf '200'\n"],
        ['pgrep', '#!/bin/sh\nexit 1\n'],
      ] as const) {
        fs.writeFileSync(path.join(binDir, name), body, { mode: 0o755 });
      }

      const sentinelPath = path.join(fixtureRoot, 'sentinel.txt');
      fs.writeFileSync(sentinelPath, 'KEEP_ME\n');
      fs.symlinkSync(sentinelPath, path.join(tmpDir, 'ccc-smoke-doctor.log'));

      const baseEnv = {
        ...process.env,
        HOME: homeDir,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        TMPDIR: tmpDir,
      };
      const [runA, runB] = await Promise.all([
        runSmoke(fixtureRoot, { ...baseEnv, RUN_MARKER: 'RUN_A' }),
        runSmoke(fixtureRoot, { ...baseEnv, RUN_MARKER: 'RUN_B' }),
      ]);

      expect(runA.status).toBe(1);
      expect(runB.status).toBe(1);
      const logPath = (output: string) => {
        const match = output.match(/see (.+\/ccc-smoke-doctor\.log)/);
        expect(match, output).not.toBeNull();
        return match![1];
      };
      const logA = logPath(runA.output);
      const logB = logPath(runB.output);

      expect(logA).not.toBe(logB);
      for (const [log, marker] of [
        [logA, 'RUN_A'],
        [logB, 'RUN_B'],
      ] as const) {
        expect(path.relative(tmpDir, log)).not.toMatch(/^\.\.(?:\/|$)/);
        expect(fs.statSync(path.dirname(log)).mode & 0o777).toBe(0o700);
        expect(fs.readFileSync(log, 'utf-8')).toBe(`${marker}-start\n${marker}-end\n`);
      }
      expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('KEEP_ME\n');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
