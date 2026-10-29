/**
 * scripts/check-gp-promotion.mjs（openspec gp-signature-picks〈新變成 GP 的檔案 SHALL 在
 * pre-commit 與 CI 通過 publish bar〉）：純函式核心，加上在暫存 git repo 跑 `--staged` 與
 * `--base=<sha>`，以及 pre-commit、CI 都接上同一支檢查。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { evaluateGpPromotion } from '../scripts/check-gp-promotion.mjs';
import { meetsPublishBar } from '../src/utils/tribunal-scores';
import { scorecard } from './helpers/publish-bar-scorecard';
import { useTestTempDirectories } from './helpers/temp-directories';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-gp-promotion.mjs');
const POSTS = 'src/content/posts';
const makeTempDirectory = useTestTempDirectories();

const post = (ticketId: string, n: number | null, extra: Record<string, unknown> = {}) =>
  `---\n${YAML.stringify({ ticketId, title: 'T', ...(n === null ? {} : { scores: scorecard(n) }), ...extra })}---\n\n正文。\n`;

const evaluate = (changes: Array<{ path: string; base: string | null; head: string }>) =>
  evaluateGpPromotion(changes, meetsPublishBar as (scores: unknown) => boolean);

describe('evaluateGpPromotion', () => {
  it('fails an MP renamed into GP below the publish bar, and names the file', () => {
    const file = `${POSTS}/gp-30-20260102-beta.mdx`;
    const errors = evaluate([{ path: file, base: null, head: post('GP-30', 6) }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(file);
  });

  it('passes an MP renamed into GP that clears the publish bar', () => {
    const file = `${POSTS}/en-gp-30-20260102-beta.mdx`;
    expect(evaluate([{ path: file, base: null, head: post('GP-30', 9) }])).toEqual([]);
  });

  it('checks a ticketId changed to GP in place', () => {
    const file = `${POSTS}/mp-20-20260102-beta.mdx`;
    expect(evaluate([{ path: file, base: post('MP-20', 6), head: post('GP-30', 6) }])).toHaveLength(
      1
    );
  });

  it('does not check a file that already was GP, even when its new scores fall below the bar', () => {
    const file = `${POSTS}/gp-30-20260102-beta.mdx`;
    expect(evaluate([{ path: file, base: post('GP-30', 9), head: post('GP-30', 6) }])).toEqual([]);
    const takenDown = post('GP-30', null, { status: 'taken-down' });
    expect(evaluate([{ path: file, base: post('GP-30', 9), head: takenDown }])).toEqual([]);
  });

  it.each(['gp-pending-20260102-beta.mdx', 'en-gp-pending-20260102-beta.mdx'])(
    'always fails a new %s',
    (name) => {
      const errors = evaluate([
        { path: `${POSTS}/${name}`, base: null, head: post('GP-PENDING', 9) },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('reclassify-post.mjs');
    }
  );

  it('ignores posts that are not GP', () => {
    const file = `${POSTS}/mp-40-20260101-alpha.mdx`;
    expect(evaluate([{ path: file, base: null, head: post('MP-40', 6) }])).toEqual([]);
  });
});

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
const commit = (cwd: string, message: string) =>
  git(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message]);
const check = (cwd: string, arg: string) =>
  spawnSync(process.execPath, [SCRIPT, arg], { cwd, encoding: 'utf8' });

function makeRepo(mp: number) {
  const repo = makeTempDirectory('gu-log-gp-promotion-');
  fs.mkdirSync(path.join(repo, POSTS), { recursive: true });
  fs.writeFileSync(path.join(repo, POSTS, 'mp-20-20260102-beta.mdx'), post('MP-20', mp));
  fs.writeFileSync(path.join(repo, POSTS, 'gp-5-20260101-old.mdx'), post('GP-5', 9));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['add', '-A']);
  commit(repo, 'base');
  return { repo, base: git(repo, ['rev-parse', 'HEAD']).trim() };
}

function promote(repo: string) {
  const from = `${POSTS}/mp-20-20260102-beta.mdx`;
  const to = `${POSTS}/gp-30-20260102-beta.mdx`;
  git(repo, ['mv', from, to]);
  const file = path.join(repo, to);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('MP-20', 'GP-30'));
  git(repo, ['add', '-A']);
}

describe('check-gp-promotion.mjs in a git repo', () => {
  it.each([
    [6, 1],
    [9, 0],
  ])('a promotion with every score at %i exits %i, staged and against a base', (n, code) => {
    const { repo, base } = makeRepo(n);
    promote(repo);
    const staged = check(repo, '--staged');
    expect(staged.status, staged.stdout + staged.stderr).toBe(code);
    commit(repo, 'promote');
    const range = check(repo, `--base=${base}`);
    expect(range.status, range.stdout + range.stderr).toBe(code);
    if (code) expect(range.stderr).toContain('gp-30-20260102-beta.mdx');
  });

  it('lets an existing GP write back a lower score', () => {
    const { repo } = makeRepo(9);
    const file = path.join(repo, POSTS, 'gp-5-20260101-old.mdx');
    fs.writeFileSync(file, post('GP-5', 6));
    git(repo, ['add', '-A']);
    expect(check(repo, '--staged').status).toBe(0);
  });

  it('fails when the base cannot be read', () => {
    const { repo } = makeRepo(9);
    const result = check(repo, '--base=0000000000000000000000000000000000000000');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('取不到基準版本');
  });
});

describe('the same check gates pre-commit and CI', () => {
  it('pre-commit runs it on the staged changes', () => {
    const hook = fs.readFileSync(path.join(ROOT, 'scripts/hooks/pre-commit'), 'utf8');
    expect(hook).toContain('scripts/check-gp-promotion.mjs" --staged');
  });

  it('CI runs it against the PR base in a job that gates ci-passed', () => {
    const ci = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
    const jobs = Object.entries(ci.jobs as Record<string, { steps?: Array<{ run?: string }> }>);
    const owner = jobs.find(([, job]) =>
      job.steps?.some((step) => step.run?.includes('check-gp-promotion.mjs "--base=$BASE_SHA"'))
    );
    expect(owner).toBeDefined();
    expect(ci.jobs['ci-passed'].needs).toContain(owner![0]);
  });
});
