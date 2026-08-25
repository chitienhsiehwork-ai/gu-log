/**
 * End-to-end test for .githooks/pre-commit and .githooks/pre-push.
 *
 * Spawns the hooks against synthetic git state and asserts they exit
 * with the documented codes. This is the only safety net that catches
 * "I edited one of the gates and broke the whole hook chain".
 *
 * IMPORTANT: these tests must NEVER touch the real repo's git index.
 * Each one operates in its own t.tmpdir() with a fresh `git init`.
 */
import { describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTestTempDirectories } from './helpers/temp-directories';

const REPO_ROOT = path.resolve(__dirname, '..');
const CANONICAL_TARGET_SLUG = 'mp-316-20260213-openclaw-setup-guide-audit';
const CANONICAL_TARGET_TITLE = 'AI 指南沒有一半都在瞎掰，先翻車的是查核方法';
const CANONICAL_TARGET_LABEL = `MP-316: ${CANONICAL_TARGET_TITLE}`;
const CANONICAL_TARGET_URL = `/posts/${CANONICAL_TARGET_SLUG}/`;
const makeTempDirectory = useTestTempDirectories();

function makeFakeRepo(): string {
  const tmp = makeTempDirectory('gu-log-hook-');
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email test@example.com && git config user.name Test', { cwd: tmp });
  // Symlink the real repo's hooks so we exercise the actual hooks.
  fs.mkdirSync(path.join(tmp, '.githooks'));
  fs.symlinkSync(
    path.join(REPO_ROOT, '.githooks', 'pre-commit'),
    path.join(tmp, '.githooks', 'pre-commit')
  );
  fs.symlinkSync(
    path.join(REPO_ROOT, '.githooks', 'pre-push'),
    path.join(tmp, '.githooks', 'pre-push')
  );
  // Seed a minimal posts dir so grep -h doesn't blow up on the duplicate-
  // ticket check.
  fs.mkdirSync(path.join(tmp, 'src', 'content', 'posts'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\ntmp/\n');
  return tmp;
}

function makeFastHookEnv(argvLog?: string): NodeJS.ProcessEnv {
  const bin = makeTempDirectory('gu-log-hook-bin-');
  for (const name of ['gitleaks', 'node', 'npx']) {
    const tool = path.join(bin, name);
    const body =
      (name === 'gitleaks' || name === 'npx') && argvLog
        ? '#!/bin/sh\nprintf \'%s\\0\' "$@" >> "$HOOK_ARGV_LOG"\nexit 0\n'
        : '#!/bin/sh\nexit 0\n';
    fs.writeFileSync(tool, body);
    fs.chmodSync(tool, 0o755);
  }
  return {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    ...(argvLog ? { HOOK_ARGV_LOG: argvLog } : {}),
  };
}

function makeScoreGateProbeEnv(): NodeJS.ProcessEnv {
  const bin = makeTempDirectory('gu-log-hook-score-bin-');
  for (const name of ['gitleaks', 'npx']) {
    const tool = path.join(bin, name);
    fs.writeFileSync(tool, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(tool, 0o755);
  }

  const node = path.join(bin, 'node');
  fs.writeFileSync(
    node,
    `#!/bin/sh
case "$1" in
  */check-staged-internal-post-links.mjs)
    exec "$REAL_NODE" "$@"
    ;;
  */reader-revision-of-stdin.mjs)
    cksum | awk '{ print $1 ":" $2 }'
    exit 0
    ;;
  */score-floor-check.mjs)
    echo score-check-sentinel
    exit 1
    ;;
esac
if [ "$2" = "--check-canonical-staged-file" ]; then
  exit 1
fi
exit 0
`
  );
  fs.chmodSync(node, 0o755);

  return {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    REAL_NODE: process.execPath,
  };
}

function seedLinkMaintenanceRepo(
  repo: string,
  sourceLabel = 'GP-53: 舊標題',
  sourceUrl = '/posts/gp-53-20260213-openclaw-setup-guide-review/'
): string {
  const post = path.join(repo, 'src', 'content', 'posts', 'mp-162-related-reading.mdx');
  const target = path.join(repo, 'src', 'content', 'posts', `${CANONICAL_TARGET_SLUG}.mdx`);
  fs.mkdirSync(path.join(repo, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.symlinkSync(
    path.join(REPO_ROOT, 'scripts', 'check-staged-internal-post-links.mjs'),
    path.join(repo, 'scripts', 'check-staged-internal-post-links.mjs')
  );
  fs.writeFileSync(path.join(repo, 'src', 'data', 'post-versions.json'), '{}\n');
  fs.writeFileSync(path.join(repo, 'src', 'data', 'post-reader-revisions.json'), '{}\n');
  fs.writeFileSync(
    post,
    `---\nticketId: MP-162\nlang: zh-tw\n---\n延伸閱讀：[${sourceLabel}](${sourceUrl})\n`
  );
  fs.writeFileSync(
    target,
    `---\nticketId: MP-316\ntitle: ${JSON.stringify(CANONICAL_TARGET_TITLE)}\nlang: zh-tw\n---\n目標文章\n`
  );
  commitAll(repo, 'base related-reading post');
  return post;
}

function runLinkMaintenanceHook(repo: string, post: string, line: string) {
  fs.writeFileSync(post, `---\nticketId: MP-162\nlang: zh-tw\n---\n${line}\n`);
  execSync('git add -A', { cwd: repo });
  return runStagedLinkMaintenanceHook(repo);
}

function runStagedLinkMaintenanceHook(repo: string) {
  return spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
    cwd: repo,
    env: makeScoreGateProbeEnv(),
    encoding: 'utf-8',
  });
}

function runLinkValidator(repo: string, post: string) {
  return spawnSync(
    process.execPath,
    [path.join(repo, 'scripts', 'check-staged-internal-post-links.mjs'), path.relative(repo, post)],
    { cwd: repo, encoding: 'utf-8' }
  );
}

function commitAll(repo: string, message: string): string {
  execSync('git add -A', { cwd: repo });
  execSync(`git commit -q -m "${message}"`, { cwd: repo });
  return execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
}

function writePost(repo: string, filename: string, ticketId: string): void {
  fs.writeFileSync(
    path.join(repo, 'src', 'content', 'posts', filename),
    `---\nticketId: ${ticketId}\n---\nbody\n`
  );
}

function runPrePush(repo: string, stdin: string) {
  linkTribunalAuditScripts(repo);
  return spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-push')], {
    cwd: repo,
    input: stdin,
    env: makeFastHookEnv(),
    encoding: 'utf-8',
  });
}

function linkTribunalAuditScripts(repo: string): void {
  const scriptsDir = path.join(repo, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const filename of ['tribunal-audit-pass-commits.sh', 'tribunal-assert-pass-artifacts.sh']) {
    const destination = path.join(scriptsDir, filename);
    if (!fs.existsSync(destination)) {
      fs.symlinkSync(path.join(REPO_ROOT, 'scripts', filename), destination);
    }
  }
}

function writeTribunalPost(repo: string, filename: string): void {
  fs.writeFileSync(
    path.join(repo, 'src', 'content', 'posts', filename),
    `---
ticketId: GP-42
scores:
  tribunalVersion: 3
  librarian:
    score: 8
  factCheck:
    score: 8
  freshEyes:
    score: 8
  vibe:
    score: 8
---
body
`
  );
}

describe('pre-commit: Gitleaks staged scan', () => {
  it('uses the supported git command with the staged index', () => {
    const repo = makeFakeRepo();
    fs.writeFileSync(path.join(repo, 'safe.txt'), 'safe content\n');
    execSync('git add safe.txt', { cwd: repo });

    const argvLog = path.join(repo, 'hook-argv.bin');
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: makeFastHookEnv(argvLog),
      encoding: 'utf-8',
    });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    const argv = fs.readFileSync(argvLog, 'utf-8').split('\0').filter(Boolean);
    expect(argv.slice(0, 3)).toEqual(['git', '--staged', '--no-banner']);
  });

  it('keeps the installed and canonical hook copies byte-identical', () => {
    expect(fs.readFileSync(path.join(REPO_ROOT, '.githooks', 'pre-commit'))).toEqual(
      fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-commit'))
    );
  });
});

describe('pre-commit: internal post-link maintenance exemption', () => {
  it('allows the real canonical post label and destination to change together', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    const r = runLinkMaintenanceHook(
      repo,
      post,
      `延伸閱讀：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})`
    );

    expect(runLinkValidator(repo, post).status).toBe(0);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('score-check-sentinel');
  });

  it('rejects reordered canonical-link lines even when every added link validates', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    fs.writeFileSync(
      post,
      `---\nticketId: MP-162\nlang: zh-tw\n---\n第一筆：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})\n第二筆：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})\n`
    );
    commitAll(repo, 'base ordered canonical links');

    fs.writeFileSync(
      post,
      `---\nticketId: MP-162\nlang: zh-tw\n---\n第二筆：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})\n第一筆：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})\n`
    );
    execSync('git add -A', { cwd: repo });
    const r = runStagedLinkMaintenanceHook(repo);

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
  });

  it('rejects prose-only reordering when no internal post link changed', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    fs.writeFileSync(
      post,
      `---\nticketId: MP-162\nlang: zh-tw\n---\n延伸閱讀：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})\n第一段\n第二段\n`
    );
    commitAll(repo, 'base prose order');

    fs.writeFileSync(
      post,
      `---\nticketId: MP-162\nlang: zh-tw\n---\n延伸閱讀：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})\n第二段\n第一段\n`
    );
    execSync('git add -A', { cwd: repo });
    const r = runStagedLinkMaintenanceHook(repo);

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
  });

  it('rejects a label-only arbitrary prose change', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo, CANONICAL_TARGET_LABEL, CANONICAL_TARGET_URL);
    const r = runLinkMaintenanceHook(
      repo,
      post,
      `延伸閱讀：[這段文案與 canonical identity 無關](${CANONICAL_TARGET_URL})`
    );

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('SCORE GATE FAILED');
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
  });

  it.each([
    ['wrong ticket', `GP-316: ${CANONICAL_TARGET_TITLE}`, CANONICAL_TARGET_URL],
    ['wrong title', 'MP-316: 這不是 target frontmatter 的標題', CANONICAL_TARGET_URL],
    ['missing target', 'MP-999: 不存在的文章', '/posts/mp-999-missing-target/'],
    ['noncanonical URL', CANONICAL_TARGET_LABEL, `/posts/${CANONICAL_TARGET_SLUG}`],
    ['locale/path mismatch', CANONICAL_TARGET_LABEL, `/en/posts/${CANONICAL_TARGET_SLUG}/`],
  ])('rejects %s', (_name, label, url) => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    const r = runLinkMaintenanceHook(repo, post, `延伸閱讀：[${label}](${url})`);

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('SCORE GATE FAILED');
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
  });

  it('rejects malformed target frontmatter', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    fs.writeFileSync(
      path.join(repo, 'src', 'content', 'posts', 'mp-317-malformed-target.mdx'),
      '---\nticketId: "MP-317\ntitle: malformed\nlang: zh-tw\n---\nbody\n'
    );
    const r = runLinkMaintenanceHook(
      repo,
      post,
      '延伸閱讀：[MP-317: malformed](/posts/mp-317-malformed-target/)'
    );

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('SCORE GATE FAILED');
  });

  it.each([
    ['a malformed canonical ticketId', 'NOT-A-CANONICAL-TICKET'],
    ['a ticketId that disagrees with the mp-316 filename', 'MP-317'],
  ])('rejects %s in staged target frontmatter', (_name, ticketId) => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    const target = path.join(repo, 'src', 'content', 'posts', `${CANONICAL_TARGET_SLUG}.mdx`);
    fs.writeFileSync(
      target,
      `---\nticketId: ${ticketId}\ntitle: ${JSON.stringify(CANONICAL_TARGET_TITLE)}\nlang: zh-tw\n---\ninvalid identity\n`
    );
    const r = runLinkMaintenanceHook(
      repo,
      post,
      `延伸閱讀：[${ticketId}: ${CANONICAL_TARGET_TITLE}](${CANONICAL_TARGET_URL})`
    );

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
  });

  it('rejects an ambiguous staged target route', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    fs.writeFileSync(
      path.join(repo, 'src', 'content', 'posts', `${CANONICAL_TARGET_SLUG.toUpperCase()}.mdx`),
      `---\nticketId: MP-316\ntitle: ${JSON.stringify(CANONICAL_TARGET_TITLE)}\nlang: zh-tw\n---\nambiguous\n`
    );
    const r = runLinkMaintenanceHook(
      repo,
      post,
      `延伸閱讀：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})`
    );

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('SCORE GATE FAILED');
  });

  it('still gates surrounding prose changes made beside a valid post link update', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    const r = runLinkMaintenanceHook(
      repo,
      post,
      `推薦閱讀：[${CANONICAL_TARGET_LABEL}](${CANONICAL_TARGET_URL})`
    );

    expect(runLinkValidator(repo, post).status).toBe(1);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('SCORE GATE FAILED');
    expect(r.stdout + r.stderr).toContain('score-check-sentinel');
  });

  it('reads canonical target identity from the staged index rather than the worktree', () => {
    const repo = makeFakeRepo();
    const post = seedLinkMaintenanceRepo(repo);
    const target = path.join(repo, 'src', 'content', 'posts', `${CANONICAL_TARGET_SLUG}.mdx`);
    const stagedTitle = `${CANONICAL_TARGET_TITLE}（staged）`;
    fs.writeFileSync(
      target,
      `---\nticketId: MP-316\ntitle: ${JSON.stringify(stagedTitle)}\nlang: zh-tw\n---\nstaged target\n`
    );
    fs.writeFileSync(
      post,
      `---\nticketId: MP-162\nlang: zh-tw\n---\n延伸閱讀：[MP-316: ${stagedTitle}](${CANONICAL_TARGET_URL})\n`
    );
    execSync('git add -A', { cwd: repo });

    fs.writeFileSync(
      target,
      `---\nticketId: MP-316\ntitle: ${JSON.stringify('worktree-only title')}\nlang: zh-tw\n---\nworktree target\n`
    );

    expect(runLinkValidator(repo, post).status).toBe(0);
  });
});

describe('pre-commit: tmp/ untracked guard (Step -0.5)', () => {
  it('blocks a tracked-file rename into ignored tmp/', () => {
    const repo = makeFakeRepo();
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked content\n');
    execSync('git add tracked.txt .gitignore && git commit -q -m base', { cwd: repo });

    fs.mkdirSync(path.join(repo, 'tmp'));
    execSync('git mv tracked.txt tmp/renamed.txt', { cwd: repo });
    expect(
      execSync('git diff --cached -M --name-status', { cwd: repo, encoding: 'utf-8' })
    ).toMatch(/^R\d+\s+tracked\.txt\s+tmp\/renamed\.txt/m);

    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: makeFastHookEnv(),
      encoding: 'utf-8',
    });

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/STAGED FILE\(S\) UNDER tmp\//);
    expect(r.stdout + r.stderr).toMatch(/tmp\/renamed\.txt/);
  });
});

describe('pre-commit: ticketId duplicate gate (Step 0)', () => {
  it('blocks when 3+ posts share a non-PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const postsDir = path.join(repo, 'src', 'content', 'posts');
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(postsDir, `dup-${i}.mdx`), `---\nticketId: GP-99\n---\nbody\n`);
    }
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: makeFastHookEnv(),
      encoding: 'utf-8',
    });
    // We expect non-zero exit and the duplicate-ID message in output.
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/DUPLICATE ticketId/);
  });

  it('allows multiple PENDING ticketIds', () => {
    const repo = makeFakeRepo();
    const postsDir = path.join(repo, 'src', 'content', 'posts');
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(
        path.join(postsDir, `pending-${i}.mdx`),
        `---\nticketId: GP-PENDING\n---\nbody\n`
      );
    }
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: makeFastHookEnv(),
      encoding: 'utf-8',
    });
    // PENDING dupes shouldn't trip Step 0. Other later steps may still
    // fail (eslint, validate-posts, etc), but the message we're asserting
    // about should not appear. CI can spend a few extra seconds in the
    // later hook chain, so keep this assertion's timeout above Vitest's
    // default instead of making the duplicate-gate test flaky.
    expect(r.stdout + r.stderr).not.toMatch(/DUPLICATE ticketId/);
  }, 15_000);
});

describe('pre-commit: staged filename portability', () => {
  it('passes space, tab, and glob-like TypeScript paths to ESLint without splitting', () => {
    const repo = makeFakeRepo();
    const filenames = ['tests/space name.ts', 'tests/tab\tname.ts', 'tests/glob[abc]*?.ts'];
    for (const filename of filenames) {
      const fullPath = path.join(repo, filename);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'export {};\n');
    }
    execSync('git add -A', { cwd: repo });

    const argvLog = path.join(repo, 'npx-argv.bin');
    const r = spawnSync('bash', [path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      cwd: repo,
      env: makeFastHookEnv(argvLog),
      encoding: 'utf-8',
    });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    const argv = fs.readFileSync(argvLog, 'utf-8').split('\0').filter(Boolean);
    const eslintStart = argv.indexOf('eslint');
    const prettierStart = argv.indexOf('prettier', eslintStart + 1);
    expect(eslintStart).toBeGreaterThanOrEqual(0);
    expect(prettierStart).toBeGreaterThan(eslintStart);
    expect(argv.slice(eslintStart + 2, prettierStart).sort()).toEqual(
      filenames.map((filename) => path.join(fs.realpathSync(repo), filename)).sort()
    );
  });
});

describe('pre-push: PENDING ticketId guard (Step 0) — real committed diff', () => {
  it('rejects a push to main whose committed diff carries a PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'gp-pending.mdx', 'GP-PENDING');
    const headSha = commitAll(repo, 'add pending post');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(
      /PENDING ticketId in commits being pushed to refs\/heads\/main/
    );
    expect(r.stdout + r.stderr).toMatch(/gp-pending\.mdx/);
  });

  it('rejects an existing post modified from a real ticketId to PENDING', () => {
    const repo = makeFakeRepo();
    writePost(repo, 'gp-existing.mdx', 'GP-42');
    const baseSha = commitAll(repo, 'base real post');
    writePost(repo, 'gp-existing.mdx', 'GP-PENDING');
    const headSha = commitAll(repo, 'restore pending ticket');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/PENDING ticketId in commits/);
    expect(r.stdout + r.stderr).toMatch(/gp-existing\.mdx/);
  });

  it('reads local_sha blobs even when a dirty worktree hides the committed PENDING value', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'gp-pending.mdx', 'GP-PENDING');
    const headSha = commitAll(repo, 'commit pending post');

    // This uncommitted edit is exactly the old fail-open: the hook used the
    // commit diff for filenames but plain grep for content, so it saw GP-42 in
    // the worktree and missed GP-PENDING in headSha.
    writePost(repo, 'gp-pending.mdx', 'GP-42');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/PENDING ticketId in commits/);
    expect(r.stdout + r.stderr).toMatch(/gp-pending\.mdx/);
  });

  it('rejects a renamed post whose committed ticketId changes to PENDING', () => {
    const repo = makeFakeRepo();
    const original = path.join(repo, 'src', 'content', 'posts', 'gp-real.mdx');
    const renamed = path.join(repo, 'src', 'content', 'posts', 'gp-renamed.mdx');
    const stableBody = Array.from({ length: 20 }, (_, i) => `stable line ${i}`).join('\n');
    fs.writeFileSync(original, `---\nticketId: GP-42\n---\n${stableBody}\n`);
    const baseSha = commitAll(repo, 'base real post');

    fs.renameSync(original, renamed);
    fs.writeFileSync(renamed, `---\nticketId: GP-PENDING\n---\n${stableBody}\n`);
    const headSha = commitAll(repo, 'rename post and restore pending ticket');

    const nameStatus = execSync(
      `git diff -M --name-status ${baseSha}..${headSha} -- src/content/posts`,
      { cwd: repo, encoding: 'utf-8' }
    );
    expect(nameStatus).toMatch(/^R\d+\s/);

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/PENDING ticketId in commits/);
    expect(r.stdout + r.stderr).toMatch(/gp-renamed\.mdx/);
  });

  it('allows the exact same committed PENDING work when pushed to a feature branch', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'gp-pending.mdx', 'GP-PENDING');
    const headSha = commitAll(repo, 'add pending post');

    const stdin = `refs/heads/feature-x ${headSha} refs/heads/feature-x ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.stdout + r.stderr).not.toMatch(/PENDING ticketId in commits/);
    expect(r.status).toBe(0);
  }, 15_000);

  it('blocks the first main push to a truly empty bare remote', () => {
    // remote_sha is all-zeros and origin/main genuinely does not exist. The
    // safe baseline is therefore the empty tree: every post in local_sha is
    // about to become remote content and must be inspected.
    const repo = makeFakeRepo();

    const originDir = makeTempDirectory('gu-log-hook-origin-');
    execSync(`git init -q --bare "${originDir}"`);
    execSync(`git remote add origin "${originDir}"`, { cwd: repo });

    writePost(repo, 'gp-pending.mdx', 'GP-PENDING');
    const headSha = commitAll(repo, 'add pending post');

    const originMain = spawnSync(
      'git',
      ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'],
      { cwd: repo }
    );
    expect(originMain.status).toBe(1);

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${'0'.repeat(40)}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/PENDING ticketId in commits/);
  });

  it('passes a push to main with a real committed diff and no PENDING ticketId', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writePost(repo, 'gp-real.mdx', 'GP-42');
    const headSha = commitAll(repo, 'add real post');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.stdout + r.stderr).not.toMatch(/PENDING ticketId in commits/);
    expect(r.status).toBe(0);
  }, 15_000);
});

describe('pre-push: post version manifest freshness', () => {
  it('fails closed when a shallow clone cannot fetch full history', () => {
    const source = makeFakeRepo();
    commitAll(source, 'shallow source base');
    fs.writeFileSync(path.join(source, 'tracked.txt'), 'second commit\n');
    const headSha = commitAll(source, 'shallow source head');

    const clone = makeTempDirectory('gu-log-hook-shallow-');
    execSync(`git clone -q --depth 1 "file://${source}" "${clone}"`);
    expect(
      execSync('git rev-parse --is-shallow-repository', {
        cwd: clone,
        encoding: 'utf-8',
      }).trim()
    ).toBe('true');

    const missingOrigin = path.join(clone, 'missing-origin.git');
    execSync(`git remote set-url origin "${missingOrigin}"`, { cwd: clone });
    const stdin = `refs/heads/feature-x ${headSha} refs/heads/feature-x ${'0'.repeat(40)}\n`;

    const result = runPrePush(clone, stdin);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'Full Git history is unavailable; cannot verify post-versions.json freshness.'
    );
    expect(
      execSync('git rev-parse --is-shallow-repository', {
        cwd: clone,
        encoding: 'utf-8',
      }).trim()
    ).toBe('true');
  });
});

describe('pre-push: Tribunal PASS artifact audit', () => {
  it('rejects a progress-only PASS commit in a pushed main range', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    fs.mkdirSync(path.join(repo, 'scores'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scores', 'tribunal-progress.json'), '{}\n');
    const headSha = commitAll(repo, 'tribunal(sample): all 4 stages PASS + final build');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/progress-only Tribunal PASS commit/);
    expect(r.stdout + r.stderr).toMatch(new RegExp(headSha));
    expect(r.stdout + r.stderr).toMatch(
      /missing staged target post artifact.*src\/content\/posts\/sample\.mdx/
    );
  });

  it('does not rescan a bad PASS commit before the pushed main range', () => {
    const repo = makeFakeRepo();
    commitAll(repo, 'base');
    fs.mkdirSync(path.join(repo, 'scores'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scores', 'tribunal-progress.json'), '{}\n');
    const remoteSha = commitAll(repo, 'tribunal(old): all 4 stages PASS + final build');
    fs.writeFileSync(path.join(repo, 'safe.txt'), 'safe\n');
    const headSha = commitAll(repo, 'unrelated safe change');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${remoteSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Tribunal PASS artifact audit passed: checked 0/);
  }, 15_000);

  it('does not audit a progress-only PASS commit pushed to a feature branch', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    fs.mkdirSync(path.join(repo, 'scores'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scores', 'tribunal-progress.json'), '{}\n');
    const headSha = commitAll(repo, 'tribunal(sample): all 4 stages PASS + final build');

    const stdin = `refs/heads/feature-x ${headSha} refs/heads/feature-x ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/Auditing Tribunal PASS commits/);
  }, 15_000);

  it('accepts a PASS commit that publishes the target post artifact', () => {
    const repo = makeFakeRepo();
    const baseSha = commitAll(repo, 'base');
    writeTribunalPost(repo, 'sample.mdx');
    const headSha = commitAll(repo, 'tribunal(sample): all 4 stages PASS + final build');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Tribunal PASS artifact audit passed: checked 1/);
  }, 15_000);

  it('audits the full reachable history when a new main has no safe baseline', () => {
    const repo = makeFakeRepo();
    commitAll(repo, 'base');
    fs.mkdirSync(path.join(repo, 'scores'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scores', 'tribunal-progress.json'), '{}\n');
    const headSha = commitAll(repo, 'tribunal(sample): all 4 stages PASS + final build');

    const stdin = `refs/heads/main ${headSha} refs/heads/main ${'0'.repeat(40)}\n`;
    const r = runPrePush(repo, stdin);

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/progress-only Tribunal PASS commit/);
  });
});

describe('pre-commit: hook script is valid bash', () => {
  it('passes bash syntax validation', () => {
    const r = spawnSync('bash', ['-n', path.join(REPO_ROOT, '.githooks', 'pre-commit')], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('passes ShellCheck for both synchronized hook copies', () => {
    const r = spawnSync(
      'shellcheck',
      ['--shell=bash', '.githooks/pre-commit', 'scripts/hooks/pre-commit'],
      { cwd: REPO_ROOT, encoding: 'utf-8' }
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe('pre-push: hook script is valid bash', () => {
  it('bash -n parses without syntax error', () => {
    const r = spawnSync('bash', ['-n', path.join(REPO_ROOT, '.githooks', 'pre-push')], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});
