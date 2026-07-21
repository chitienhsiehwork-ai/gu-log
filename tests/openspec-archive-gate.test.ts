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

const TEST_CASES = {
  scenarioLedger: 'maps every delta-spec scenario to named executable or rollout evidence',
  noChange: 'passes when valid base/head trees introduce no OpenSpec change',
  activeRemains: 'returns exit 1 when a newly introduced active change remains at HEAD',
  bareDeletion: 'keeps the obligation after create then bare deletion',
  completeArchive: 'passes create then canonical archive with a new stable-spec blob',
  directArchive: 'validates a direct archive even without a reachable active snapshot',
  grandfatheredActive: 'grandfathers an active change name already present in the exact base tree',
  grandfatheredAndNew: 'grandfathers a base-active name while enforcing a different PR-new change',
  activeRename: 'keeps obligations for both names when a PR renames an active change',
  reusedArchive: '3.5 rejects a reused base archive and zero matching PR-new archives',
  malformedEntries: '3.5 rejects invalid dates, empty names, and non-directory archive entries',
  multipleArchives: '3.5 rejects multiple matching PR-new canonical archives',
  invalidArtifacts: '3.6 rejects missing, empty, and non-regular mandatory artifacts',
  dummyArchive: '3.6 rejects a dummy canonical archive with no planning artifacts or delta spec',
  missingNearestPath: '3.6 rejects an archive that drops a path from the nearest active snapshot',
  invalidStableEvidence: '3.7 rejects missing, unchanged, and mode-only stable-spec evidence',
  validStableEvidence: '3.7 accepts a newly added stable spec or a changed stable-spec blob',
  allTargetsValid: '3.8 passes only when every introduced change and archive entry is compliant',
  deterministicFindings: '3.8 reports every violating target in deterministic order',
  invalidInputs: '3.9 fail-closes missing, invalid, non-commit, missing-object, and shallow inputs',
  exactInputsIgnoreMutableState:
    '3.9 ignores moving remote refs and dirty working-tree state for exact SHAs',
  nonAncestorGraph: '3.9 evaluates exact non-ancestor base/head graph tips without a fallback ref',
  nearestNotUnion: '3.10 uses the nearest active snapshot instead of the historical path union',
  nearestPathsRequired: '3.10 still requires every path in the nearest active snapshot',
  mergeSingleFrontier: '3.11 accepts a merge DAG with one nearest active snapshot',
  mergeSameFrontier: '3.11 accepts tied nearest snapshots with identical path sets',
  mergeConflictingFrontier: '3.11 fail-closes tied nearest snapshots with conflicting path sets',
  workflowWiring: 'keeps the archive leaf always present, exact-SHA-bound, and aggregated',
} as const;

type TestCaseName = (typeof TEST_CASES)[keyof typeof TEST_CASES];
type ScenarioEvidence =
  | {
      tier: 'tier-1-cli' | 'tier-1-workflow';
      tests: readonly TestCaseName[];
    }
  | {
      tier: 'tier-2-rollout';
      evidence: string;
    };

// This is the apply handoff's executable scenario ledger. Git graph/tree and
// workflow-shape claims are Tier-1; GitHub's live event scheduling/ruleset
// selection remains Tier-2 rollout evidence owned by the controller.
const SCENARIO_TIERS = {
  'Ready PR 的 archive leaf 失敗': {
    tier: 'tier-1-workflow',
    tests: [TEST_CASES.workflowWiring],
  },
  'Push event 不需要判定 PR archive': {
    tier: 'tier-1-workflow',
    tests: [TEST_CASES.workflowWiring],
  },
  'Archive gate 維持既有 aggregate 介面': {
    tier: 'tier-1-workflow',
    tests: [TEST_CASES.workflowWiring],
  },
  'Remote branch 在 workflow 執行期間移動': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.exactInputsIgnoreMutableState],
  },
  'Exact commit 輸入缺失或無效': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.invalidInputs],
  },
  '有效 base tree 尚無 changes 目錄': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.noChange, TEST_CASES.nonAncestorGraph],
  },
  'PR 保留既有 active change': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.grandfatheredActive],
  },
  'Grandfathered change 與新 change 並存': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.grandfatheredAndNew],
  },
  'Active change 在後續 commit 被直接刪除': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.bareDeletion],
  },
  'Active change 仍留在 HEAD': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.activeRemains],
  },
  'HEAD 有且僅有一個新 canonical archive': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.completeArchive],
  },
  'Archive 重用、格式錯誤或不唯一': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.reusedArchive, TEST_CASES.malformedEntries, TEST_CASES.multipleArchives],
  },
  '同一個 commit 直接加入 canonical archive': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.directArchive],
  },
  'PR-new archive entry malformed': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.malformedEntries],
  },
  'PR 內 rename active change': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.activeRename],
  },
  'Archive 包含 mandatory spec-driven artifacts': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.completeArchive, TEST_CASES.invalidArtifacts],
  },
  'Archive 保留最近 active snapshot frontier 的相對 paths': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.nearestNotUnion, TEST_CASES.nearestPathsRequired],
  },
  'Merge DAG 的最近 snapshots 互相矛盾': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.mergeConflictingFrontier],
  },
  'Matching archive 只是 dummy shape': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.invalidArtifacts, TEST_CASES.dummyArchive, TEST_CASES.missingNearestPath],
  },
  'Delta spec 未產生新 stable-spec blob': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.invalidStableEvidence],
  },
  'Delta spec 與 stable spec 一起完成': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.completeArchive, TEST_CASES.validStableEvidence],
  },
  'Stable spec 只有 file mode 改變': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.invalidStableEvidence],
  },
  '一個 change 完成但另一個只刪除': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.deterministicFindings],
  },
  '多個 changes 全部完成': {
    tier: 'tier-1-cli',
    tests: [TEST_CASES.allTargetsValid],
  },
  'Draft 在相同 head SHA 轉為 ready': {
    tier: 'tier-2-rollout',
    evidence: 'controller-owned live draft-to-ready run evidence',
  },
  'Ready run 的 archive leaf 未明確成功': {
    tier: 'tier-1-workflow',
    tests: [TEST_CASES.workflowWiring],
  },
  'Ready run 完整通過': {
    tier: 'tier-2-rollout',
    evidence: 'controller-owned live ready-run ci-passed evidence',
  },
} as const satisfies Record<string, ScenarioEvidence>;

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

function symlink(repo: string, relativePath: string, target = 'fixture-target'): void {
  const linkPath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
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

function shallowClone(repo: string): string {
  const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-openspec-shallow-'));
  tempRepos.add(cloneRoot);
  const clone = path.join(cloneRoot, 'repo');
  execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${repo}`, clone]);
  return clone;
}

function switchNewBranch(repo: string, name: string, start: string): void {
  git(repo, 'switch', '--quiet', '--create', name, start);
}

function switchBranch(repo: string, name: string): void {
  git(repo, 'switch', '--quiet', name);
}

function beginMerge(repo: string, branch: string): void {
  git(repo, 'merge', '--quiet', '--no-ff', '--no-commit', branch);
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

function findingLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('- '));
}

afterEach(() => {
  for (const repo of tempRepos) fs.rmSync(repo, { recursive: true, force: true });
  tempRepos.clear();
});

describe('OpenSpec archive gate CLI — exact committed-tree lifecycle', () => {
  it(TEST_CASES.scenarioLedger, () => {
    const evidenceEntries = Object.values(SCENARIO_TIERS);
    const knownTestNames = new Set<TestCaseName>(Object.values(TEST_CASES));

    expect(Object.keys(SCENARIO_TIERS)).toHaveLength(27);
    expect(evidenceEntries.filter((entry) => entry.tier === 'tier-2-rollout')).toHaveLength(2);
    for (const entry of evidenceEntries) {
      if (entry.tier === 'tier-2-rollout') {
        expect(entry.evidence).not.toBe('');
        continue;
      }
      expect(entry.tests.length).toBeGreaterThan(0);
      for (const testName of entry.tests) expect(knownTestNames.has(testName)).toBe(true);
    }
  });

  it(TEST_CASES.noChange, () => {
    const { repo, base } = initRepo();
    write(repo, 'unrelated.txt', 'unrelated committed change\n');
    const head = commit(repo, 'unrelated change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 introduced change(s)');
  });

  it(TEST_CASES.activeRemains, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'new-change');
    const head = commit(repo, 'introduce active change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('change "new-change" remains active at HEAD');
    expect(result.stderr).toContain('requires exactly one PR-new canonical archive; found 0');
  });

  it(TEST_CASES.bareDeletion, () => {
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

  it(TEST_CASES.completeArchive, () => {
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

  it(TEST_CASES.directArchive, () => {
    const { repo, base } = initRepo();
    writeDirectArchive(repo, 'direct-change');
    syncStable(repo);
    const head = commit(repo, 'add direct archive and stable spec');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 introduced change(s), 1 PR-new archive entry/entries');
  });

  it(TEST_CASES.grandfatheredActive, () => {
    const { repo } = initRepo();
    writeActive(repo, 'legacy');
    const base = commit(repo, 'base contains legacy active change');
    write(repo, 'openspec/changes/legacy/design.md', 'updated legacy design\n');
    const head = commit(repo, 'modify grandfathered change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('legacy');
  });

  it(TEST_CASES.grandfatheredAndNew, () => {
    const { repo } = initRepo();
    writeActive(repo, 'legacy', 'legacy-capability');
    const base = commit(repo, 'base contains grandfathered active change');
    write(repo, 'openspec/changes/legacy/design.md', 'legacy remains active but changes\n');
    writeActive(repo, 'new-complete', 'new-complete-capability');
    commit(repo, 'modify legacy and introduce a different new change');
    archiveActive(repo, 'new-complete');
    syncStable(repo, 'new-complete-capability');
    const head = commit(repo, 'archive only the PR-new change');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 introduced change(s), 1 PR-new archive entry/entries');
    expect(result.stderr).not.toContain('legacy');
  });

  it(TEST_CASES.activeRename, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'old-name', 'renamed-capability');
    commit(repo, 'introduce active change under old name');
    fs.renameSync(
      path.join(repo, 'openspec/changes/old-name'),
      path.join(repo, 'openspec/changes/new-name')
    );
    const head = commit(repo, 'rename active change without archiving either name');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'change "old-name" requires exactly one PR-new canonical archive; found 0'
    );
    expect(result.stderr).toContain('change "new-name" remains active at HEAD');
    expect(result.stderr).toContain(
      'change "new-name" requires exactly one PR-new canonical archive; found 0'
    );
  });

  it(TEST_CASES.reusedArchive, () => {
    const { repo } = initRepo();
    writeDirectArchive(repo, 'reused-archive', 'reused-capability', '2026-07-01');
    syncStable(repo, 'reused-capability');
    const base = commit(repo, 'base already contains an old archive');
    writeActive(repo, 'reused-archive', 'reused-capability');
    commit(repo, 'reintroduce active change with the old name');
    remove(repo, 'openspec/changes/reused-archive');
    const head = commit(repo, 'delete reintroduced change without a new archive');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'change "reused-archive" requires exactly one PR-new canonical archive; found 0'
    );
  });

  it(TEST_CASES.malformedEntries, () => {
    const { repo, base } = initRepo();
    writeTree(repo, 'openspec/changes/archive/2026-02-30-invalid-date');
    writeTree(repo, 'openspec/changes/archive/2026-07-20-');
    write(repo, 'openspec/changes/archive/2026-07-20-blob-entry', 'not a directory\n');
    const head = commit(repo, 'add malformed archive entries');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(findingLines(result.stderr)).toEqual([
      '- archive entry "openspec/changes/archive/2026-02-30-invalid-date" must be a canonical YYYY-MM-DD-<change> directory.',
      '- archive entry "openspec/changes/archive/2026-07-20-" must be a canonical YYYY-MM-DD-<change> directory.',
      '- archive entry "openspec/changes/archive/2026-07-20-blob-entry" must be a canonical YYYY-MM-DD-<change> directory.',
    ]);
  });

  it(TEST_CASES.multipleArchives, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'ambiguous-archive', 'ambiguous-capability');
    commit(repo, 'introduce change with ambiguous archive destination');
    remove(repo, 'openspec/changes/ambiguous-archive');
    writeDirectArchive(repo, 'ambiguous-archive', 'ambiguous-capability', '2026-07-20');
    writeDirectArchive(repo, 'ambiguous-archive', 'ambiguous-capability', '2026-07-21');
    syncStable(repo, 'ambiguous-capability');
    const head = commit(repo, 'add two matching archives');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'change "ambiguous-archive" requires exactly one PR-new canonical archive; found 2'
    );
  });

  it(TEST_CASES.invalidArtifacts, () => {
    const { repo, base } = initRepo();
    const archive = 'openspec/changes/archive/2026-07-20-broken-artifacts';
    write(repo, `${archive}/proposal.md`, '');
    symlink(repo, `${archive}/design.md`);
    write(repo, `${archive}/tasks.md`, '- [x] committed fixture\n');
    write(
      repo,
      `${archive}/specs/broken-artifacts-capability/spec.md`,
      '## ADDED Requirements\nFixture delta.\n'
    );
    syncStable(repo, 'broken-artifacts-capability');
    const head = commit(repo, 'add archive with invalid artifact shapes');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is missing at ".openspec.yaml"');
    expect(result.stderr).toContain('is empty at "proposal.md"');
    expect(result.stderr).toContain('is not a regular file at "design.md"');
  });

  it(TEST_CASES.dummyArchive, () => {
    const { repo, base } = initRepo();
    const archive = 'openspec/changes/archive/2026-07-20-dummy-archive';
    write(repo, `${archive}/dummy.txt`, 'looks archived but is not\n');
    const head = commit(repo, 'add dummy canonical archive');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is missing at "proposal.md"');
    expect(result.stderr).toContain('has no nonempty regular specs/<capability>/spec.md');
  });

  it(TEST_CASES.missingNearestPath, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'missing-nearest-path', 'nearest-capability');
    write(
      repo,
      'openspec/changes/missing-nearest-path/evidence/review.txt',
      'must survive archive\n'
    );
    commit(repo, 'record active snapshot with review evidence');
    const archive = archiveActive(repo, 'missing-nearest-path');
    remove(repo, `${archive}/evidence/review.txt`);
    syncStable(repo, 'nearest-capability');
    const head = commit(repo, 'archive without nearest snapshot evidence');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not preserve nearest active path "evidence/review.txt"');
  });

  it(TEST_CASES.invalidStableEvidence, () => {
    const missing = initRepo();
    writeDirectArchive(missing.repo, 'missing-stable', 'missing-stable-capability');
    const missingHead = commit(missing.repo, 'archive without stable spec');

    const unchanged = initRepo();
    syncStable(unchanged.repo, 'unchanged-capability', 'stable v1\n');
    const unchangedBase = commit(unchanged.repo, 'base stable spec');
    writeDirectArchive(unchanged.repo, 'unchanged-stable', 'unchanged-capability');
    const unchangedHead = commit(unchanged.repo, 'archive without changing stable blob');

    const modeOnly = initRepo();
    const stablePath = 'openspec/specs/mode-only-capability/spec.md';
    syncStable(modeOnly.repo, 'mode-only-capability', 'stable v1\n');
    const modeBase = commit(modeOnly.repo, 'base stable spec before mode change');
    writeDirectArchive(modeOnly.repo, 'mode-only-stable', 'mode-only-capability');
    fs.chmodSync(path.join(modeOnly.repo, stablePath), 0o755);
    const modeHead = commit(modeOnly.repo, 'archive with stable mode-only change');

    const missingResult = runGate(missing.repo, missing.base, missingHead);
    const unchangedResult = runGate(unchanged.repo, unchangedBase, unchangedHead);
    const modeResult = runGate(modeOnly.repo, modeBase, modeHead);

    expect(missingResult.status).toBe(1);
    expect(missingResult.stderr).toContain(
      'stable spec "openspec/specs/missing-stable-capability/spec.md" is missing'
    );
    expect(unchangedResult.status).toBe(1);
    expect(unchangedResult.stderr).toContain('has the same blob as base');
    expect(git(modeOnly.repo, 'rev-parse', `${modeBase}:${stablePath}`)).toBe(
      git(modeOnly.repo, 'rev-parse', `${modeHead}:${stablePath}`)
    );
    expect(git(modeOnly.repo, 'ls-tree', modeBase, '--', stablePath)).toContain('100644 blob');
    expect(git(modeOnly.repo, 'ls-tree', modeHead, '--', stablePath)).toContain('100755 blob');
    expect(modeResult.status).toBe(1);
    expect(modeResult.stderr).toContain('has the same blob as base');
  });

  it(TEST_CASES.validStableEvidence, () => {
    const added = initRepo();
    writeDirectArchive(added.repo, 'new-stable', 'new-stable-capability');
    syncStable(added.repo, 'new-stable-capability', 'new stable blob\n');
    const addedHead = commit(added.repo, 'archive with newly added stable spec');

    const changed = initRepo();
    syncStable(changed.repo, 'changed-capability', 'stable v1\n');
    const changedBase = commit(changed.repo, 'base stable spec before content change');
    writeDirectArchive(changed.repo, 'changed-stable', 'changed-capability');
    syncStable(changed.repo, 'changed-capability', 'stable v2\n');
    const changedHead = commit(changed.repo, 'archive with changed stable blob');

    expect(runGate(added.repo, added.base, addedHead).status).toBe(0);
    expect(runGate(changed.repo, changedBase, changedHead).status).toBe(0);
  });

  it(TEST_CASES.allTargetsValid, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'alpha-complete', 'alpha-capability');
    writeActive(repo, 'beta-complete', 'beta-capability');
    commit(repo, 'introduce two active changes');
    archiveActive(repo, 'alpha-complete', '2026-07-20');
    archiveActive(repo, 'beta-complete', '2026-07-21');
    syncStable(repo, 'alpha-capability');
    syncStable(repo, 'beta-capability');
    const head = commit(repo, 'archive and sync both changes');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 introduced change(s), 2 PR-new archive entry/entries');
  });

  it(TEST_CASES.deterministicFindings, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'good-target', 'good-capability');
    writeActive(repo, 'alpha', 'alpha-capability');
    writeActive(repo, 'zeta', 'zeta-capability');
    commit(repo, 'introduce one good and two bad targets');
    archiveActive(repo, 'good-target');
    syncStable(repo, 'good-capability');
    remove(repo, 'openspec/changes/alpha');
    write(repo, 'openspec/changes/archive/not-canonical', 'malformed archive entry\n');
    const head = commit(repo, 'complete one target and leave three violations');

    const first = runGate(repo, base, head);
    const second = runGate(repo, base, head);
    const expectedFindings = [
      '- archive entry "openspec/changes/archive/not-canonical" must be a canonical YYYY-MM-DD-<change> directory.',
      '- change "alpha" requires exactly one PR-new canonical archive; found 0.',
      '- change "zeta" remains active at HEAD.',
      '- change "zeta" requires exactly one PR-new canonical archive; found 0.',
    ];

    expect(first.status).toBe(1);
    expect(second.status).toBe(1);
    expect(first.stderr).toBe(second.stderr);
    expect(findingLines(first.stderr)).toEqual(expectedFindings);
    expect(first.stderr).not.toContain('change "good-target"');
  });

  it(TEST_CASES.invalidInputs, () => {
    const { repo, base } = initRepo();
    write(repo, 'unrelated.txt', 'committed head\n');
    const head = commit(repo, 'create exact head');
    const blobObject = git(repo, 'rev-parse', `${head}:README.md`);
    const shallowRepo = shallowClone(repo);

    const missing = runGate(repo, undefined, head);
    const shortRef = runGate(repo, base, 'HEAD');
    const nonCommit = runGate(repo, blobObject, head);
    const missingObject = runGate(repo, base, 'f'.repeat(40));
    const shallow = runGate(shallowRepo, base, head);

    expect([missing.status, shortRef.status, nonCommit.status, missingObject.status]).toEqual([
      2, 2, 2, 2,
    ]);
    expect(nonCommit.stderr).toContain('base object is blob, not a commit');
    expect(shallow.status).toBe(2);
    expect(shallow.stderr).toContain('repository history is shallow');
    expect(`${missing.stderr}${shortRef.stderr}${missingObject.stderr}`).toContain(
      'could not determine a result'
    );
  });

  it(TEST_CASES.exactInputsIgnoreMutableState, () => {
    const { repo, base } = initRepo();
    write(repo, 'unrelated.txt', 'exact committed head\n');
    const head = commit(repo, 'create exact head');
    const before = runGate(repo, base, head);

    writeActive(repo, 'moving-tip-change');
    const movingTip = commit(repo, 'move current branch beyond exact head');
    git(repo, 'update-ref', 'refs/remotes/origin/main', movingTip);
    writeActive(repo, 'dirty-working-tree-change');
    const after = runGate(repo, base, head);

    expect(git(repo, 'status', '--porcelain')).not.toBe('');
    expect(before.status).toBe(0);
    expect(after.status).toBe(0);
    expect(after.stdout).toBe(before.stdout);
    expect(after.stderr).toBe(before.stderr);
  });

  it(TEST_CASES.nonAncestorGraph, () => {
    const { repo, base: commonAncestor } = initRepo();
    write(repo, 'base-only.txt', 'exact base branch diverges here\n');
    const base = commit(repo, 'advance exact base on its own branch');
    switchNewBranch(repo, 'divergent-head', commonAncestor);
    writeDirectArchive(repo, 'divergent-archive', 'divergent-capability');
    syncStable(repo, 'divergent-capability');
    const head = commit(repo, 'complete archive on divergent head branch');
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', base, head], {
      cwd: repo,
      encoding: 'utf8',
    });

    const result = runGate(repo, base, head);

    expect(ancestry.status).toBe(1);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 introduced change(s), 1 PR-new archive entry/entries');
  });

  it(TEST_CASES.nearestNotUnion, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'nearest-not-union', 'nearest-union-capability');
    write(
      repo,
      'openspec/changes/nearest-not-union/evidence/withdrawn.txt',
      'legitimately withdrawn before archive\n'
    );
    commit(repo, 'early active snapshot with withdrawn evidence');
    remove(repo, 'openspec/changes/nearest-not-union/evidence/withdrawn.txt');
    commit(repo, 'nearest active snapshot without withdrawn evidence');
    archiveActive(repo, 'nearest-not-union');
    syncStable(repo, 'nearest-union-capability');
    const head = commit(repo, 'archive nearest snapshot only');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('withdrawn.txt');
  });

  it(TEST_CASES.nearestPathsRequired, () => {
    const { repo, base } = initRepo();
    writeActive(repo, 'nearest-complete', 'nearest-complete-capability');
    write(
      repo,
      'openspec/changes/nearest-complete/evidence/current.txt',
      'present in nearest snapshot\n'
    );
    commit(repo, 'nearest active snapshot with current evidence');
    const archive = archiveActive(repo, 'nearest-complete');
    remove(repo, `${archive}/evidence/current.txt`);
    syncStable(repo, 'nearest-complete-capability');
    const head = commit(repo, 'archive missing current evidence');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not preserve nearest active path "evidence/current.txt"');
  });

  it(TEST_CASES.mergeSingleFrontier, () => {
    const { repo, base } = initRepo();
    switchNewBranch(repo, 'single-left', base);
    writeActive(repo, 'single-frontier', 'single-frontier-capability');
    commit(repo, 'left parent has the active snapshot');
    switchNewBranch(repo, 'single-right', base);
    write(repo, 'right-only.txt', 'unrelated right branch\n');
    commit(repo, 'right parent is unrelated');
    switchBranch(repo, 'single-left');
    beginMerge(repo, 'single-right');
    archiveActive(repo, 'single-frontier');
    syncStable(repo, 'single-frontier-capability');
    const head = commit(repo, 'merge with a canonical archive');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
  });

  it(TEST_CASES.mergeSameFrontier, () => {
    const { repo, base } = initRepo();
    switchNewBranch(repo, 'same-left', base);
    writeActive(repo, 'same-frontier', 'same-frontier-capability');
    write(repo, 'left-only.txt', 'left branch marker\n');
    commit(repo, 'left parent with shared active path set');
    switchNewBranch(repo, 'same-right', base);
    writeActive(repo, 'same-frontier', 'same-frontier-capability');
    write(repo, 'right-only.txt', 'right branch marker\n');
    commit(repo, 'right parent with shared active path set');
    switchBranch(repo, 'same-left');
    beginMerge(repo, 'same-right');
    archiveActive(repo, 'same-frontier');
    syncStable(repo, 'same-frontier-capability');
    const head = commit(repo, 'merge identical nearest frontiers');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(0);
  });

  it(TEST_CASES.mergeConflictingFrontier, () => {
    const { repo, base } = initRepo();
    switchNewBranch(repo, 'conflict-left', base);
    writeActive(repo, 'conflicting-frontier', 'conflicting-frontier-capability');
    write(repo, 'openspec/changes/conflicting-frontier/evidence/left.txt', 'left-only evidence\n');
    commit(repo, 'left parent with left-only active path');
    switchNewBranch(repo, 'conflict-right', base);
    writeActive(repo, 'conflicting-frontier', 'conflicting-frontier-capability');
    write(
      repo,
      'openspec/changes/conflicting-frontier/evidence/right.txt',
      'right-only evidence\n'
    );
    commit(repo, 'right parent with right-only active path');
    switchBranch(repo, 'conflict-left');
    beginMerge(repo, 'conflict-right');
    archiveActive(repo, 'conflicting-frontier');
    syncStable(repo, 'conflicting-frontier-capability');
    const head = commit(repo, 'merge conflicting nearest frontiers');

    const result = runGate(repo, base, head);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'nearest active snapshot frontier for "conflicting-frontier" has conflicting path sets at distance 1'
    );
  });
});

describe('PR Fast Gate workflow wiring', () => {
  it(TEST_CASES.workflowWiring, () => {
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
