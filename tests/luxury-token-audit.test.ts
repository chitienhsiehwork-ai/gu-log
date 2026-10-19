import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AUDIT = path.join(ROOT, 'scripts/luxury-token-audit.sh');
const tempRoots = new Set<string>();

afterEach(() => {
  for (const tempRoot of tempRoots) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe('luxury token audit', () => {
  it('reports a healthy empty result with exit 0', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-luxury-audit-'));
    tempRoots.add(fixtureRoot);

    const result = spawnSync('bash', [AUDIT], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Total LUXURY_TOKEN markers: 0');
    expect(result.stdout).toContain('=== By file (hotspots) ===');
    expect(result.stdout).toContain('=== All markers with context ===');
  });

  it('still fails closed when grep reports an operational error', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-luxury-audit-'));
    const binDir = path.join(fixtureRoot, 'bin');
    const grepShim = path.join(binDir, 'grep');
    const callLog = path.join(fixtureRoot, 'grep-calls.log');
    tempRoots.add(fixtureRoot);
    fs.mkdirSync(binDir);
    fs.writeFileSync(
      grepShim,
      '#!/usr/bin/env bash\nprintf "call\\n" >> "$GREP_CALL_LOG"\nexit 2\n'
    );
    fs.chmodSync(grepShim, 0o755);

    const result = spawnSync('bash', [AUDIT], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        GREP_CALL_LOG: callLog,
      },
    });

    expect(result.status).toBe(2);
    expect(fs.readFileSync(callLog, 'utf8')).toBe('call\n');
  });
});
