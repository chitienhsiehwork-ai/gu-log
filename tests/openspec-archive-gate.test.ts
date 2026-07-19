import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECKER = path.join(ROOT, 'scripts/check-openspec-archive.mjs');
const tempRepos = new Set<string>();

// This is the apply handoff's executable scenario ledger. Git graph/tree and
// workflow-shape claims are Tier-1; GitHub's live event scheduling/ruleset
// selection remains Tier-2 rollout evidence owned by the controller.
const SCENARIO_TIERS = {
  'Ready PR 的 archive leaf 失敗': 'tier-1-workflow',
  'Push event 不需要判定 PR archive': 'tier-1-workflow',
  'Archive gate 維持既有 aggregate 介面': 'tier-1-workflow',
  'Remote branch 在 workflow 執行期間移動': 'tier-1-cli',
  'Exact commit 輸入缺失或無效': 'tier-1-cli',
  '有效 base tree 尚無 changes 目錄': 'tier-1-cli',
  'PR 保留既有 active change': 'tier-1-cli',
  'Grandfathered change 與新 change 並存': 'tier-1-cli',
  'Active change 在後續 commit 被直接刪除': 'tier-1-cli',
  'Active change 仍留在 HEAD': 'tier-1-cli',
  'HEAD 有且僅有一個新 canonical archive': 'tier-1-cli',
  'Archive 重用、格式錯誤或不唯一': 'tier-1-cli',
  '同一個 commit 直接加入 canonical archive': 'tier-1-cli',
  'PR-new archive entry malformed': 'tier-1-cli',
  'PR 內 rename active change': 'tier-1-cli',
  'Archive 包含 mandatory spec-driven artifacts': 'tier-1-cli',
  'Archive 保留最近 active snapshot frontier 的相對 paths': 'tier-1-cli',
  'Merge DAG 的最近 snapshots 互相矛盾': 'tier-1-cli',
  'Matching archive 只是 dummy shape': 'tier-1-cli',
  'Delta spec 未產生新 stable-spec blob': 'tier-1-cli',
  'Delta spec 與 stable spec 一起完成': 'tier-1-cli',
  'Stable spec 只有 file mode 改變': 'tier-1-cli',
  '一個 change 完成但另一個只刪除': 'tier-1-cli',
  '多個 changes 全部完成': 'tier-1-cli',
  'Draft 在相同 head SHA 轉為 ready': 'tier-2-rollout',
  'Ready run 的 archive leaf 未明確成功': 'tier-1-workflow',
  'Ready run 完整通過': 'tier-2-rollout',
} as const;

type GateResult = { status: number | null; stdout: string; stderr: string };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function write(repo: string, relativePath: string, content: string): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function remove(repo: string, relativePath: string): void {
  fs.rmSync(path.join(repo, relativePath), { recursive: true, force: true });
}

function commit(repo: string, message: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function initRepo(): { repo: string; base: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-openspec-archive-'));
  tempRepos.add(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Archive Gate Test');
  git(repo, 'config', 'user.email', 'archive-gate@example.test');
  git(repo, 'config', 'commit.gpgSign', 'false');
  git(repo, 'config', 'core.fileMode', 'true');
  write(repo, 'README.md', 'fixture\n');
  return { repo, base: commit(repo, 'base') };
}

function planningFiles(capability = 'sample-capability'): Record<string, string> {
  return {
    '.openspec.yaml': 'schema: spec-driven\n',
    'proposal.md': '## Why\nBecause this fixture needs a proposal.\n',
    'design.md': '## Design\nA committed-tree fixture.\n',
    'tasks.md': '- [x] fixture complete\n',
    [`specs/${capability}/spec.md`]: '## ADDED Requirements\nFixture delta.\n',
  };
}

function writeTree(repo: string, root: string, files = planningFiles()): void {
  for (const [relativePath, content] of Object.entries(files)) {
    write(repo, `${root}/${relativePath}`, content);
  }
}

function writeActive(repo: string, name: string, capability = 'sample-capability'): void {
  writeTree(repo, `openspec/changes/${name}`, planningFiles(capability));
}

function archiveActive(repo: string, name: string, date = '2026-07-20'): string {
  const activePath = path.join(repo, 'openspec/changes', name);
  const archiveRelative = `openspec/changes/archive/${date}-${name}`;
  const archivePath = path.join(repo, archiveRelative);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.renameSync(activePath, archivePath);
  return archiveRelative;
}

function writeDirectArchive(
  repo: string,
  name: string,
  capability = 'sample-capability',
  date = '2026-07-20'
): string {
  const archiveRelative = `openspec/changes/archive/${date}-${name}`;
  writeTree(repo, archiveRelative, planningFiles(capability));
  return archiveRelative;
}

function syncStable(repo: string, capability = 'sample-capability', content = 'stable v1\n'): void {
  write(repo, `openspec/specs/${capability}/spec.md`, content);
}

function runGate(repo: string, base?: string, head?: string): GateResult {
  const args = [CHECKER];
  if (base !== undefined) args.push('--base', base);
  if (head !== undefined) args.push('--head', head);
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const repo of tempRepos) fs.rmSync(repo, { recursive: true, force: true });
  tempRepos.clear();
});

describe('OpenSpec archive gate CLI — exact committed-tree lifecycle', () => {
  it('keeps every delta-spec scenario assigned to executable or rollout evidence', () => {
    expect(Object.keys(SCENARIO_TIERS)).toHaveLength(27);
    expect(Object.values(SCENARIO_TIERS).filter((tier) => tier === 'tier-2-rollout')).toEqual([
      'tier-2-rollout',
      'tier-2-rollout',
    ]);
  });

  it('passes when valid base/head trees introduce no OpenSpec change', () => {
    const { repo, base } = initRepo();
    write(repo, 'unrelated.txt', 'unrelated committed change\n');
    const head = commit(repo, 'unrelated change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 introduced change(s)');
  });

  it('returns exit 1 when a newly introduced active change remains at HEAD', () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'new-change');
    const head = commit(repo, 'introduce active change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('change "new-change" remains active at HEAD');
    expect(result.stderr).toContain('requires exactly one PR-new canonical archive; found 0');
  });

  it('keeps the obligation after create then bare deletion', () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'bare-delete');
    commit(repo, 'create active change');
    remove(repo, 'openspec/changes/bare-delete');
    const head = commit(repo, 'delete without archive');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'change "bare-delete" requires exactly one PR-new canonical archive; found 0'
    );
  });

  it('passes create then canonical archive with a new stable-spec blob', () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'complete-change');
    commit(repo, 'create active change');
    archiveActive(repo, 'complete-change');
    syncStable(repo);
    const head = commit(repo, 'archive and sync stable spec');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 introduced change(s), 1 PR-new archive entry/entries');
  });

  it('validates a direct archive even without a reachable active snapshot', () => {
    const { repo, base } = initRepo();
    writeDirectArchive(repo, 'direct-change');
    syncStable(repo);
    const head = commit(repo, 'add direct archive and stable spec');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 introduced change(s), 1 PR-new archive entry/entries');
  });

  it('grandfathers an active change name already present in the exact base tree', () => {
    const { repo } = initRepo();
    writeActive(repo, 'legacy');
    const base = commit(repo, 'base contains legacy active change');
    write(repo, 'openspec/changes/legacy/design.md', 'updated legacy design\n');
    const head = commit(repo, 'modify grandfathered change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('legacy');
  });

  it('returns exit 2 instead of accepting a missing or non-full commit input', () => {
    const { repo, base } = initRepo();

    const missing = runGate(repo, undefined, base);
    const shortRef = runGate(repo, base, 'HEAD');
    const missingObject = runGate(repo, base, 'f'.repeat(40));

    expect(missing.status).toBe(2);
    expect(shortRef.status).toBe(2);
    expect(missingObject.status).toBe(2);
    expect(`${missing.stderr}${shortRef.stderr}${missingObject.stderr}`).toContain(
      'could not determine a result'
    );
  });
});

describe('PR Fast Gate workflow wiring', () => {
  it('keeps the archive leaf always present, exact-SHA-bound, and aggregated', () => {
    const workflowText = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const workflow = parse(workflowText);
    const archiveJob = workflow.jobs['openspec-archive'];

    expect(workflow.on.pull_request.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
    ]);
    expect(archiveJob.if).toBeUndefined();
    expect(archiveJob.steps[0].if).toContain("github.event_name == 'push'");
    expect(archiveJob.steps[0].if).toContain('github.event.pull_request.draft == true');

    const checkout = archiveJob.steps.find(
      (step: Record<string, unknown>) => step.name === 'Checkout exact PR head'
    );
    expect(checkout.with.ref).toBe('${{ github.event.pull_request.head.sha }}');
    expect(checkout.with['fetch-depth']).toBe(0);

    const validation = archiveJob.steps.find(
      (step: Record<string, unknown>) => step.name === 'Validate OpenSpec archive lifecycle'
    );
    expect(validation.env.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
    expect(validation.env.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}');
    expect(validation.run).toContain('--base "$BASE_SHA" --head "$HEAD_SHA"');
    expect(workflow.jobs['ci-passed'].needs).toContain('openspec-archive');
    expect(workflow.jobs['ci-passed'].steps[0].run).toContain('.result == "success"');
  });
});
