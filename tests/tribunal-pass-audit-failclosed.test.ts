import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const AUDIT_SCRIPT = new URL('../scripts/tribunal-audit-pass-commits.sh', import.meta.url);

describe('Tribunal PASS commit audit', () => {
  it('fails closed when git log cannot enumerate commits', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tribunal-pass-audit-'));

    try {
      const fakeBin = path.join(root, 'bin');
      const fakeGit = path.join(fakeBin, 'git');
      mkdirSync(fakeBin);
      writeFileSync(
        fakeGit,
        `#!/usr/bin/env bash
set -euo pipefail
case "\${3:-}" in
  rev-list) exit 0 ;;
  log)
    echo "FAKE_GIT: deterministic git log failure" >&2
    exit 42
    ;;
  *)
    echo "unexpected fake git command: $*" >&2
    exit 97
    ;;
esac
`
      );
      chmodSync(fakeGit, 0o755);

      const result = spawnSync('bash', [AUDIT_SCRIPT.pathname, '--repo', root, '--range', 'HEAD'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('git log failed');
      expect(result.stderr).toContain('42');
      expect(result.stdout).not.toContain('audit passed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
