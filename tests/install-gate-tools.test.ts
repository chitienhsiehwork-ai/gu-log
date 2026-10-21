import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-gate-tools.sh');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT, 'utf-8');

const pinnedVersion = (name: string) => {
  const match = SCRIPT_SOURCE.match(new RegExp(`^${name}=(\\S+)$`, 'm'));
  expect(match, `${name} not found in install-gate-tools.sh`).not.toBeNull();
  return match![1];
};
const GITLEAKS = pinnedVersion('GITLEAKS_VERSION');
const SHELLCHECK = pinnedVersion('SHELLCHECK_VERSION');

const fakeGitleaks = (version: string) => `#!/bin/sh\necho "${version}"\n`;
const fakeShellcheck = (version: string) =>
  `#!/bin/sh\nprintf 'ShellCheck - shell script analysis tool\\nversion: ${version}\\n'\n`;
// 假 curl：不連網，把 -o 指定的檔案寫成垃圾內容，並記下被呼叫幾次。
const FAKE_CURL = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac
done
echo call >> "$FAKE_STATE/curl.calls"
printf 'not-a-release-archive' > "$out"
`;
const FAKE_UNAME = `#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) echo Linux ;; esac\n`;

let root: string;
let fakeBin: string;
let installDir: string;
let tmpDir: string;

const write = (dir: string, name: string, body: string) =>
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });

function run(args: string[], pathDirs: string[] = [fakeBin, '/usr/bin', '/bin']) {
  const r = spawnSync('/bin/bash', [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: {
      HOME: root,
      PATH: pathDirs.join(path.delimiter),
      TMPDIR: tmpDir,
      GATE_TOOLS_BIN_DIR: installDir,
      FAKE_STATE: root,
    },
  });
  return { status: r.status, output: r.stdout + r.stderr };
}

const curlCalls = () => {
  const p = path.join(root, 'curl.calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim().split('\n').length : 0;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-gate-tools-'));
  fakeBin = path.join(root, 'fake-bin');
  installDir = path.join(root, 'install-bin');
  tmpDir = path.join(root, 'tmp');
  for (const dir of [fakeBin, installDir, tmpDir]) fs.mkdirSync(dir);
  write(fakeBin, 'curl', FAKE_CURL);
  write(fakeBin, 'uname', FAKE_UNAME);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('install-gate-tools.sh pins', () => {
  it('pins the same gitleaks version as the CI gitleaks job', () => {
    const ci = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    const match = ci.match(/GITLEAKS_VERSION:\s*'([^']+)'/);
    expect(match, 'GITLEAKS_VERSION not found in ci.yml').not.toBeNull();
    expect(GITLEAKS).toBe(match![1]);
  });
});

describe('install-gate-tools.sh install', () => {
  it('skips the download when the install dir already has the pinned versions', () => {
    write(installDir, 'gitleaks', fakeGitleaks(GITLEAKS));
    write(installDir, 'shellcheck', fakeShellcheck(SHELLCHECK));

    const { status, output } = run([]);

    expect(status, output).toBe(0);
    expect(output).toContain(`✓ gitleaks ${GITLEAKS} 已在 ${installDir}，跳過`);
    expect(output).toContain(`✓ shellcheck ${SHELLCHECK} 已在 ${installDir}，跳過`);
    expect(curlCalls()).toBe(0);
  });

  it('refuses to install an archive whose sha256 does not match the pin', () => {
    const { status, output } = run([]);

    expect(status, output).toBe(1);
    expect(output).toContain('✗ gitleaks：sha256 不符，拒絕安裝');
    expect(output).toContain('✗ shellcheck：sha256 不符，拒絕安裝');
    expect(curlCalls()).toBe(2);
    expect(fs.readdirSync(installDir)).toEqual([]);
    // 下載暫存目錄跑完就清掉。
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('replaces an outdated binary instead of treating it as installed', () => {
    write(installDir, 'gitleaks', fakeGitleaks('8.0.0'));
    write(installDir, 'shellcheck', fakeShellcheck(SHELLCHECK));

    const { status, output } = run([]);

    expect(status, output).toBe(1);
    expect(output).toContain('✗ gitleaks：sha256 不符');
    expect(output).toContain(`✓ shellcheck ${SHELLCHECK} 已在`);
    expect(curlCalls()).toBe(1);
  });
});

describe('install-gate-tools.sh --check', () => {
  it('passes for the pinned versions on PATH', () => {
    write(fakeBin, 'gitleaks', fakeGitleaks(GITLEAKS));
    write(fakeBin, 'shellcheck', fakeShellcheck(SHELLCHECK));

    const { status, output } = run(['--check']);

    expect(status, output).toBe(0);
    expect(output).toContain(`gitleaks ${GITLEAKS} (${path.join(fakeBin, 'gitleaks')})`);
    expect(output).toContain(`shellcheck ${SHELLCHECK} (${path.join(fakeBin, 'shellcheck')})`);
  });

  it('flags a version that differs from the pin', () => {
    write(fakeBin, 'gitleaks', fakeGitleaks('8.0.0'));

    const { status, output } = run(['--check', 'gitleaks']);

    expect(status, output).toBe(1);
    expect(output).toContain(`gitleaks 8.0.0`);
    expect(output).toContain(`不是釘選的 ${GITLEAKS}`);
  });

  it('says how to install a tool that is missing from PATH', () => {
    // 只給 fake-bin：check 遇到缺工具時只用 bash builtin，不需要其他指令。
    const { status, output } = run(['--check', 'gitleaks'], [fakeBin]);

    expect(status, output).toBe(1);
    expect(output).toContain('gitleaks 不在 PATH');
    expect(output).toContain('bash scripts/install-gate-tools.sh');
    expect(output).toContain('brew install gitleaks');
  });

  it('rejects an unknown tool name', () => {
    const { status, output } = run(['--check', 'not-a-tool']);

    expect(status).toBe(2);
    expect(output).toContain('unknown tool: not-a-tool');
  });
});
