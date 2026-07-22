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
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflowRunBlocks } from '../scripts/spec-ownership-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

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
`;

    expect(
      validateWorkflowRunBlocks('.github/workflows/ci.yml', mixedWorkflowFixture, {
        e2e: 'blocking',
      })
    ).toEqual([expect.stringMatching(/Bypassing second run.*checked --list blocking assignment/)]);
  });
});
