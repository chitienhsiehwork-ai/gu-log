## Why

Tribunal v3 previously produced PASS commits that changed only `scores/tribunal-progress.json` while the actual zh/en article rewrites and score frontmatter remained stranded in worker worktrees. This created a dangerous false-success mode:

- progress said PASS
- production content did not improve
- quota was spent on judge/writer work that was not published
- downstream operators trusted metadata that did not match deployed article files

The worker-publish fix copies artifacts back to main, but the system still needs a formal requirement that a Tribunal PASS is invalid unless the PASS commit contains the target post artifacts. This change codifies that invariant and the audit mechanisms that enforce it.

## What Changes

- Add a `tribunal-pass-artifact-guards` capability.
- Require a production postcondition before any Tribunal `all 4 stages PASS + final build` commit.
- Require a historical audit script that detects progress-only PASS commits.
- Require pre-push enforcement on new main/master ranges.
- Require a daily scheduled audit on the production VM.
- Require regression tests proving progress-only PASS commits fail loudly.

## Impact

### Affected specs

- `tribunal-pass-artifact-guards` new capability
- Complements `tribunal-safe-parallelism`, because the failure mode comes from worker worktree isolation.
- Complements `tribunal-final-build-gate`, because final build success is not sufficient unless the published artifacts are in the PASS commit.

### Affected code

Implemented by main commit `b7560d33`:

- `scripts/tribunal-assert-pass-artifacts.sh`
- `scripts/tribunal-audit-pass-commits.sh`
- `scripts/tests/test-tribunal-pass-artifact-guards.sh`
- `scripts/tribunal-all-claude.sh`
- `.githooks/pre-push`
- `scripts/tribunal-pass-audit.service`
- `scripts/tribunal-pass-audit.timer`

## Non-Goals

- This change does not re-score old articles.
- This change does not decide which salvaged rewrites are editorially acceptable.
- This change does not override weekly quota pacing.
