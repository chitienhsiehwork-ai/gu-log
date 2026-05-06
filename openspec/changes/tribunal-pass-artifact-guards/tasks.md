## 1. Runtime PASS postcondition

- [x] Add a postcondition script that fails if a final PASS staged diff lacks the target zh post artifact.
- [x] Require EN artifact when the EN counterpart exists.
- [x] Require `scores.tribunalVersion: 3` in published frontmatter.
- [x] Call the postcondition from `commit_progress()` before final PASS commits.

## 2. Historical audit

- [x] Add a script that scans Tribunal PASS commits and fails on progress-only commits.
- [x] Support `--range` for pre-push and `--limit` for local/manual checks.
- [x] Add regression tests for bad historical PASS and good PASS commits.

## 3. Hook and scheduled enforcement

- [x] Run audit in pre-push for pushed main/master ranges.
- [x] Add systemd service/timer templates for daily production audit.
- [x] Install and enable the daily audit timer on the VM.

## 4. Verification

- [x] `bash scripts/tests/test-tribunal-pass-artifact-guards.sh`
- [x] `bash scripts/tests/test-tribunal-publish-worker-changes.sh`
- [x] `bash scripts/tests/test-quota-controller.sh`
- [x] `bash scripts/tribunal-audit-pass-commits.sh --range 2b1bc361..HEAD`
- [x] Simulate pre-push hook on main.
- [x] Restart tribunal-loop and confirm workers sync to the guarded commit.
