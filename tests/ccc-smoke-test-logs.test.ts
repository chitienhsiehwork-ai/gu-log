import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const SMOKE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'ccc-smoke-test.sh');
const FETCH_ARTICLE_REQUIREMENTS = 'scripts/requirements-fetch-article.txt';

function runSmoke(
  fixtureRoot: string,
  env: NodeJS.ProcessEnv,
  args: string[] = []
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['scripts/ccc-smoke-test.sh', ...args], {
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
        // fetch-article 套件 probe 會呼叫 python3；用假的立刻失敗，免得真的 import 拖過 timeout。
        ['python3', '#!/bin/sh\nexit 1\n'],
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

// 假的 python3 只認 smoke test 的兩種呼叫：import 檢查看 state 目錄有沒有 installed，
// pip install 把參數記進 pip.calls（FAKE_PIP_FAIL=1 時裝失敗）；其他呼叫一律失敗。
const FAKE_PYTHON = `#!/bin/sh
if [ "$1" = "-c" ] && [ "$2" = "import bs4, lxml, readability" ]; then
  [ -f "$FAKE_PY_STATE/installed" ]
  exit $?
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  printf '%s\\n' "$*" >> "$FAKE_PY_STATE/pip.calls"
  [ "$FAKE_PIP_FAIL" = "1" ] && exit 1
  : > "$FAKE_PY_STATE/installed"
  exit 0
fi
exit 1
`;

// 假的 install-gate-tools.sh：參數記進 gate.calls；--check 依 FAKE_GATE_CHECK_OK 回報，
// 安裝依 FAKE_GATE_INSTALL_FAIL 決定成敗。
const FAKE_GATE_TOOLS = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_PY_STATE/gate.calls"
if [ "$1" = "--check" ]; then
  [ "$FAKE_GATE_CHECK_OK" = "1" ] && { echo "$2 pinned-ok"; exit 0; }
  echo "$2 不在 PATH"
  exit 1
fi
[ "$FAKE_GATE_INSTALL_FAIL" = "1" ] && exit 1
exit 0
`;

async function runFix({
  remote,
  installed,
  pipFails = false,
  gateCheckOk = true,
  gateInstallFails = false,
}: {
  remote: boolean;
  installed: boolean;
  pipFails?: boolean;
  gateCheckOk?: boolean;
  gateInstallFails?: boolean;
}) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-ccc-smoke-fetch-deps-'));
  try {
    const scriptsDir = path.join(fixtureRoot, 'scripts');
    const binDir = path.join(fixtureRoot, 'bin');
    const stateDir = path.join(fixtureRoot, 'python-state');
    const tmpDir = path.join(fixtureRoot, 'tmp');
    const homeDir = path.join(fixtureRoot, 'home');
    for (const directory of [scriptsDir, binDir, stateDir, tmpDir, homeDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.copyFileSync(SMOKE_SCRIPT, path.join(scriptsDir, 'ccc-smoke-test.sh'));
    fs.writeFileSync(path.join(scriptsDir, 'install-gate-tools.sh'), FAKE_GATE_TOOLS, {
      mode: 0o755,
    });
    fs.copyFileSync(
      path.join(REPO_ROOT, FETCH_ARTICLE_REQUIREMENTS),
      path.join(fixtureRoot, FETCH_ARTICLE_REQUIREMENTS)
    );
    if (installed) fs.writeFileSync(path.join(stateDir, 'installed'), '');
    // 其他 --fix 步驟一律用假的，測試不會真的裝任何東西。
    for (const [name, body] of [
      ['python3', FAKE_PYTHON],
      ['pnpm', '#!/bin/sh\nexit 0\n'],
      ['npm', '#!/bin/sh\nexit 1\n'],
      ['openspec', '#!/bin/sh\nexit 0\n'],
      ['pgrep', '#!/bin/sh\nexit 1\n'],
      ['curl', "#!/bin/sh\nprintf '200'\n"],
    ] as const) {
      fs.writeFileSync(path.join(binDir, name), body, { mode: 0o755 });
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      TMPDIR: tmpDir,
      PLAYWRIGHT_BROWSERS_PATH: path.join(fixtureRoot, 'no-browsers'),
      FAKE_PY_STATE: stateDir,
      FAKE_PIP_FAIL: pipFails ? '1' : '',
      FAKE_GATE_CHECK_OK: gateCheckOk ? '1' : '',
      FAKE_GATE_INSTALL_FAIL: gateInstallFails ? '1' : '',
      CLAUDE_CODE_REMOTE: remote ? 'true' : '',
    };
    const { output } = await runSmoke(fixtureRoot, env, ['--fix']);
    const pipCallsPath = path.join(stateDir, 'pip.calls');
    const pipCalls = fs.existsSync(pipCallsPath) ? fs.readFileSync(pipCallsPath, 'utf-8') : '';
    const gateCallsPath = path.join(stateDir, 'gate.calls');
    const gateCalls = fs.existsSync(gateCallsPath) ? fs.readFileSync(gateCallsPath, 'utf-8') : '';
    return { output, pipCalls, gateCalls };
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe('CCC smoke --fix: fetch-article Python packages', () => {
  it('installs the pinned requirements when the import fails, then reports them importable', async () => {
    const { output, pipCalls } = await runFix({ remote: true, installed: false });

    expect(pipCalls).toBe(`-m pip install --requirement ${FETCH_ARTICLE_REQUIREMENTS}\n`);
    expect(output).toContain('✓ fetch-article Python 套件安裝完成');
    expect(output).toContain('✓ fetch-article Python 套件可 import');
  });

  it('skips pip when the packages already import', async () => {
    const { output, pipCalls } = await runFix({ remote: true, installed: true });

    expect(pipCalls).toBe('');
    expect(output).toContain('✓ fetch-article Python 套件已存在，跳過安裝');
    expect(output).toContain('✓ fetch-article Python 套件可 import');
  });

  it('only warns, never fails, when pip cannot install them', async () => {
    const { output, pipCalls } = await runFix({ remote: true, installed: false, pipFails: true });

    expect(pipCalls).not.toBe('');
    expect(output).toMatch(
      /! fetch-article Python 套件安裝失敗 — 見 .+\/ccc-fetch-article-install\.log/
    );
    expect(output).toContain('! fetch-article Python 套件缺');
    expect(output).not.toContain('✗ fetch-article');
  });

  it('leaves a local Python alone outside CCC and only reports the gap', async () => {
    const { output, pipCalls } = await runFix({ remote: false, installed: false });

    expect(pipCalls).toBe('');
    expect(output).not.toContain('fetch-article Python 套件安裝');
    expect(output).toContain('! fetch-article Python 套件缺');
  });
});

describe('CCC smoke --fix: gate tools (gitleaks / shellcheck)', () => {
  it('installs the pinned tools in CCC, then reports each one ready', async () => {
    const { output, gateCalls } = await runFix({ remote: true, installed: true });

    expect(gateCalls).toBe('\n--check gitleaks\n--check shellcheck\n');
    expect(output).toContain('✓ gitleaks / shellcheck 釘選版已就緒');
    expect(output).toContain('✓ gitleaks pinned-ok');
    expect(output).toContain('✓ shellcheck pinned-ok');
  });

  it('only warns, never fails, when the install or the readiness check does not pass', async () => {
    const { output } = await runFix({
      remote: true,
      installed: true,
      gateCheckOk: false,
      gateInstallFails: true,
    });

    expect(output).toMatch(
      /! gitleaks \/ shellcheck 安裝失敗 — 見 .+\/ccc-gate-tools-install\.log/
    );
    expect(output).toContain('! gitleaks 不在 PATH');
    expect(output).toContain('! shellcheck 不在 PATH');
    expect(output).not.toMatch(/✗ (gitleaks|shellcheck)/);
  });

  it('leaves local tools alone outside CCC and only reports readiness', async () => {
    const { output, gateCalls } = await runFix({
      remote: false,
      installed: true,
      gateCheckOk: false,
    });

    expect(gateCalls).toBe('--check gitleaks\n--check shellcheck\n');
    expect(output).not.toContain('釘選版已就緒');
    expect(output).toContain('! gitleaks 不在 PATH');
  });
});
