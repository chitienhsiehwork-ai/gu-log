import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT_TRIBUNAL_VERSION, LEGACY_TRIBUNAL_VERSION } from '../scripts/tribunal-version.mjs';
import * as frontmatterScores from '../scripts/frontmatter-scores.mjs';

const ROOT = path.resolve(__dirname, '..');
const VERSION_SCRIPT = path.join(ROOT, 'scripts', 'tribunal-version.mjs');
const SHELL_CALLERS = [
  'scripts/tribunal.sh',
  'scripts/tribunal-batch-runner.sh',
  'scripts/tribunal-quota-loop.sh',
] as const;

describe('Tribunal schema version SSOT', () => {
  it('exports one current/legacy pair and frontmatter-scores re-exports it', () => {
    expect(CURRENT_TRIBUNAL_VERSION).toBe(9);
    expect(LEGACY_TRIBUNAL_VERSION).toBe(8);
    expect(CURRENT_TRIBUNAL_VERSION).toBe(LEGACY_TRIBUNAL_VERSION + 1);
    expect(frontmatterScores.CURRENT_TRIBUNAL_VERSION).toBe(CURRENT_TRIBUNAL_VERSION);
    expect(frontmatterScores.LEGACY_TRIBUNAL_VERSION).toBe(LEGACY_TRIBUNAL_VERSION);
  });

  it('prints the same versions for shell callers', () => {
    expect(execFileSync(process.execPath, [VERSION_SCRIPT], { encoding: 'utf8' }).trim()).toBe(
      String(CURRENT_TRIBUNAL_VERSION)
    );
    expect(
      execFileSync(process.execPath, [VERSION_SCRIPT, 'current'], { encoding: 'utf8' }).trim()
    ).toBe(String(CURRENT_TRIBUNAL_VERSION));
    expect(
      execFileSync(process.execPath, [VERSION_SCRIPT, 'legacy'], { encoding: 'utf8' }).trim()
    ).toBe(String(LEGACY_TRIBUNAL_VERSION));
  });

  it('prints versions when invoked through a symlinked CLI path', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'tribunal-version-realpath-'));
    const tempScript = path.join(tempRoot, 'tribunal-version.mjs');
    symlinkSync(VERSION_SCRIPT, tempScript);

    expect(
      execFileSync(process.execPath, [tempScript, 'current'], { encoding: 'utf8' }).trim()
    ).toBe(String(CURRENT_TRIBUNAL_VERSION));
  });

  it.each(SHELL_CALLERS)('%s reads the SSOT instead of carrying a numeric copy', (relativePath) => {
    const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
    expect(source).toContain('tribunal-version.mjs');
    expect(source).not.toMatch(/^\s*TRIBUNAL_VERSION=\d+\s*$/m);
  });

  it.each(['', 'not-a-version'])(
    'all shell callers fail closed with exit 78 when the SSOT CLI prints %j',
    (fakeOutput) => {
      const fakeBin = mkdtempSync(path.join(tmpdir(), 'tribunal-version-node-'));
      const fakeNode = path.join(fakeBin, 'node');
      writeFileSync(fakeNode, `#!/bin/sh\nprintf '%s' '${fakeOutput}'\n`);
      chmodSync(fakeNode, 0o755);

      for (const relativePath of SHELL_CALLERS) {
        const result = spawnSync('bash', [path.join(ROOT, relativePath), '--help'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
        });

        expect(result.status, `${relativePath}\n${result.stdout}\n${result.stderr}`).toBe(78);
        expect(result.stderr).toContain('invalid Tribunal version');
      }
    }
  );
});
