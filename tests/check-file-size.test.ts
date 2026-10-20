import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MAX_BYTES,
  findOversized,
  isExempt,
  parseNameStatus,
} from '../scripts/check-file-size.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

const SCRIPT = resolve('scripts/check-file-size.mjs');
const makeTempDir = useTestTempDirectories();
const BIG = MAX_BYTES + 1;

describe('file size gate', () => {
  it('blocks new files and files that cross the cap', () => {
    const found = findOversized([
      { path: 'scripts/new.mjs', newBytes: BIG, oldBytes: null },
      { path: 'scripts/grew.mjs', newBytes: BIG, oldBytes: MAX_BYTES },
      { path: 'scripts/ok.mjs', newBytes: MAX_BYTES, oldBytes: null },
    ]);
    expect(found.map((f) => f.path)).toEqual(['scripts/new.mjs', 'scripts/grew.mjs']);
  });

  it('lets an already-oversized file through unless it grows', () => {
    const legacy = (newBytes: number) => [
      { path: 'scripts/old.sh', newBytes, oldBytes: BIG + 100 },
    ];
    expect(findOversized(legacy(BIG + 100))).toEqual([]);
    expect(findOversized(legacy(BIG))).toEqual([]);
    expect(findOversized(legacy(BIG + 101))).toHaveLength(1);
  });

  it('skips files agents do not author', () => {
    for (const path of [
      'pnpm-lock.yaml',
      'src/content/posts/gp-1-demo.mdx',
      'public/artifacts/x.html',
      'src/data/post-versions.json',
      'openspec/changes/archive/2026-01-01-x/design.md',
      'src/assets/posts/x/diagram.svg',
    ])
      expect(isExempt(path), path).toBe(true);
    expect(isExempt('scripts/tribunal.sh')).toBe(false);
    expect(isExempt('src/components/Foo.astro')).toBe(false);
  });

  it('parses renames out of NUL-separated name-status output', () => {
    expect(parseNameStatus('M\0a.ts\0R087\0old.ts\0new.ts\0A\0b.ts\0')).toEqual([
      { status: 'M', path: 'a.ts', oldPath: 'a.ts' },
      { status: 'R087', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'A', path: 'b.ts', oldPath: 'b.ts' },
    ]);
  });

  it('checks staged blobs and prints split instructions', () => {
    const repo = makeTempDir('file-size-');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
    const run = () => spawnSync('node', [SCRIPT, '--staged'], { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, 'scripts/legacy.mjs'), 'x'.repeat(BIG + 10));
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    writeFileSync(join(repo, 'scripts/legacy.mjs'), 'y'.repeat(BIG + 10));
    git('add', '.');
    expect(run().status).toBe(0);

    writeFileSync(join(repo, 'scripts/new.mjs'), 'x'.repeat(BIG));
    git('add', '.');
    // 工作目錄縮小但沒 add：量的是暫存區，所以還是擋
    writeFileSync(join(repo, 'scripts/new.mjs'), 'small');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts/new.mjs');
    expect(result.stderr).toContain('照「職責」切');
    expect(result.stderr).not.toContain('legacy.mjs');
  });
});
