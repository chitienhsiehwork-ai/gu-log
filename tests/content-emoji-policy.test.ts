import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findUnapprovedEmoji, parseAddedLines } from '../scripts/check-content-emoji.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

const SCRIPT = resolve('scripts/check-content-emoji.mjs');
const POST = 'src/content/posts/gp-1-20261019-demo.mdx';
const makeTempDir = useTestTempDirectories();

const check = (text: string, approved: { path: string; emoji: string; reason: string }[] = []) =>
  findUnapprovedEmoji([{ path: POST, line: 3, text }], approved);

describe('content emoji check', () => {
  it('flags an emoji on an added line with path and line', () => {
    expect(check('上線了 🚀')).toEqual([{ path: POST, line: 3, emoji: '🚀' }]);
    expect(check('---\ntitle: 👨‍💻')).toHaveLength(1);
  });

  it('lets kaomoji through but not an emoji inside a kaomoji shell', () => {
    expect(check('Mogu 表示 (◕‿◕) 跟 (♥ω♥)')).toEqual([]);
    expect(check('(😀‿😀)')).toHaveLength(2);
  });

  it('lets an approved emoji through only in its own post', () => {
    const approved = [{ path: POST, emoji: '🎉', reason: 'ShroomDog 核准' }];
    expect(check('🎉', approved)).toEqual([]);
    expect(check('🎉 🚀', approved)).toEqual([{ path: POST, line: 3, emoji: '🚀' }]);
    expect(
      findUnapprovedEmoji([{ path: 'src/content/posts/other.mdx', line: 1, text: '🎉' }], approved)
    ).toHaveLength(1);
  });

  it('reads only added lines out of a -U0 diff', () => {
    const diff = [
      `diff --git a/${POST} b/${POST}`,
      `--- a/${POST}`,
      `+++ b/${POST}`,
      '@@ -4 +4,2 @@',
      '-舊的 🚀 這行被刪掉',
      '+新的一行',
      '+++ 開頭是加號的內容 🎉',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      { path: POST, line: 4, text: '新的一行' },
      { path: POST, line: 5, text: '++ 開頭是加號的內容 🎉' },
    ]);
  });

  it('ignores an untouched emoji line in a staged edit to the same post', () => {
    const repo = makeTempDir('content-emoji-');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
    const run = () => spawnSync('node', [SCRIPT, '--staged'], { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(join(repo, 'src/content/posts'), { recursive: true });
    writeFileSync(join(repo, POST), '舊的 🚀\n第二行\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    writeFileSync(join(repo, POST), '舊的 🚀\n第二行改過\n');
    git('add', '.');
    expect(run().status).toBe(0);

    writeFileSync(join(repo, POST), '舊的 🚀\n第二行改過 🎉\n');
    git('add', '.');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${POST}:2 未核准 emoji 🎉`);
  });
});
