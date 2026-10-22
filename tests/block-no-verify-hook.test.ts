import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTestTempDirectories } from './helpers/temp-directories';

// PreToolUse hook：擋 git 繞過 hook 的指令（.claude/hooks/block-no-verify.sh）。
// 這支是 fail-fast；真正的防線是 CI。這裡鎖住「該擋的擋、只是提到的不擋」。

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK_RELATIVE = '.claude/hooks/block-no-verify.sh';
const HOOK = path.join(REPO_ROOT, HOOK_RELATIVE);
const makeTempDirectory = useTestTempDirectories();

type HookRun = { status: number | null; stdout: string; stderr: string };

function payload(command: string): string {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

function decision(run: HookRun): string {
  expect(run.status, run.stderr).toBe(0);
  if (run.stdout.trim() === '') return 'allow';
  const output = JSON.parse(run.stdout) as {
    hookSpecificOutput?: { hookEventName?: string; permissionDecision?: string };
  };
  expect(output.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
  return output.hookSpecificOutput?.permissionDecision ?? 'allow';
}

function runHook(command: string): string {
  return decision(spawnSync('bash', [HOOK], { input: payload(command), encoding: 'utf-8' }));
}

const BYPASSES = [
  'git commit --no-verify -m "fix"',
  'git commit -n -m "fix"',
  'git commit -nm "fix"',
  'git commit -anm "fix"',
  'git commit -am "fix" -n',
  'git commit --amend --no-edit -n',
  'git commit --no-veri -m "abbreviated long option"',
  'git commit "--no-verify" -m "quoted flag is still a flag"',
  'git commit --no-gpg-sign -m "fix"',
  'git push --no-verify origin HEAD',
  'git -c core.hooksPath=/dev/null commit -m "fix"',
  'git -c CORE.HOOKSPATH=/dev/null commit -m "fix"',
  'git -c core.hooksPath= push',
  'git --config-env=core.hooksPath=EMPTY_DIR commit -m "fix"',
  'git --config-env core.hooksPath=EMPTY_DIR push',
  'git -C "dir with space" commit -n -m "fix"',
  'GIT_AUTHOR_NAME=bot /usr/bin/git commit -n -m "fix"',
  'git add -A && git commit -F msg.txt -n',
  '(cd sub && git commit -n -m "fix")',
  'git commit -m "#1 fix" -n',
  'git commit -m "" -n',
  ["git commit -m \"$(cat <<'EOF'", 'fix: message', 'EOF', ')" -n'].join('\n'),
  ['git commit -m x \\', '  --no-verify'].join('\n'),
  // 沒加引號的指令替換不能把外層的 git 指令切斷，裡面的內容也要檢查
  'git commit -F <(echo hi) -n',
  'git commit -m $(cat msg) -n',
  'git commit -m `cat msg` -n',
  'git -C $(git rev-parse --show-toplevel) commit -n -m "fix"',
  'out=$(git commit -n -m "fix")',
  // 標記有引號的 heredoc 內文不處理接續行，所以 EOF 在第三行就結束
  ["cat <<'EOF' > s.sh", 'echo foo \\', 'EOF', 'git commit -n -m x', 'EOF'].join('\n'),
];

const ALLOWED = [
  'git push -n origin HEAD',
  'git push --dry-run origin HEAD',
  'git commit -m "fix: block git commit -n and --no-verify"',
  "git commit -m 'docs: -c core.hooksPath=/dev/null is a bypass'",
  'git commit -mn',
  'git commit -m -n',
  'git commit --message -n',
  'git commit -F - -m "fix"',
  'git commit -Sn -m "fix"',
  'git log --grep "--no-verify"',
  'git log -S --no-verify --oneline',
  'git merge -n feature',
  'git merge --no-verify-signatures feature',
  'git pull -n',
  'git cherry-pick -n abc123',
  'git config core.hooksPath',
  'git -c user.name=bot commit -m "fix"',
  'git -C sub commit -m "fix"',
  'git commit -m "fix" -- -n',
  'git status # never use --no-verify or git commit -n',
  'git commit -m "fix" 2>&1 | tail -n 5',
  'git commit -m $(cat msg)',
  'git push -n $(git remote | head -1) HEAD',
  'rg -n "no-verify" .',
  'grep -rn -- --no-verify docs/',
  [
    "git commit -F - <<'EOF'",
    'fix(hooks): 擋 git commit -n',
    '',
    '-c core.hooksPath=/dev/null 跟 --no-verify 也一起擋',
    'EOF',
  ].join('\n'),
  [
    "git commit -m \"$(cat <<'EOF'",
    'fix(hooks): 擋 git commit -n',
    '',
    'git push -n 是 dry-run，--no-verify 才是繞過',
    'EOF',
    ')"',
  ].join('\n'),
  ["git commit -F - <<'EOF'", 'docs: 說明 git commit -n 會被擋 \\', 'EOF'].join('\n'),
  // 沒引號的 heredoc 內文會併接續行，第三行的 EOF 被併進上一行，git 那行還在內文裡
  ['cat <<EOF', 'echo foo \\', 'EOF', 'git commit -n -m x', 'EOF'].join('\n'),
];

describe('block-no-verify PreToolUse hook', () => {
  it.each(BYPASSES)('denies %j', (command) => {
    expect(runHook(command)).toBe('deny');
  });

  it.each(ALLOWED)('allows %j', (command) => {
    expect(runHook(command)).toBe('allow');
  });

  it('allows payloads without a command', () => {
    const run = spawnSync('bash', [HOOK], { input: '{"tool_input":{}}', encoding: 'utf-8' });
    expect(decision(run)).toBe('allow');
  });

  it('passes ShellCheck', () => {
    const run = spawnSync('shellcheck', ['--shell=bash', HOOK_RELATIVE], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});

describe('block-no-verify hook registration', () => {
  // 專案路徑有空白時，沒加引號的指令會找不到 script，hook 等於沒擋。
  function projectWithSpace(): string {
    const project = path.join(makeTempDirectory('gu-log-no-verify-'), 'project with space');
    fs.mkdirSync(path.join(project, '.claude', 'hooks'), { recursive: true });
    fs.symlinkSync(HOOK, path.join(project, HOOK_RELATIVE));
    execFileSync('git', ['init', '-q'], { cwd: project });
    return project;
  }

  function registeredCommand(file: string): string {
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8')) as {
      hooks: {
        PreToolUse?: { matcher?: string; hooks: { type: string; command: string }[] }[];
      };
    };
    const commands = (config.hooks.PreToolUse ?? [])
      .filter((entry) => entry.matcher === 'Bash')
      .flatMap((entry) => entry.hooks)
      .filter((hook) => hook.type === 'command' && hook.command.includes(HOOK_RELATIVE))
      .map((hook) => hook.command);
    expect(commands).toHaveLength(1);
    return commands[0];
  }

  function runRegistered(file: string, project: string, command: string): string {
    return decision(
      spawnSync('/bin/sh', ['-c', registeredCommand(file)], {
        cwd: project,
        env: { ...process.env, CLAUDE_PROJECT_DIR: project },
        input: payload(command),
        encoding: 'utf-8',
      })
    );
  }

  it.each(['.claude/settings.json', '.codex/hooks.json'])(
    '%s runs the hook from a project path with spaces',
    (file) => {
      const project = projectWithSpace();
      expect(runRegistered(file, project, 'git commit -n -m "fix"')).toBe('deny');
      expect(runRegistered(file, project, 'git push -n origin HEAD')).toBe('allow');
    }
  );
});
