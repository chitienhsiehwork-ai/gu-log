import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECKER = path.join(ROOT, 'scripts/check-spec-impl-separation.sh');
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], {
  encoding: 'utf8',
}).trim();
const tempRepos = new Set<string>();

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-spec-wall-'));
  tempRepos.add(repo);

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Spec Wall Test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'spec-wall@example.com'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  commitAll(repo, 'seed');

  return repo;
}

function commitAll(repo: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: repo });
}

function write(repo: string, relativePath: string, contents = 'fixture\n'): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function runChecker(repo: string, base: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync('bash', [CHECKER, base], {
    cwd: repo,
    encoding: 'utf8',
    env,
  });
}

afterEach(() => {
  for (const repo of tempRepos) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  tempRepos.clear();
});

describe('check-spec-impl-separation', () => {
  it('scans only commits introduced after the base, not base-only commits', () => {
    const repo = makeRepo();
    execFileSync('git', ['branch', 'feature'], { cwd: repo });

    write(repo, 'openspec/changes/base-only/specs/capability/spec.md');
    write(repo, 'src/base-only.ts');
    commitAll(repo, 'base-only mixed commit');

    execFileSync('git', ['switch', '-q', 'feature'], { cwd: repo });
    write(repo, 'docs/feature-note.md');
    commitAll(repo, 'feature docs');

    const result = runChecker(repo, 'main');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 近似唯讀牆');
    expect(result.stdout).not.toContain('spec:');
    expect(result.stdout).not.toContain('impl:');
  });

  it('fails closed when the base cannot be resolved', () => {
    const repo = makeRepo();
    const result = runChecker(repo, 'definitely-not-a-ref');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('無法解析 base commit');
    expect(result.stdout).not.toContain('✓ 近似唯讀牆');
  });

  it('fails closed when git cannot enumerate the commit range', () => {
    const repo = makeRepo();
    const binDir = path.join(repo, 'fake-bin');
    const gitShim = path.join(binDir, 'git');
    fs.mkdirSync(binDir);
    fs.writeFileSync(
      gitShim,
      [
        '#!/usr/bin/env bash',
        'if [[ "${1:-}" == "rev-list" ]]; then',
        '  echo "simulated rev-list failure" >&2',
        '  exit 37',
        'fi',
        'exec "$REAL_GIT" "$@"',
        '',
      ].join('\n')
    );
    fs.chmodSync(gitShim, 0o755);

    const result = runChecker(repo, 'main', {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      REAL_GIT,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('無法列出 base..HEAD commit range');
    expect(result.stdout).not.toContain('✓ 近似唯讀牆');
  });

  it('keeps policy violations warn-only while reporting feature-side mixed commits', () => {
    const repo = makeRepo();
    execFileSync('git', ['switch', '-q', '-c', 'feature'], { cwd: repo });
    write(repo, 'openspec/changes/feature/specs/capability/spec.md');
    write(repo, 'src/feature.ts');
    commitAll(repo, 'feature mixed commit');

    const result = runChecker(repo, 'main');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('發現 1 個 commit');
    expect(result.stdout).toContain('spec: openspec/changes/feature/specs/capability/spec.md');
    expect(result.stdout).toContain('impl: src/feature.ts');
    expect(result.stdout).not.toContain('✓ 近似唯讀牆');
  });
});
