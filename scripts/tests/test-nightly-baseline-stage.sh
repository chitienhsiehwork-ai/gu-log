#!/usr/bin/env bash
# Regression coverage for scripts/nightly-baseline-stage.sh's three
# behaviors: no-op when nothing changed, create when the staging branch is
# absent, and — the safety property this test exists to lock in — NEVER
# clobber a staging branch that already has unmerged progress on it. Also
# covers fail-closed behavior when the existence check itself can't be
# trusted (network/API failure), which must not be mistaken for "absent".
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/nightly-baseline-stage.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BARE_REMOTE="$TMP_DIR/remote.git"
WORK_DIR="$TMP_DIR/work"

setup_repo() {
  rm -rf "$BARE_REMOTE" "$WORK_DIR"
  git init --bare -q "$BARE_REMOTE"
  git init -q "$WORK_DIR"
  cd "$WORK_DIR"
  git config user.name "test"
  git config user.email "test@example.com"
  git remote add origin "$BARE_REMOTE"
  mkdir -p quality
  echo '{"date":"2026-01-01"}' >quality/test-baseline.json
  git add quality/test-baseline.json
  git commit -q -m "init"
  git push -q origin HEAD:main
}

remote_branch_sha() {
  git ls-remote "$BARE_REMOTE" "refs/heads/$1" | awk '{print $1}'
}

# ── Test 1: no diff -> no-op, no branch created ─────────────────────────
setup_repo
cd "$WORK_DIR"
bash "$SCRIPT" nightly/test-noop "chore: test noop" quality/test-baseline.json
if [ -n "$(remote_branch_sha nightly/test-noop)" ]; then
  echo "FAIL (test 1): branch should not have been created when there's no diff" >&2
  exit 1
fi
echo "test 1 (no-op when unchanged) passed"

# ── Test 2: branch absent -> create + push ──────────────────────────────
setup_repo
cd "$WORK_DIR"
echo '{"date":"2026-01-02"}' >quality/test-baseline.json
bash "$SCRIPT" nightly/test-create "chore: test create" quality/test-baseline.json
created_sha="$(remote_branch_sha nightly/test-create)"
if [ -z "$created_sha" ]; then
  echo "FAIL (test 2): expected branch to be created" >&2
  exit 1
fi
echo "test 2 (create when absent) passed"

# ── Test 3: branch already exists -> preserved untouched, no force-push ─
setup_repo
# Simulate a prior nightly run's unmerged progress already sitting on the
# staging branch, via a separate clone so it's not on WORK_DIR's checked-out
# branch.
OTHER_DIR="$TMP_DIR/other"
git clone -q "$BARE_REMOTE" "$OTHER_DIR"
(
  cd "$OTHER_DIR"
  git config user.name "test"
  git config user.email "test@example.com"
  git checkout -q -b nightly/test-preserve
  echo "unmerged progress from a prior run" >marker.txt
  git add marker.txt
  git commit -q -m "existing progress — must not be clobbered"
  git push -q origin nightly/test-preserve
)
existing_sha="$(remote_branch_sha nightly/test-preserve)"

cd "$WORK_DIR"
echo '{"date":"2026-01-03"}' >quality/test-baseline.json
if ! bash "$SCRIPT" nightly/test-preserve "chore: attempted overwrite" quality/test-baseline.json; then
  echo "FAIL (test 3): script should exit 0 (skip) when the branch already exists, not fail" >&2
  exit 1
fi
after_sha="$(remote_branch_sha nightly/test-preserve)"
if [ "$after_sha" != "$existing_sha" ]; then
  echo "FAIL (test 3): existing branch was overwritten! before=$existing_sha after=$after_sha" >&2
  exit 1
fi
current_branch="$(git -C "$WORK_DIR" branch --show-current)"
if [ "$current_branch" = "nightly/test-preserve" ]; then
  echo "FAIL (test 3): local working tree should not have switched onto the preserved branch" >&2
  exit 1
fi
echo "test 3 (existing branch preserved, not clobbered) passed"

# ── Test 4: existence check itself fails -> fail closed, no push ────────
setup_repo
cd "$WORK_DIR"
echo '{"date":"2026-01-04"}' >quality/test-baseline.json
git remote set-url origin "$TMP_DIR/does-not-exist.git"
if bash "$SCRIPT" nightly/test-failclosed "chore: should not run" quality/test-baseline.json; then
  echo "FAIL (test 4): script should fail (exit non-zero) when it can't reach origin to check branch existence" >&2
  exit 1
fi
echo "test 4 (fail closed on unreachable remote) passed"

# ── Test 5: the actual push call never carries --force ──────────────────
# Tests 1-4 lock in the observable *outcome* (existing branches aren't
# clobbered), but that outcome currently depends on the script never issuing
# a `--force` push in the first place — a future edit could reintroduce
# `--force` on the create path without any of the above tests catching it
# (test 2's branch doesn't pre-exist, so force vs non-force look identical;
# test 3 exits before reaching the push line at all). Shim `git` to record
# every invocation's argv and assert `push` is never called with `--force`.
setup_repo
cd "$WORK_DIR"
echo '{"date":"2026-01-05"}' >quality/test-baseline.json

SHIM_DIR="$TMP_DIR/shim"
mkdir -p "$SHIM_DIR"
GIT_LOG="$TMP_DIR/git-invocations.log"
: >"$GIT_LOG"
REAL_GIT="$(command -v git)"
cat >"$SHIM_DIR/git" <<EOF
#!/usr/bin/env bash
echo "\$@" >>"$GIT_LOG"
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$SHIM_DIR/git"

PATH="$SHIM_DIR:$PATH" bash "$SCRIPT" nightly/test-noforce "chore: test noforce" quality/test-baseline.json

if ! grep -q '^push ' "$GIT_LOG"; then
  echo "FAIL (test 5): expected the script to actually call 'git push' on the create path" >&2
  cat "$GIT_LOG" >&2
  exit 1
fi
if grep '^push ' "$GIT_LOG" | grep -qE -- '(^|[[:space:]])(--force|-f)([[:space:]]|$)'; then
  echo "FAIL (test 5): git push was called with --force/-f — this is exactly the destructive behavior this script exists to remove" >&2
  cat "$GIT_LOG" >&2
  exit 1
fi
echo "test 5 (push never uses --force) passed"

echo "nightly-baseline-stage regression tests passed"
