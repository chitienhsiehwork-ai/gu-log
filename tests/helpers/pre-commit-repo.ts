/**
 * Shared fixtures for tests that run scripts/hooks/pre-commit against a
 * throwaway git repo. Callers own temp-directory cleanup by passing their
 * useTestTempDirectories() factory.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

export function createPreCommitFixtures(makeTempDirectory: (prefix: string) => string) {
  function makeFakeRepo(): string {
    const tmp = makeTempDirectory('gu-log-hook-');
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email test@example.com && git config user.name Test', { cwd: tmp });
    // Symlink the real repo's hooks so we exercise the actual hooks.
    fs.mkdirSync(path.join(tmp, '.githooks'));
    fs.symlinkSync(
      path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-commit'),
      path.join(tmp, '.githooks', 'pre-commit')
    );
    fs.symlinkSync(
      path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-push'),
      path.join(tmp, '.githooks', 'pre-push')
    );
    // Seed a minimal posts dir so grep -h doesn't blow up on the duplicate-
    // ticket check.
    fs.mkdirSync(path.join(tmp, 'src', 'content', 'posts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\ntmp/\n');
    return tmp;
  }

  function makeScoreGateProbeEnv(stampVerifyExit = 0): NodeJS.ProcessEnv {
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
  */source-distance.mjs)
    shift
    echo "stamp-verify-sentinel $*" >&2
    exit "$STAMP_VERIFY_EXIT"
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
      STAMP_VERIFY_EXIT: String(stampVerifyExit),
    };
  }

  return { makeFakeRepo, makeScoreGateProbeEnv };
}

export function commitAll(repo: string, message: string): string {
  execSync('git add -A', { cwd: repo });
  execSync(`git commit -q -m "${message}"`, { cwd: repo });
  return execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
}
