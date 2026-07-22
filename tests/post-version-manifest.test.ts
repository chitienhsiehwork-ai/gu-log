import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join('src', 'data', 'post-versions.json');
const SENTINEL_MANIFEST = '{\n  "sentinel-post": 42\n}\n';
const MANIFEST_MODES = [
  { label: 'generation mode', args: [] },
  { label: '--check', args: ['--check'] },
] as const;

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf-8' });
}

function repoWithFullGitHistory(cwd: string): string {
  const isShallow = run('git', ['rev-parse', '--is-shallow-repository'], cwd).trim();
  if (isShallow !== 'true') return cwd;

  // Do not unshallow the test runner's checkout in-place. Vitest runs files in
  // parallel, and mutating .git here can make hook integration tests hang.
  const origin = run('git', ['remote', 'get-url', 'origin'], cwd).trim();
  const headRef = process.env.GITHUB_HEAD_REF;
  const refName = process.env.GITHUB_REF_NAME;
  const currentBranch = run('git', ['branch', '--show-current'], cwd).trim();
  const headSha = run('git', ['rev-parse', 'HEAD'], cwd).trim();
  const candidates = [headRef, refName, currentBranch, `origin/${currentBranch}`, headSha].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  for (const ref of candidates) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-full-'));
    try {
      run(
        'git',
        ['clone', '--filter=blob:none', '--single-branch', '--branch', ref, origin, tmp],
        cwd
      );
      return tmp;
    } catch {
      // Fall through to the next candidate; the unshallow fallback below
      // is the one whose failure is worth surfacing.
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-full-'));
  try {
    run('git', ['clone', '--no-local', cwd, tmp], cwd);
    run('git', ['fetch', '--unshallow', 'origin'], tmp);
    return tmp;
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function makeSyntheticRepo(postId = 'gp-999-regression', manifest = '{}\n'): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-manifest-'));
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'data'), { recursive: true });

  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'build-version-manifest.mjs'),
    path.join(tmp, 'scripts', 'build-version-manifest.mjs')
  );

  run('git', ['init', '-q'], tmp);
  run('git', ['config', 'user.email', 'test@example.com'], tmp);
  run('git', ['config', 'user.name', 'Test'], tmp);

  fs.writeFileSync(
    path.join(tmp, 'src', 'content', 'posts', `${postId}.mdx`),
    '---\ntitle: test\n---\nbody\n'
  );
  fs.writeFileSync(path.join(tmp, MANIFEST_PATH), manifest);
  run('git', ['add', '.'], tmp);
  run('git', ['commit', '-qm', 'seed post'], tmp);

  return tmp;
}

function makeShallowClone(): string {
  const origin = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-shallow-'));
  run('git', ['clone', '-q', '--depth', '1', `file://${origin}`, clone], origin);
  expect(run('git', ['rev-parse', '--is-shallow-repository'], clone).trim()).toBe('true');
  return clone;
}

function makeGitShim(mode: 'history-failure' | 'invalid-shallow-output' | 'probe-failure'): string {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-git-shim-'));
  const realGit = run('sh', ['-c', 'command -v git'], REPO_ROOT).trim();
  const behavior = {
    'history-failure': 'for arg in "$@"; do if [ "$arg" = "log" ]; then exit 71; fi; done',
    'invalid-shallow-output':
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--is-shallow-repository" ]; then echo unknown; exit 0; fi',
    'probe-failure':
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--is-shallow-repository" ]; then exit 72; fi',
  }[mode];

  const shimPath = path.join(binDir, 'git');
  fs.writeFileSync(shimPath, `#!/bin/sh\n${behavior}\nexec "${realGit}" "$@"\n`);
  fs.chmodSync(shimPath, 0o755);
  return binDir;
}

function runManifest(repo: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, ['scripts/build-version-manifest.mjs', ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env,
  });
}

function expectSentinelUnchanged(repo: string): void {
  expect(fs.readFileSync(path.join(repo, MANIFEST_PATH), 'utf-8')).toBe(SENTINEL_MANIFEST);
}

function expectOperationalFailure(result: ReturnType<typeof runManifest>): void {
  expect(result.status).not.toBe(0);
  expect(result.stderr + result.stdout).not.toContain('post-versions.json is stale');
}

describe('post version manifest freshness', () => {
  it('fails when the committed manifest is stale relative to full git history', () => {
    const repo = makeSyntheticRepo();
    const result = spawnSync('node', ['scripts/build-version-manifest.mjs', '--check'], {
      cwd: repo,
      encoding: 'utf-8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('post-versions.json is stale');
  });

  it('keeps the production manifest fresh for Vercel shallow builds', () => {
    const repo = repoWithFullGitHistory(REPO_ROOT);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs', '--check'], {
      cwd: repo,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('post-versions.json fresh');
  }, 60_000);

  it('can precompute the manifest for staged post changes before commit', () => {
    const repo = makeSyntheticRepo();

    spawnSync('node', ['scripts/build-version-manifest.mjs'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    run('git', ['add', 'src/data/post-versions.json'], repo);
    run('git', ['commit', '-qm', 'fresh manifest'], repo);

    fs.appendFileSync(
      path.join(repo, 'src', 'content', 'posts', 'gp-999-regression.mdx'),
      '\nedit\n'
    );
    run('git', ['add', 'src/content/posts/gp-999-regression.mdx'], repo);

    const stagedResult = spawnSync(
      'node',
      ['scripts/build-version-manifest.mjs', '--include-staged'],
      {
        cwd: repo,
        encoding: 'utf-8',
      }
    );
    expect(stagedResult.status).toBe(0);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(repo, 'src', 'data', 'post-versions.json'), 'utf-8')
    );
    expect(manifest['gp-999-regression']).toBe(2);

    run('git', ['add', 'src/data/post-versions.json'], repo);
    run('git', ['commit', '-qm', 'edit post with precomputed manifest'], repo);

    const checkResult = spawnSync('node', ['scripts/build-version-manifest.mjs', '--check'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    expect(checkResult.status).toBe(0);
  }, 20_000);

  it('atomically replaces the manifest after a successful full-history build', () => {
    const repo = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
    const manifestPath = path.join(repo, MANIFEST_PATH);
    const originalInode = fs.statSync(manifestPath).ino;

    const result = runManifest(repo, []);

    expect(result.status).toBe(0);
    expect(fs.statSync(manifestPath).ino).not.toBe(originalInode);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))).toEqual({
      'gp-999-regression': 1,
    });
    expect(
      fs
        .readdirSync(path.dirname(manifestPath))
        .filter((file) => file.startsWith('.post-versions.json.') && file.endsWith('.tmp'))
    ).toEqual([]);
  });

  it('keeps historical touch counts under the current canonical path after a rename', () => {
    const repo = makeSyntheticRepo('sp-999-regression');
    const legacyPath = path.join(repo, 'src', 'content', 'posts', 'sp-999-regression.mdx');
    const canonicalPath = path.join(repo, 'src', 'content', 'posts', 'gp-999-regression.mdx');

    fs.appendFileSync(legacyPath, '\nlegacy edit\n');
    run('git', ['add', 'src/content/posts/sp-999-regression.mdx'], repo);
    run('git', ['commit', '-qm', 'edit legacy post'], repo);

    fs.renameSync(legacyPath, canonicalPath);
    fs.appendFileSync(canonicalPath, '\ncanonical taxonomy\n');
    run('git', ['add', '-A', 'src/content/posts'], repo);
    run('git', ['commit', '-qm', 'rename legacy post'], repo);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(repo, 'src', 'data', 'post-versions.json'), 'utf-8')
    );
    expect(manifest['gp-999-regression']).toBe(3);
    expect(manifest).not.toHaveProperty('sp-999-regression');
  });

  it('keeps the same second-parent lineage before and after a merge commit', () => {
    const repo = makeSyntheticRepo('gp-998-local');
    const localBranch = run('git', ['branch', '--show-current'], repo).trim();
    const legacyPath = path.join(repo, 'src', 'content', 'posts', 'legacy-999-incoming.mdx');
    const canonicalPath = path.join(repo, 'src', 'content', 'posts', 'canonical-999-merged.mdx');

    run('git', ['switch', '-qc', 'incoming'], repo);
    fs.writeFileSync(legacyPath, '---\ntitle: incoming\n---\nbody\n');
    run('git', ['add', 'src/content/posts/legacy-999-incoming.mdx'], repo);
    run('git', ['commit', '-qm', 'add incoming post'], repo);
    fs.appendFileSync(legacyPath, '\nincoming edit\n');
    run('git', ['add', 'src/content/posts/legacy-999-incoming.mdx'], repo);
    run('git', ['commit', '-qm', 'edit incoming post'], repo);

    run('git', ['switch', '-q', localBranch], repo);
    fs.appendFileSync(
      path.join(repo, 'src', 'content', 'posts', 'gp-998-local.mdx'),
      '\nlocal branch edit\n'
    );
    run('git', ['add', 'src/content/posts/gp-998-local.mdx'], repo);
    run('git', ['commit', '-qm', 'diverge local branch'], repo);

    run('git', ['merge', '--no-commit', '--no-ff', 'incoming'], repo);
    fs.renameSync(legacyPath, canonicalPath);
    run('git', ['add', '-A', 'src/content/posts'], repo);

    const preCommitResult = spawnSync(
      'node',
      ['scripts/build-version-manifest.mjs', '--include-staged'],
      {
        cwd: repo,
        encoding: 'utf-8',
      }
    );
    expect(preCommitResult.status).toBe(0);
    const preCommitManifest = JSON.parse(
      fs.readFileSync(path.join(repo, 'src', 'data', 'post-versions.json'), 'utf-8')
    );
    expect(preCommitManifest['canonical-999-merged']).toBe(2);
    expect(preCommitManifest).not.toHaveProperty('legacy-999-incoming');

    run('git', ['add', 'src/data/post-versions.json'], repo);
    run('git', ['commit', '-qm', 'merge incoming post under canonical path'], repo);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);

    const postCommitManifest = JSON.parse(
      fs.readFileSync(path.join(repo, 'src', 'data', 'post-versions.json'), 'utf-8')
    );
    expect(postCommitManifest).toEqual(preCommitManifest);
    expect(postCommitManifest['canonical-999-merged']).toBe(2);
    expect(postCommitManifest).not.toHaveProperty('legacy-999-incoming');
  }, 20_000);

  it('projects staged renames onto canonical keys before the rename commit exists', () => {
    const repo = makeSyntheticRepo('sp-999-regression');
    const legacyPath = path.join(repo, 'src', 'content', 'posts', 'sp-999-regression.mdx');
    const canonicalPath = path.join(repo, 'src', 'content', 'posts', 'gp-999-regression.mdx');

    fs.renameSync(legacyPath, canonicalPath);
    fs.appendFileSync(canonicalPath, '\ncanonical taxonomy\n');
    run('git', ['add', '-A', 'src/content/posts'], repo);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs', '--include-staged'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(repo, 'src', 'data', 'post-versions.json'), 'utf-8')
    );
    expect(manifest['gp-999-regression']).toBe(2);
    expect(manifest).not.toHaveProperty('sp-999-regression');
  });

  it('finds MERGE_HEAD through the linked worktree gitdir', () => {
    const repo = makeSyntheticRepo();
    const base = run('git', ['rev-parse', 'HEAD'], repo).trim();

    run('git', ['switch', '-qc', 'incoming'], repo);
    fs.writeFileSync(
      path.join(repo, 'src', 'content', 'posts', 'gp-1000-incoming.mdx'),
      '---\ntitle: incoming\n---\nbody\n'
    );
    run('git', ['add', 'src/content/posts/gp-1000-incoming.mdx'], repo);
    run('git', ['commit', '-qm', 'incoming post'], repo);

    const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-worktree-'));
    fs.rmSync(linked, { recursive: true, force: true });
    run('git', ['worktree', 'add', '-q', '-b', 'merge-test', linked, base], repo);
    fs.writeFileSync(
      path.join(linked, 'src', 'content', 'posts', 'gp-1001-local.mdx'),
      '---\ntitle: local\n---\nbody\n'
    );
    run('git', ['add', 'src/content/posts/gp-1001-local.mdx'], linked);
    run('git', ['commit', '-qm', 'local post'], linked);
    run('git', ['merge', '--no-commit', '--no-ff', 'incoming'], linked);

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs'], {
      cwd: linked,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('merge-aware');

    const manifest = JSON.parse(
      fs.readFileSync(path.join(linked, 'src', 'data', 'post-versions.json'), 'utf-8')
    );
    expect(manifest['gp-1000-incoming']).toBe(1);
    expect(manifest['gp-1001-local']).toBe(1);
  });
});

describe('post version manifest operational failures', () => {
  for (const { label, args } of MANIFEST_MODES) {
    it(`keeps the committed manifest on a real shallow clone in ${label}`, () => {
      const repo = makeShallowClone();

      const result = runManifest(repo, args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Shallow clone detected');
      expectSentinelUnchanged(repo);
    });

    it(`fails without git metadata and preserves manifest bytes in ${label}`, () => {
      const repo = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
      fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });

      const result = runManifest(repo, args);

      expectOperationalFailure(result);
      expectSentinelUnchanged(repo);
    });

    it(`fails when git is unavailable and preserves manifest bytes in ${label}`, () => {
      const repo = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
      const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-version-no-git-'));

      const result = runManifest(repo, args, { ...process.env, PATH: emptyPath });

      expectOperationalFailure(result);
      expectSentinelUnchanged(repo);
    });

    it(`fails when a history command fails and preserves manifest bytes in ${label}`, () => {
      const repo = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
      const shimDir = makeGitShim('history-failure');

      const result = runManifest(repo, args, {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
      });

      expectOperationalFailure(result);
      expectSentinelUnchanged(repo);
    });

    it(`fails when the shallow probe command fails and preserves manifest bytes in ${label}`, () => {
      const repo = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
      const shimDir = makeGitShim('probe-failure');

      const result = runManifest(repo, args, {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
      });

      expectOperationalFailure(result);
      expectSentinelUnchanged(repo);
    });

    it(`rejects invalid shallow probe output and preserves manifest bytes in ${label}`, () => {
      const repo = makeSyntheticRepo('gp-999-regression', SENTINEL_MANIFEST);
      const shimDir = makeGitShim('invalid-shallow-output');

      const result = runManifest(repo, args, {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
      });

      expectOperationalFailure(result);
      expectSentinelUnchanged(repo);
    });
  }
});

describe('reader-facing revision manifest', () => {
  it('changes when reader-visible body changes', async () => {
    const { computeReaderRevisionFromContent } =
      await import('../scripts/build-reader-revision-manifest.mjs');
    const before = '---\ntitle: Test\nscores:\n  tribunalVersion: 3\n---\nBody A\n';
    const after = '---\ntitle: Test\nscores:\n  tribunalVersion: 3\n---\nBody B\n';

    expect(computeReaderRevisionFromContent(before)).not.toBe(
      computeReaderRevisionFromContent(after)
    );
  });

  it('does not change for backend-only score metadata', async () => {
    const { computeReaderRevisionFromContent } =
      await import('../scripts/build-reader-revision-manifest.mjs');
    const before =
      '---\ntitle: Test\nscores:\n  tribunalVersion: 3\n  vibe:\n    score: 7\n---\nSame body\n';
    const after =
      '---\ntitle: Test\nscores:\n  tribunalVersion: 4\n  vibe:\n    score: 9\n---\nSame body\n';

    expect(computeReaderRevisionFromContent(before)).toBe(computeReaderRevisionFromContent(after));
  });
});
