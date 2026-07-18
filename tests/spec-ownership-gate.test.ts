/**
 * Regression coverage for the Playwright spec ownership gate (#585 P1-3):
 *   - scripts/check-spec-ownership.mjs
 *   - tests/spec-ownership.json
 *   - .github/workflows/ci.yml (e2e-core / spec-ownership jobs)
 *   - .github/workflows/nightly-deep.yml (coverage-ratchet job)
 *
 * Deliberately thin: the script is the single source of truth for every
 * registry/wiring rule, so re-implementing those rules here would just be
 * a second copy that can drift from what CI actually runs (the exact
 * failure mode this gate exists to prevent). This file only covers what
 * the script itself cannot: that the CI aggregate gate actually depends
 * on the two jobs this mechanism added, so the gate can't be silently
 * unwired by an unrelated ci.yml edit.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const needsBlock = ciText.slice(ciText.indexOf('ci-passed:'), ciText.indexOf('steps:', ciText.indexOf('ci-passed:')));
    expect(needsBlock).toMatch(/- spec-ownership/);
    expect(needsBlock).toMatch(/- e2e-core/);
  });

  it('workflows consume --list via a checked assignment, not an inline $(...) that swallows exit codes', () => {
    // bash -e does not check the exit code of a command substitution used
    // as bare arguments — `cmd $(failing-command)` keeps running with an
    // empty expansion, which here would mean Playwright silently runs
    // every spec in the project instead of failing the step. A checked
    // assignment (`SPECS=$(...)`) is fine because -e DOES check assignment
    // exit codes. This isn't re-testing validator policy (the two tests
    // above already do that) — it's shell/YAML integration behavior the
    // script itself cannot see.
    for (const wf of ['.github/workflows/ci.yml', '.github/workflows/nightly-deep.yml']) {
      const text = fs.readFileSync(path.join(ROOT, wf), 'utf8');
      expect(text, `${wf} must not inline $(node scripts/check-spec-ownership.mjs into the playwright args`).not.toMatch(
        /playwright test[^\n]*(\\\n[^\n]*)*\$\(node scripts\/check-spec-ownership\.mjs/
      );
      expect(text, `${wf} must assign --list output to a variable under set -e so a failure aborts the step`).toMatch(
        /=\$\(node scripts\/check-spec-ownership\.mjs --list /
      );
      expect(text, `${wf}'s --list step must run under set -euo pipefail`).toMatch(/set -euo pipefail/);
    }
  });
});
