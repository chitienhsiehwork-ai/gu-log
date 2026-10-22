/**
 * #1164 回歸測試：Mermaid 視覺檢查要把「judge 呼叫失敗」跟「judge 判 FAIL」分開。
 *
 * 前半段 mock 掉 Anthropic SDK 和 `claude` CLI（不會真的打 API），驗 judgeDiagram／
 * exitCodeFor 的分類；後半段在假 repo 跑真的 scripts/hooks/pre-commit，用假的 node
 * 讓 check-mermaid-visual.mjs 回指定的 exit code，驗只有 FAIL 會擋 commit。
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreCommitFixtures } from './helpers/pre-commit-repo';
import { useTestTempDirectories } from './helpers/temp-directories';

const { createMessage, runCli } = vi.hoisted(() => ({
  createMessage: vi.fn(),
  runCli: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMessage };
  },
}));

// 只攔 `claude` CLI；這個檔案自己跑 hook 用的 spawnSync 照常執行。
vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('child_process')>();
  const spawnSync = (...args: Parameters<typeof real.spawnSync>) =>
    args[0] === 'claude' ? runCli(...args) : real.spawnSync(...args);
  return { ...real, spawnSync };
});

import {
  DEFAULT_MODEL,
  EXIT,
  exitCodeFor,
  judgeDiagram,
  parseVerdict,
  stopDevServer,
} from '../scripts/check-mermaid-visual.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');
const makeTempDirectory = useTestTempDirectories();
const { makeFakeRepo } = createPreCommitFixtures(makeTempDirectory);

const textReply = (text: string) => ({ content: text ? [{ type: 'text', text }] : [] });

function fakeScreenshot(): string {
  const file = path.join(makeTempDirectory('gu-log-mermaid-'), 'diagram.png');
  fs.writeFileSync(file, 'not really a png');
  return file;
}

describe('check-mermaid-visual: judge errors are not FAIL verdicts', () => {
  beforeEach(() => {
    createMessage.mockReset();
    runCli.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads only an explicit PASS or FAIL as a verdict', () => {
    expect(parseVerdict('PASS: 文字清晰')).toBe(true);
    expect(parseVerdict('**FAIL**：對比度不足')).toBe(false);
    // FAILED／PASSED 和大小寫混用也算判定，不能被當成 judge 出錯而只警告。
    expect(parseVerdict('FAILED: 文字太小')).toBe(false);
    expect(parseVerdict('PASSED：節點清楚')).toBe(true);
    // 判定沒放開頭也要認得；只要提到 FAIL 就算 FAIL，gate 不能因此變鬆。
    expect(parseVerdict('判定：FAIL，節點文字太小')).toBe(false);
    expect(parseVerdict('判定：Fail，節點文字太小')).toBe(false);
    expect(parseVerdict('條件 1 PASS，條件 4 FAIL，整體不通過')).toBe(false);
    expect(parseVerdict('結論：PASS')).toBe(true);
    expect(parseVerdict('結論: pass')).toBe(true);
    for (const reply of ['', '我沒辦法判斷這張圖', 'Looks fine to me']) {
      expect(() => parseVerdict(reply)).toThrow(/no PASS\/FAIL verdict/);
    }
  });

  it('asks the undated default model and keeps a FAIL verdict as fail', async () => {
    createMessage.mockResolvedValue(textReply('FAIL: 紫色背景上的黑字看不清楚'));

    const result = await judgeDiagram(fakeScreenshot());

    expect(result).toEqual({ status: 'fail', verdict: 'FAIL: 紫色背景上的黑字看不清楚' });
    expect(DEFAULT_MODEL).not.toMatch(/\d{8}$/);
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: process.env.MERMAID_CHECK_MODEL || DEFAULT_MODEL })
    );
    expect(runCli).not.toHaveBeenCalled();
  });

  it('reports an error, not a fail, when both the SDK and the CLI fallback fail', async () => {
    createMessage.mockRejectedValue(new Error('404 model not found'));
    runCli.mockReturnValue({ status: 1, stdout: '' });

    const result = await judgeDiagram(fakeScreenshot());

    expect(result.status).toBe('error');
    expect(result.verdict).toContain('claude CLI fallback failed');
    expect(runCli).toHaveBeenCalledWith('claude', expect.any(Array), expect.any(Object));
  });

  it('reports an error when the reply has no verdict (e.g. cut off while thinking)', async () => {
    createMessage.mockResolvedValue(textReply(''));

    expect((await judgeDiagram(fakeScreenshot())).status).toBe('error');
  });

  it('exits FAIL only on a fail, INCOMPLETE on judge errors, PASS otherwise', () => {
    const r = (status: string) => ({ status });
    expect(exitCodeFor([r('pass'), r('error'), r('fail')])).toBe(EXIT.FAIL);
    expect(exitCodeFor([r('pass'), r('error')])).toBe(EXIT.INCOMPLETE);
    expect(exitCodeFor([r('pass'), r('pass')])).toBe(EXIT.PASS);
  });
});

describe('check-mermaid-visual: cleanup never replaces the result', () => {
  it('only warns when the dev server process group is already gone', () => {
    // agent 環境下 Astro 會把 dev server 轉成背景 daemon，原本的 process group
    // 就不在了；kill 失敗不能丟錯，否則 FAIL 會被蓋成 exit 2 而放行。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => stopDevServer({ pid: 2 ** 30 })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not stop dev server'));
  });
});

describe('pre-commit: only a Mermaid FAIL verdict blocks the commit', () => {
  function runHookWithMermaidExit(exitCode: number) {
    const repo = makeFakeRepo();
    fs.mkdirSync(path.join(repo, 'src', 'data'));
    for (const manifest of ['post-versions.json', 'post-reader-revisions.json']) {
      fs.writeFileSync(path.join(repo, 'src', 'data', manifest), '{}\n');
    }
    fs.writeFileSync(
      path.join(repo, 'src', 'content', 'posts', 'sd-7-20261022-diagram.mdx'),
      '---\nticketId: "SD-7"\nlang: zh-tw\n---\n\n<Mermaid chart="graph TD; A-->B" />\n'
    );
    spawnSync('git', ['add', '-A'], { cwd: repo });

    // 假的 node：其他 gate 一律通過，只有 Mermaid 檢查回指定的 exit code。
    const bin = makeTempDirectory('gu-log-hook-mermaid-bin-');
    const tools: Record<string, string> = {
      gitleaks: 'exit 0',
      npx: 'exit 0',
      node: `case "$1" in */check-mermaid-visual.mjs) echo mermaid-visual-sentinel; exit ${exitCode} ;; esac\nexit 0`,
    };
    for (const [name, body] of Object.entries(tools)) {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    const r = spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-commit')], {
      cwd: repo,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: 'test-key-never-used',
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      encoding: 'utf-8',
    });
    const output = r.stdout + r.stderr;
    expect(output).toContain('mermaid-visual-sentinel');
    return { status: r.status, output };
  }

  it('warns but lets the commit through when the check is incomplete', () => {
    const r = runHookWithMermaidExit(EXIT.INCOMPLETE);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('Mermaid visual check incomplete (see above), not blocking');
  });

  it('blocks on a FAIL verdict', () => {
    const r = runHookWithMermaidExit(EXIT.FAIL);
    expect(r.status).toBe(1);
    expect(r.output).toContain('Mermaid visual quality check FAILED');
  });
});
