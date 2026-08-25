/**
 * Regression coverage for the Playwright spec ownership gate (#585 P1-3):
 *   - scripts/check-spec-ownership.mjs
 *   - tests/spec-ownership.json
 *   - .github/workflows/ci.yml (e2e-core / spec-ownership jobs)
 *   - .github/workflows/nightly-deep.yml (coverage-ratchet job)
 *
 * Deliberately thin: the script is the single source of truth for every
 * registry/wiring rule. Tests run that validator directly against the real
 * repo and synthetic regression fixtures instead of re-implementing policy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflowRunBlocks } from '../scripts/spec-ownership-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const tempRoots = new Set<string>();

function makeQuarantineFixture(expiry: string): string {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-spec-ownership-'));
  tempRoots.add(fixtureRoot);

  for (const relativePath of [
    'scripts/check-spec-ownership.mjs',
    'scripts/spec-ownership-workflow.mjs',
    'scripts/lib/iso-day.mjs',
  ]) {
    const source = path.join(ROOT, relativePath);
    const destination = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  fs.mkdirSync(path.join(fixtureRoot, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'tests/fixture.spec.ts'), 'fixture\n');
  fs.writeFileSync(
    path.join(fixtureRoot, 'tests/spec-ownership.json'),
    JSON.stringify(
      {
        specs: {
          'tests/fixture.spec.ts': {
            class: 'quarantined',
            owner: 'test-owner',
            reason: 'Synthetic quarantine regression fixture',
            expiry,
          },
        },
      },
      null,
      2
    )
  );

  return fixtureRoot;
}

function runFixture(expiry: string) {
  return spawnSync('node', ['scripts/check-spec-ownership.mjs'], {
    cwd: makeQuarantineFixture(expiry),
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const tempRoot of tempRoots) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe('spec ownership gate', () => {
  it('passes against the real repo state (node scripts/check-spec-ownership.mjs)', () => {
    // The single source of truth for "does the registry match reality" is
    // the script itself — run it for real rather than re-implementing its
    // rules here, so this test can never drift from what CI actually runs.
    expect(() =>
      execFileSync('node', ['scripts/check-spec-ownership.mjs'], { cwd: ROOT, stdio: 'pipe' })
    ).not.toThrow();
  });

  it('ci-passed.needs includes spec-ownership and e2e-core (the gate cannot be silently unwired)', () => {
    const ciText = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const needsBlock = ciText.slice(
      ciText.indexOf('ci-passed:'),
      ciText.indexOf('steps:', ciText.indexOf('ci-passed:'))
    );
    expect(needsBlock).toMatch(/- spec-ownership/);
    expect(needsBlock).toMatch(/- e2e-core/);
  });

  it.each(['9999-99-99', '2026-02-30'])(
    'rejects impossible quarantine expiry %s instead of treating it as permanently future',
    (expiry) => {
      const result = runFixture(expiry);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('MISSING/INVALID EXPIRY');
      expect(result.stdout).not.toContain('✓ spec ownership gate passed');
    }
  );

  it('accepts a real, unexpired quarantine calendar date', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = runFixture(tomorrow);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 quarantined');
  });

  it('validates every Playwright run block instead of passing file-wide on one correct block', () => {
    const mixedWorkflowFixture = `
jobs:
  e2e:
    steps:
      - name: Correct registry-backed run
        run: |
          set -euo pipefail
          SPECS=$(node scripts/check-spec-ownership.mjs --list blocking)
          pnpm exec playwright test $SPECS
      - name: Bypassing second run
        run: pnpm exec playwright test
  future-job:
    steps:
      - run: |
          set -euo pipefail
          CASES=$(node scripts/check-spec-ownership.mjs --list nightly)
          pnpm exec playwright test \${CASES}
        env:
          NOTE: playwright test text outside the run block
`;

    expect(
      validateWorkflowRunBlocks('.github/workflows/ci.yml', mixedWorkflowFixture, {
        e2e: 'blocking',
      })
    ).toEqual([expect.stringMatching(/Bypassing second run.*checked --list blocking assignment/)]);
  });

  it('requires every Playwright command in a run block to consume the checked list', () => {
    const partlyBypassingFixture = `
jobs:
  e2e:
    steps:
      - name: One command bypasses ownership
        run: |
          set -euo pipefail
          SPECS=$(node scripts/check-spec-ownership.mjs --list blocking)
          pnpm exec playwright test $SPECS
          pnpm exec playwright test
`;

    expect(
      validateWorkflowRunBlocks('.github/workflows/ci.yml', partlyBypassingFixture, {
        e2e: 'blocking',
      })
    ).toEqual([expect.stringMatching(/One command bypasses ownership.*every Playwright test/)]);
  });
});
