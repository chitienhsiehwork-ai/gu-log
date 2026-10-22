import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
// agent 會讀的指示檔：Tier-0、runtime 專屬檔、playbook、文件、skill、指令、agent 合約
const INSTRUCTION_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'playbooks',
  'docs',
  '.agents',
  '.claude/agents',
  '.claude/commands',
  '.claude/skills',
  '.codex',
];
// 站長回饋的歷史紀錄，照原樣保存
const HISTORY = new Set(['docs/shroomdog-editorial-feedback.md']);
const TEXT_FILE = /\.(md|mdx|toml|ya?ml|json|txt)$/;

const settings = JSON.parse(readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8')) as {
  permissions?: { deny?: string[] };
};
const deniedTools = (settings.permissions?.deny ?? []).filter((rule) => /^\w+$/.test(rule));
const instructionFiles = execFileSync('git', ['ls-files', '-z', '--', ...INSTRUCTION_PATHS], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter((file) => TEXT_FILE.test(file) && !HISTORY.has(file));

// openspec update 重新產生 skill 時會把上游模板的工具名帶回來；被 deny 的工具一叫就失敗，
// 下一個 agent 還可能以為是環境壞了、順手把 deny 拆掉。只有指回 settings.json 說明停用的句子放行。
describe('denied agent tools', () => {
  it('finds instruction files to check', () => {
    expect(instructionFiles.length).toBeGreaterThan(0);
  });

  it.each(deniedTools)('instruction files do not tell agents to use %s', (tool) => {
    const offenders = instructionFiles.flatMap((file) =>
      readFileSync(path.join(ROOT, file), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          line.includes(tool) && !line.includes('.claude/settings.json')
            ? [`${file}:${index + 1}`]
            : []
        )
    );
    expect(offenders).toEqual([]);
  });
});
