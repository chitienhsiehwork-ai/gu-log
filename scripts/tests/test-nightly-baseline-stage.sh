#!/usr/bin/env bash
# Regression coverage for scripts/nightly-baseline-stage.sh's durable carrier
# policy: no-op unchanged files, never clobber pending progress, emit an exact
# clean-materialization handoff, and fail closed on untrustworthy remote state.
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

assert_carrier_handoff() {
  local output="$1"
  local branch="$2"
  local carrier_sha="$3"
  shift 3

  for expected in \
    "NIGHTLY_BASELINE_CARRIER" \
    "branch_ref=refs/heads/$branch" \
    "carrier_sha=$carrier_sha" \
    "base_ref=refs/heads/main" \
    "base_policy=fresh-fetch" \
    "action=clean-materialize" \
    "direct_pr=forbidden" \
    "cleanup=delete-exact-carrier-after-main-production-closure" \
    "cleanup_expected_sha=$carrier_sha"; do
    if ! grep -Fxq "$expected" <<<"$output"; then
      echo "FAIL: carrier handoff missing '$expected'" >&2
      printf '%s\n' "$output" >&2
      exit 1
    fi
  done

  for file in "$@"; do
    if ! grep -Fxq "file=$file" <<<"$output"; then
      echo "FAIL: carrier handoff missing declared file '$file'" >&2
      printf '%s\n' "$output" >&2
      exit 1
    fi
  done

  if grep -Fq "gh pr create" <<<"$output"; then
    echo "FAIL: carrier handoff must not suggest opening a PR from stale carrier ancestry" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
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
echo '{"date":"2026-01-02","kind":"second"}' >quality/second-baseline.json
create_output="$(
  bash "$SCRIPT" \
    nightly/test-create \
    "chore: test create" \
    quality/test-baseline.json \
    quality/second-baseline.json
)"
created_sha="$(remote_branch_sha nightly/test-create)"
if [ -z "$created_sha" ]; then
  echo "FAIL (test 2): expected branch to be created" >&2
  exit 1
fi
assert_carrier_handoff \
  "$create_output" \
  nightly/test-create \
  "$created_sha" \
  quality/test-baseline.json \
  quality/second-baseline.json
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
if ! preserve_output="$(
  bash "$SCRIPT" nightly/test-preserve "chore: attempted overwrite" quality/test-baseline.json
)"; then
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
assert_carrier_handoff \
  "$preserve_output" \
  nightly/test-preserve \
  "$existing_sha" \
  quality/test-baseline.json
echo "test 3 (existing branch preserved, not clobbered) passed"

# ── Test 4: existence check itself fails -> fail closed, no push ────────
setup_repo
cd "$WORK_DIR"
echo '{"date":"2026-01-04"}' >quality/test-baseline.json
git remote set-url origin "$TMP_DIR/does-not-exist.git"
set +e
failclosed_output="$(
  bash "$SCRIPT" nightly/test-failclosed "chore: should not run" quality/test-baseline.json 2>&1
)"
failclosed_status=$?
set -e
if [ "$failclosed_status" -eq 0 ]; then
  echo "FAIL (test 4): script should fail (exit non-zero) when it can't reach origin to check branch existence" >&2
  exit 1
fi
if grep -Fq "NIGHTLY_BASELINE_CARRIER" <<<"$failclosed_output"; then
  echo "FAIL (test 4): failed publish must not emit a successful carrier handoff" >&2
  printf '%s\n' "$failclosed_output" >&2
  exit 1
fi
echo "test 4 (fail closed on unreachable remote) passed"

# ── Test 5: malformed remote OID fails closed without a handoff ─────────
setup_repo
cd "$WORK_DIR"
echo '{"date":"2026-01-05"}' >quality/test-baseline.json

MALFORMED_SHIM_DIR="$TMP_DIR/malformed-shim"
mkdir -p "$MALFORMED_SHIM_DIR"
REAL_GIT="$(command -v git)"
cat >"$MALFORMED_SHIM_DIR/git" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "ls-remote" ]; then
  printf '%s\\t%s\\n' '00000000000000000000000000000000000000000' 'refs/heads/nightly/test-malformed'
  exit 0
fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$MALFORMED_SHIM_DIR/git"

set +e
malformed_output="$(
  PATH="$MALFORMED_SHIM_DIR:$PATH" \
    bash "$SCRIPT" nightly/test-malformed "chore: should not run" quality/test-baseline.json 2>&1
)"
malformed_status=$?
set -e
if [ "$malformed_status" -eq 0 ]; then
  echo "FAIL (test 5): a 41-hex remote OID must fail closed" >&2
  exit 1
fi
if grep -Fq "NIGHTLY_BASELINE_CARRIER" <<<"$malformed_output"; then
  echo "FAIL (test 5): malformed remote OID must not emit a carrier handoff" >&2
  printf '%s\n' "$malformed_output" >&2
  exit 1
fi
echo "test 5 (malformed remote OID fails closed) passed"

# ── Test 6: the actual push call never carries --force ──────────────────
# The create/preserve outcomes do not reveal whether a push used `--force`:
# a new branch looks identical either way, while the preserve path exits
# before push. Shim `git` to record every invocation's argv and assert
# `push` is never called with `--force`.
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
  echo "FAIL (test 6): expected the script to actually call 'git push' on the create path" >&2
  cat "$GIT_LOG" >&2
  exit 1
fi
if grep '^push ' "$GIT_LOG" | grep -qE -- '(^|[[:space:]])(--force|-f)([[:space:]]|$)'; then
  echo "FAIL (test 6): git push was called with --force/-f — this is exactly the destructive behavior this script exists to remove" >&2
  cat "$GIT_LOG" >&2
  exit 1
fi
echo "test 6 (push never uses --force) passed"

# ── Test 7: workflow must not instruct direct PRs from carrier ancestry ──
if grep -Eq 'gh[[:space:]]+pr[[:space:]]+create' "$ROOT_DIR/.github/workflows/nightly-deep.yml"; then
  echo "FAIL (test 7): workflow still tells agents to open direct PRs from stale carrier ancestry" >&2
  exit 1
fi
echo "test 7 (workflow forbids direct carrier PR instructions) passed"

echo "nightly-baseline-stage regression tests passed"
