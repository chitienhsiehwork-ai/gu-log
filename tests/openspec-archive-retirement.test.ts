/**
 * openspec spec-driven-review-loop〈Canonical archive SHALL 保留 planning artifacts
 * 並同步 stable specs〉的退役例外：delta 只有 `## REMOVED Requirements`、base 有
 * stable spec、head 刪掉它，archive gate 視為完成同步。其餘情境見
 * tests/openspec-archive-gate.test.ts。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const CHECKER = fileURLToPath(new URL('../scripts/check-openspec-archive.mjs', import.meta.url));
const STABLE = 'openspec/specs/retired-capability/spec.md';
const ARCHIVE = 'openspec/changes/archive/2026-10-29-retire-capability';
const REMOVED_ONLY = '## REMOVED Requirements\n\n### Requirement: Old rule\n\n**Reason**: gone.\n';
const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function write(repo: string, relativePath: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(repo, relativePath), content);
}

function commit(repo: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '--allow-empty', '-q', '-m', 'fixture');
  return git(repo, 'rev-parse', 'HEAD');
}

/** Base optionally holds the stable spec; head archives `delta` and deletes it. */
function gate(delta: string, baseHasStable: boolean) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-openspec-retire-'));
  repos.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Archive Gate Test');
  git(repo, 'config', 'user.email', 'archive-gate@example.test');
  git(repo, 'config', 'commit.gpgSign', 'false');
  write(repo, 'README.md', 'fixture\n');
  if (baseHasStable) write(repo, STABLE, 'stable v1\n');
  const base = commit(repo);

  fs.rmSync(path.join(repo, STABLE), { force: true });
  write(repo, `${ARCHIVE}/.openspec.yaml`, 'schema: spec-driven\n');
  write(repo, `${ARCHIVE}/proposal.md`, '## Why\nRetire it.\n');
  write(repo, `${ARCHIVE}/design.md`, '## Design\nRetire it.\n');
  write(repo, `${ARCHIVE}/tasks.md`, '- [x] retired\n');
  write(repo, `${ARCHIVE}/specs/retired-capability/spec.md`, delta);
  const head = commit(repo);

  return spawnSync(process.execPath, [CHECKER, '--base', base, '--head', head], {
    cwd: repo,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const repo of repos.splice(0)) fs.rmSync(repo, { recursive: true, force: true });
});

describe('archive gate: retiring a whole capability', () => {
  it('passes when a removal-only delta deletes the base stable spec', () => {
    expect(gate(REMOVED_ONLY, true).status).toBe(0);
  });

  it.each([
    ['the delta also adds requirements', `${REMOVED_ONLY}\n## ADDED Requirements\n`, true],
    ['the base never had the stable spec', REMOVED_ONLY, false],
  ])('still requires the stable spec when %s', (_, delta, baseHasStable) => {
    const result = gate(delta, baseHasStable);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`stable spec "${STABLE}" is missing`);
  });
});
