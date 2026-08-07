#!/usr/bin/env bash
# Regression test: a broken judge runner must stop Tribunal as infrastructure
# failure, not mark the article FAILED/EXHAUSTED.

set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "SKIP: Tribunal candidate CAS requires deployed Linux renameat2(RENAME_EXCHANGE)."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"
QUOTA_LOOP="$ROOT_DIR/scripts/tribunal-quota-loop.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

# This regression mutates the tracked gp-1 fixture. Serialize every invocation
# (direct shell runs, Vitest wrappers, and reviewer probes) before the first
# possible fixture write so concurrent processes cannot corrupt the worktree.
fixture_lock_dir="$ROOT_DIR/.score-loop/locks"
mkdir -p "$fixture_lock_dir"
chmod 700 "$fixture_lock_dir"
exec 198>>"$fixture_lock_dir/tracked-gp-1-20260128-demo.lock"
flock -x 198

if grep -Fq 'TRIBUNAL_ARTICLE_LOCK_DIR:-/tmp' "$TRIBUNAL"; then
  fail "tribunal default article lock directory must not be the shared /tmp root"
fi
pass "tribunal default article lock directory is not the shared /tmp root"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TMPDIR="$TMP"
export TRIBUNAL_SHARED_LOCK_DIR="$TMP/shared-locks"
export HOME="$TMP/home"
unset TRIBUNAL_ARTICLE_LOCK_DIR
mkdir -p "$TRIBUNAL_SHARED_LOCK_DIR"
mkdir -p "$HOME"

stat_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

snapshot_path_from_token() {
  python3 -c 'import json, sys; print(json.loads(sys.argv[1])["path"])' "$1"
}

fake_bin="$TMP/bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  echo "fake codex runner crashed before writing score" >&2
  exit 1
fi
echo "fake codex" >&2
exit 1
FAKE_CODEX
chmod +x "$fake_bin/codex"

progress="$TMP/progress.json"
printf '{}\n' > "$progress"

set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/tribunal.out" 2>"$TMP/tribunal.err"
rc=$?
set -e

default_article_lock_dir="$HOME/.local/state/gu-log/tribunal/article-locks"
[ -e "$default_article_lock_dir/tribunal-gp-1-20260128-demo.mdx.lock" ] ||
  fail "tribunal did not use the private user-global article lock directory"
[ "$(stat_mode "$default_article_lock_dir")" = "700" ] ||
  fail "default article lock directory must have mode 700"
[ "$(stat_mode "$default_article_lock_dir/tribunal-gp-1-20260128-demo.mdx.lock")" = "600" ] ||
  fail "article lock file must have mode 600"
pass "default article lock path is private and user-global"
if [ "$rc" -ne 70 ]; then
  sed -n '1,120p' "$TMP/tribunal.out" >&2 || true
  sed -n '1,120p' "$TMP/tribunal.err" >&2 || true
  fail "runner crash should exit 70, got $rc"
fi
pass "runner crash exits with temporary infrastructure failure"

article_status="$(jq -r '."gp-1-20260128-demo.mdx".status // empty' "$progress")"
stage_status="$(jq -r '."gp-1-20260128-demo.mdx".stages.factChecker.status // empty' "$progress")"
attempts="$(jq -r '."gp-1-20260128-demo.mdx".topLevelAttempts // empty' "$progress")"

[ "$article_status" = "RUNNER_ERROR" ] || fail "article status should be RUNNER_ERROR, got '$article_status'"
[ "$stage_status" = "runner_error" ] || fail "stage status should be runner_error, got '$stage_status'"
[ "$attempts" = "0" ] || fail "runner error should not consume topLevelAttempts, got '$attempts'"
pass "runner error is recorded as retryable infrastructure state"

if jq -e '."gp-1-20260128-demo.mdx".status == "FAILED" or ."gp-1-20260128-demo.mdx".status == "EXHAUSTED"' "$progress" >/dev/null; then
  fail "runner crash polluted content status as FAILED/EXHAUSTED"
fi
pass "runner crash does not become content failure/exhaustion"

# A pre-planted lock-file symlink must fail before opening the target. Opening
# the historical predictable path with ">" truncated the victim before flock.
symlink_lock_dir="$TMP/symlink-article-locks"
symlink_victim="$TMP/symlink-victim"
symlink_progress="$TMP/symlink-progress.json"
mkdir -p "$symlink_lock_dir"
chmod 700 "$symlink_lock_dir"
printf 'do-not-truncate\n' > "$symlink_victim"
printf '{}\n' > "$symlink_progress"
ln -s "$symlink_victim" "$symlink_lock_dir/tribunal-gp-1-20260128-demo.mdx.lock"
set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_ARTICLE_LOCK_DIR="$symlink_lock_dir" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$symlink_progress" \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/symlink.out" 2>"$TMP/symlink.err"
symlink_rc=$?
set -e
[ "$symlink_rc" -eq 70 ] || fail "symlinked article lock should exit 70, got $symlink_rc"
[ "$(cat "$symlink_victim")" = "do-not-truncate" ] ||
  fail "symlinked article lock truncated its target"
grep -q 'not a safe regular file' "$TMP/symlink.err" ||
  fail "symlinked article lock rejection did not explain the unsafe path"
[ "$(jq 'length' "$symlink_progress")" = "0" ] ||
  fail "symlinked article lock reached progress initialization"
pass "symlinked article lock fails closed without truncating its target"

# An explicit override still has to name a private directory. Otherwise
# another local account could pre-plant or replace the predictable lock file.
public_lock_dir="$TMP/public-article-locks"
public_progress="$TMP/public-progress.json"
mkdir -p "$public_lock_dir"
chmod 777 "$public_lock_dir"
printf '{}\n' > "$public_progress"
set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_ARTICLE_LOCK_DIR="$public_lock_dir" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$public_progress" \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/public.out" 2>"$TMP/public.err"
public_rc=$?
set -e
[ "$public_rc" -eq 70 ] || fail "group/world-writable article lock directory should exit 70, got $public_rc"
grep -q 'must not be group/world-writable' "$TMP/public.err" ||
  fail "public article lock directory rejection did not explain the unsafe mode"
[ "$(jq 'length' "$public_progress")" = "0" ] ||
  fail "public article lock directory reached progress initialization"
pass "group/world-writable article lock override fails closed"

# A held regular lock must retain the established rc=75 skipped contract.
collision_lock_dir="$TMP/collision-article-locks"
collision_lock="$collision_lock_dir/tribunal-gp-1-20260128-demo.mdx.lock"
collision_progress="$TMP/collision-progress.json"
mkdir -p "$collision_lock_dir"
chmod 700 "$collision_lock_dir"
printf '{}\n' > "$collision_progress"
exec 199>>"$collision_lock"
chmod 600 "$collision_lock"
flock -n 199
set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_ARTICLE_LOCK_DIR="$collision_lock_dir" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$collision_progress" \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/collision.out" 2>"$TMP/collision.err"
collision_rc=$?
set -e
exec 199>&-
[ "$collision_rc" -eq 75 ] || fail "held article lock should exit 75, got $collision_rc"
grep -q 'another instance is already running' "$TMP/collision.err" ||
  fail "held article lock did not report the collision"
[ "$(jq 'length' "$collision_progress")" = "0" ] ||
  fail "held article lock reached progress initialization"
pass "held article lock remains a skipped collision"

# The stage runner intentionally normalizes a watchdog kill to infrastructure
# rc=70. The supervisor must recover the original stall signal from that
# worker's isolated output and classify it as rc=124 before alerting/draining.
stall_bin="$TMP/stall-bin"
mkdir -p "$stall_bin"
cat > "$stall_bin/codex" <<'STALL_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  exec sleep 30
fi
STALL_CODEX
chmod +x "$stall_bin/codex"
stall_progress="$TMP/stall-progress.json"
stall_log="$TMP/stall-worker.log"
printf '{}\n' > "$stall_progress"
set +e
PATH="$stall_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$stall_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=20 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=1 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$stall_log" 2>&1
stall_rc=$?
set -e
[ "$stall_rc" -eq 70 ] || fail "watchdog-normalized tribunal result should be rc=70, got $stall_rc"
if ! grep -q '\[tribunal-watchdog\] idle .* no output/score-file progress' "$stall_log"; then
  sed -n '1,160p' "$stall_log" >&2 || true
  fail "actual watchdog marker missing from worker output"
fi
# shellcheck source=scripts/tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"
classified_rc="$(tribunal_classify_worker_result "$stall_rc" "$stall_log")"
[ "$classified_rc" = "124" ] ||
  fail "supervisor should classify watchdog-marked rc=70 as rc=124, got $classified_rc"
pass "actual watchdog stall propagates through supervisor classification as rc=124"

# A judge can produce valid score JSON and still fail the provenance contract.
# That infrastructure error must win over the valid content payload.
provenance_bin="$TMP/provenance-bin"
mkdir -p "$provenance_bin"
cat > "$provenance_bin/codex" <<'PROVENANCE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  prompt="${!#}"
  score_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
  [ -n "$score_path" ] || exit 2
  cat > "$score_path" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 8,
    "fidelity": 8,
    "consistency": 8,
    "sourceBoundary": 8,
    "commentarySeparation": 8
  },
  "score": 8,
  "verdict": "PASS"
}
JSON
  rm -f "$TRIBUNAL_ACTUAL_PROVIDER_FILE"
  mkdir "$TRIBUNAL_ACTUAL_PROVIDER_FILE"
  exit 0
fi
exit 1
PROVENANCE_CODEX
chmod +x "$provenance_bin/codex"

provenance_progress="$TMP/provenance-progress.json"
printf '{}\n' > "$provenance_progress"
set +e
PATH="$provenance_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$provenance_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/provenance.out" 2>"$TMP/provenance.err"
provenance_rc=$?
set -e

[ "$provenance_rc" -eq 70 ] || fail "provenance failure with valid score should exit 70, got $provenance_rc"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status' "$provenance_progress")" = "RUNNER_ERROR" ] || \
  fail "provenance failure should record RUNNER_ERROR"
[ "$(jq -r '."gp-1-20260128-demo.mdx".stages.factChecker.status' "$provenance_progress")" = "runner_error" ] || \
  fail "provenance failure should record stage runner_error"
pass "valid score cannot mask provenance runner failure"

if ! grep -q 'runner_error propagated' "$ROOT_DIR/scripts/tribunal-quota-loop.sh"; then
  fail "quota loop does not drain on tribunal runner_error"
fi
pass "quota loop drains instead of sweeping the queue after runner_error"

eval "$(sed -n '/^wait_any_worker() {/,/^}/p' "$QUOTA_LOOP")"
eval "$(sed -n '/^drain_and_exit() {/,/^}/p' "$QUOTA_LOOP")"
declare -F wait_any_worker >/dev/null || fail "unable to extract wait_any_worker"
declare -F drain_and_exit >/dev/null || fail "unable to extract drain_and_exit"

run_completion_attribution_scenario() (
  local scenario="$1"
  local scenario_dir="$TMP/completion-attribution-$scenario"
  local fixture_marker="$scenario_dir/a.claimed.123"
  local worker_result_log="$scenario_dir/worker-a.log"
  local tracking_file="$scenario_dir/a.tracking"
  local events="$scenario_dir/events.log"
  local expected_detail

  mkdir -p "$scenario_dir"
  : > "$events"
  printf 'worker evidence must survive\n' > "$worker_result_log"
  printf 'tracking evidence\n' > "$tracking_file"

  declare -A WORKER_PID=()
  declare -A WORKER_ARTICLE=()
  declare -A WORKER_RESULT_LOG=()
  declare -A WORKER_COMPLETION=()
  declare -A WORKER_TRACKING=()
  stop_requested=false
  stop_source=""
  fatal_worker_rc=0
  fatal_worker_detail=""
  WORKER_COMPLETION_DIR="$scenario_dir"
  LOG_FILE="$events"

  event() { printf '%s:%s\n' "$1" "${2:-}" >> "$events"; }
  tribunal_wait_for_worker_completion() {
    TRIBUNAL_WORKER_COMPLETION_KIND="marker"
    TRIBUNAL_WORKER_COMPLETION_MARKER="$fixture_marker"
  }
  tribunal_collect_worker_completion() { return 1; }
  tlog() { :; }
  rc_write_state() { :; }
  rc_release_claim() { event release "$1"; }
  rc_exit_stopped() { event graceful; }
  wait() {
    event wait "$1"
    return 0
  }

  case "$scenario" in
    collect)
      printf 'worker_id=a\nrc=bogus\n' > "$fixture_marker"
      WORKER_PID[a]=4242
      WORKER_ARTICLE[a]=gp-1-completion-integrity
      WORKER_RESULT_LOG[a]="$worker_result_log"
      WORKER_COMPLETION[a]="$scenario_dir/a.done"
      WORKER_TRACKING[a]="$tracking_file"
      expected_detail="worker_attribution_error worker=a pid=4242 article=gp-1-completion-integrity marker_rc=invalid claim_retained=true result_log=$worker_result_log"
      ;;
    unmatched)
      printf 'worker_id=ghost\nrc=0\n' > "$fixture_marker"
      expected_detail="worker_attribution_error worker=ghost marker_rc=0 marker=$fixture_marker"
      ;;
    *)
      fail "unknown completion attribution scenario: $scenario"
      ;;
  esac

  set +e
  wait_any_worker
  wait_rc=$?
  set -e
  [ "$wait_rc" -eq 70 ] ||
    fail "$scenario attribution mismatch should return 70, got $wait_rc"
  [ "$fatal_worker_rc" -eq 70 ] ||
    fail "$scenario attribution mismatch did not set fatal_worker_rc=70"
  [ "$fatal_worker_detail" = "$expected_detail" ] ||
    fail "$scenario attribution mismatch lost fatal detail: $fatal_worker_detail"
  [ "$stop_requested" = true ] ||
    fail "$scenario attribution mismatch did not request drain"
  [ -f "$fixture_marker" ] ||
    fail "$scenario attribution mismatch deleted its marker before fatal drain"

  if [ "$scenario" = collect ]; then
    [ -f "$worker_result_log" ] ||
      fail "collect attribution mismatch deleted the worker result log"
    ! grep -q '^release:' "$events" ||
      fail "collect attribution mismatch released an unverified claim"
    grep -qx 'wait:4242' "$events" ||
      fail "collect attribution mismatch did not reap the exact worker pid"
    [ ! -e "$tracking_file" ] ||
      fail "collect attribution mismatch retained stale active tracking"
    if [ -n "${WORKER_PID[a]+present}" ] ||
      [ -n "${WORKER_ARTICLE[a]+present}" ] ||
      [ -n "${WORKER_RESULT_LOG[a]+present}" ] ||
      [ -n "${WORKER_COMPLETION[a]+present}" ] ||
      [ -n "${WORKER_TRACKING[a]+present}" ]; then
      fail "collect attribution mismatch retained active worker bookkeeping"
    fi
  else
    ! grep -q '^wait:' "$events" ||
      fail "unmatched completion marker attempted to reap an unknown pid"
  fi

  set +e
  (drain_and_exit)
  drain_rc=$?
  set -e
  [ "$drain_rc" -eq 70 ] ||
    fail "$scenario attribution mismatch drained with rc=$drain_rc instead of 70"
  ! grep -q '^graceful:' "$events" ||
    fail "$scenario attribution mismatch was rewritten as stopped_by_request"
)

run_completion_attribution_scenario collect
pass "worker completion attribution failure retains evidence and exits 70"
run_completion_attribution_scenario unmatched
pass "unmatched completion markers remain fatal infrastructure errors"

old_bin="$TMP/old-bin"
mkdir -p "$old_bin"
cat > "$old_bin/codex" <<'OLD_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "old codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.106.0"
  exit 0
fi
echo "old codex should not run a judge" >&2
exit 1
OLD_CODEX
chmod +x "$old_bin/codex"

old_progress="$TMP/old-progress.json"
printf '{}\n' > "$old_progress"
set +e
PATH="$old_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$old_progress" \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/old.out" 2>"$TMP/old.err"
old_rc=$?
set -e

[ "$old_rc" -eq 70 ] || fail "old Codex CLI should exit 70 before judging, got $old_rc"
[ "$(jq 'length' "$old_progress")" = "0" ] || fail "old Codex CLI should not initialize article progress"
grep -q 'older than required' "$TMP/old.err" || fail "old Codex rejection did not explain version requirement"
pass "old Codex CLI is rejected before article progress is touched"

interrupted_progress="$TMP/interrupted-progress.json"
cat > "$interrupted_progress" <<'JSON'
{
  "gp-1-20260128-demo.mdx": {
    "article": "gp-1-20260128-demo.mdx",
    "topLevelAttempts": 5,
    "tribunalVersion": 8,
    "stages": {
      "factChecker": {
        "status": "in_progress",
        "score": null,
        "model": "codex-gpt-5.5-medium",
        "attempts": 1,
        "tribunalVersion": 8
      }
    }
  }
}
JSON

set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$interrupted_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/interrupted.out" 2>"$TMP/interrupted.err"
interrupted_rc=$?
set -e

[ "$interrupted_rc" -eq 70 ] || fail "interrupted in-progress retry should surface runner error, got $interrupted_rc"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status' "$interrupted_progress")" = "RUNNER_ERROR" ] || fail "interrupted retry should be RUNNER_ERROR"
[ "$(jq -r '."gp-1-20260128-demo.mdx".topLevelAttempts' "$interrupted_progress")" = "0" ] || fail "interrupted retry should reset non-terminal attempts"
if jq -e '."gp-1-20260128-demo.mdx".status == "EXHAUSTED"' "$interrupted_progress" >/dev/null; then
  fail "interrupted in-progress retry must not become EXHAUSTED"
fi
pass "interrupted in-progress runs do not consume attempts or exhaust articles"

# EXHAUSTED belongs to the article invocation that persisted it. A historical
# process-global flag let a different article steal the signal between the
# exhausted worker releasing the progress lock and checking the flag.
race_progress="$TMP/exhausted-race-progress.json"
race_waiting="$TMP/exhausted-race-waiting"
race_release="$TMP/exhausted-race-release"
race_bash_env="$TMP/exhausted-race-bash-env"
cat > "$race_progress" <<'JSON'
{
  "gp-1-20260128-demo.mdx": {
    "article": "gp-1-20260128-demo.mdx",
    "status": "FAILED",
    "topLevelAttempts": 5,
    "tribunalVersion": 999,
    "stages": {}
  },
  "gp-2-20260129-claude-code-vs-codex.mdx": {
    "article": "gp-2-20260129-claude-code-vs-codex.mdx",
    "status": "PENDING",
    "topLevelAttempts": 0,
    "tribunalVersion": 999,
    "stages": {}
  }
}
JSON
cat > "$race_bash_env" <<'BASH_ENV'
function [ {
  local pause_at_signal=0
  if builtin [ "${RACE_ROLE:-}" = "exhausted" ]; then
    if builtin [ "${1:-}" = "-f" ] && [[ "${2:-}" == *exhausted* ]]; then
      pause_at_signal=1
    fi
    if builtin [ "${1:-}" = "exhausted" ] &&
       builtin [ "${2:-}" = "=" ] &&
       builtin [ "${3:-}" = "exhausted" ]; then
      pause_at_signal=1
    fi
  fi
  if builtin [ "$pause_at_signal" -eq 1 ]; then
    : > "$RACE_WAITING"
    local waits=0
    while ! builtin [ -e "$RACE_RELEASE" ]; do
      sleep 0.01
      waits=$((waits + 1))
      if builtin [ "$waits" -ge 1000 ]; then
        echo "timed out waiting to release exhausted signal check" >&2
        return 1
      fi
    done
  fi
  builtin [ "$@"
}
BASH_ENV

set +e
PATH="$fake_bin:$PATH" \
BASH_ENV="$race_bash_env" \
RACE_ROLE=exhausted \
RACE_WAITING="$race_waiting" \
RACE_RELEASE="$race_release" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$race_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
timeout 15s bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/exhausted-race-x.out" 2>"$TMP/exhausted-race-x.err" &
race_x_pid=$!
set -e

race_ready=0
for ((race_waits = 0; race_waits < 500; race_waits++)); do
  if [ -e "$race_waiting" ]; then
    race_ready=1
    break
  fi
  if ! kill -0 "$race_x_pid" 2>/dev/null; then
    break
  fi
  sleep 0.01
done
if [ "$race_ready" -ne 1 ]; then
  kill "$race_x_pid" 2>/dev/null || true
  wait "$race_x_pid" 2>/dev/null || true
  sed -n '1,160p' "$TMP/exhausted-race-x.out" >&2 || true
  sed -n '1,160p' "$TMP/exhausted-race-x.err" >&2 || true
  fail "exhausted article did not reach the deterministic signal-check barrier"
fi

set +e
PATH="$fake_bin:$PATH" \
BASH_ENV="$race_bash_env" \
RACE_ROLE=peer \
RACE_WAITING="$race_waiting" \
RACE_RELEASE="$race_release" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$race_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
timeout 15s bash "$TRIBUNAL" --score-only --only-stage factChecker gp-2-20260129-claude-code-vs-codex.mdx \
  >"$TMP/exhausted-race-y.out" 2>"$TMP/exhausted-race-y.err"
race_y_rc=$?
: > "$race_release"
wait "$race_x_pid"
race_x_rc=$?
set -e

[ "$race_x_rc" -eq 2 ] ||
  fail "exhausted article must retain its own rc=2 signal, got rc=$race_x_rc"
[ "$race_y_rc" -eq 70 ] ||
  fail "peer runner crash must remain rc=70 instead of stealing EXHAUSTED, got rc=$race_y_rc"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status' "$race_progress")" = "EXHAUSTED" ] ||
  fail "exhausted article lost its terminal ledger status"
[ "$(jq -r '."gp-2-20260129-claude-code-vs-codex.mdx".status' "$race_progress")" = "RUNNER_ERROR" ] ||
  fail "peer article did not retain its independent runner-error status"
pass "concurrent articles cannot steal each other's EXHAUSTED signal"

# A judge PASS is not durable until its score reaches the target frontmatter.
# Bash disables errexit inside functions invoked from an `if`, so an early zh
# write failure used to be masked by a later successful/no-op EN write. The
# runner also wrote resumable stage PASS before attempting either artifact,
# causing the retry to skip the judge even after persistence failed.
persistence_bin="$TMP/persistence-bin"
persistence_progress="$TMP/persistence-progress.json"
persistence_ledger_progress="$TMP/persistence-ledger-progress.json"
persistence_lock_dir="$TMP/persistence-article-locks"
persistence_calls="$TMP/persistence-judge-calls"
persistence_partial_writes="$TMP/persistence-partial-writes"
persistence_zh="$ROOT_DIR/src/content/posts/gp-1-20260128-demo.mdx"
persistence_en="$ROOT_DIR/src/content/posts/en-gp-1-20260128-demo.mdx"
persistence_real_node="$(command -v node)"
persistence_real_jq="$(command -v jq)"
mkdir -p "$persistence_bin" "$persistence_lock_dir"
chmod 700 "$persistence_lock_dir"
printf '{}\n' > "$persistence_progress"
printf '{}\n' > "$persistence_ledger_progress"
: > "$persistence_calls"
: > "$persistence_partial_writes"

cat > "$persistence_bin/codex" <<'PERSISTENCE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  printf '%s\n' "$PERSISTENCE_FAILURE_MODE" >> "$PERSISTENCE_JUDGE_CALLS"
  prompt="${!#}"
  score_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
  [ -n "$score_path" ] || exit 2
  cat > "$score_path" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 8,
    "fidelity": 8,
    "consistency": 8,
    "sourceBoundary": 8,
    "commentarySeparation": 8
  },
  "score": 8,
  "verdict": "PASS"
}
JSON
  exit 0
fi
exit 1
PERSISTENCE_CODEX
chmod +x "$persistence_bin/codex"

cat > "$persistence_bin/node" <<'PERSISTENCE_NODE'
#!/usr/bin/env bash
if [ "${1:-}" = "$PERSISTENCE_FRONTMATTER_HELPER" ] && [ "${2:-}" = "write" ]; then
  case "$PERSISTENCE_FAILURE_MODE:${3:-}" in
    primary-fails:*/en-*) exit 0 ;;
    primary-fails:*) exit 9 ;;
    en-fails:*/en-*) exit 9 ;;
    en-fails:*)
      "$PERSISTENCE_REAL_NODE" "$@" || exit $?
      printf '\n<!-- persistence-test-partial-write -->\n' >> "${3:-}"
      printf 'zh-write\n' >> "$PERSISTENCE_PARTIAL_WRITES"
      exit 0
      ;;
    ledger-fails:*) exit 0 ;;
  esac
fi
exec "$PERSISTENCE_REAL_NODE" "$@"
PERSISTENCE_NODE
chmod +x "$persistence_bin/node"

cat > "$persistence_bin/jq" <<'PERSISTENCE_JQ'
#!/usr/bin/env bash
if [ "$PERSISTENCE_FAILURE_MODE" = "ledger-fails" ]; then
  args=("$@")
  for ((i = 0; i + 2 < ${#args[@]}; i++)); do
    if [ "${args[$i]}" = "--arg" ] &&
       [ "${args[$((i + 1))]}" = "status" ] &&
       [ "${args[$((i + 2))]}" = "pass" ]; then
      exit 9
    fi
  done
fi
exec "$PERSISTENCE_REAL_JQ" "$@"
PERSISTENCE_JQ
chmod +x "$persistence_bin/jq"

persistence_zh_before="$(sha256sum "$persistence_zh" | awk '{print $1}')"
persistence_en_before="$(sha256sum "$persistence_en" | awk '{print $1}')"

run_persistence_attempt() {
  local failure_mode="$1"
  local progress_file="$2"
  PATH="$persistence_bin:$PATH" \
  PERSISTENCE_FAILURE_MODE="$failure_mode" \
  PERSISTENCE_REAL_NODE="$persistence_real_node" \
  PERSISTENCE_REAL_JQ="$persistence_real_jq" \
  PERSISTENCE_FRONTMATTER_HELPER="$ROOT_DIR/scripts/frontmatter-scores.mjs" \
  PERSISTENCE_JUDGE_CALLS="$persistence_calls" \
  PROGRESS_FILE="$progress_file" \
  TRIBUNAL_ARTICLE_LOCK_DIR="$persistence_lock_dir" \
  TRIBUNAL_FORCE_PROVIDER=codex \
  TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
  bash "$TRIBUNAL" --only-stage factChecker --no-commit gp-1-20260128-demo.mdx
}

set +e
run_persistence_attempt primary-fails "$persistence_progress" \
  >"$TMP/persistence-first.out" 2>"$TMP/persistence-first.err"
persistence_first_rc=$?
run_persistence_attempt primary-fails "$persistence_progress" \
  >"$TMP/persistence-second.out" 2>"$TMP/persistence-second.err"
persistence_second_rc=$?
run_persistence_attempt ledger-fails "$persistence_ledger_progress" \
  >"$TMP/persistence-ledger.out" 2>"$TMP/persistence-ledger.err"
persistence_ledger_rc=$?
set -e

[ "$persistence_first_rc" -eq 70 ] ||
  fail "frontmatter persistence failure must classify the first stage run as rc=70"
[ "$persistence_second_rc" -eq 70 ] ||
  fail "frontmatter persistence failure must classify the retry as rc=70"
[ "$(grep -c '^primary-fails$' "$persistence_calls")" = "2" ] ||
  fail "frontmatter persistence retry must invoke the judge twice"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status // empty' "$persistence_progress")" = "RUNNER_ERROR" ] ||
  fail "frontmatter persistence failure must record RUNNER_ERROR"
[ "$(jq -r '."gp-1-20260128-demo.mdx".stages.factChecker.status // empty' "$persistence_progress")" = "runner_error" ] ||
  fail "frontmatter persistence failure must record retryable stage runner_error"
[ "$(jq -r '."gp-1-20260128-demo.mdx".topLevelAttempts // -1' "$persistence_progress")" = "0" ] ||
  fail "frontmatter persistence failure must not consume content attempts"
if grep -q "already PASS" "$TMP/persistence-second.out" "$TMP/persistence-second.err"; then
  fail "frontmatter persistence retry incorrectly skipped a stale PASS stage"
fi
[ "$(sha256sum "$persistence_zh" | awk '{print $1}')" = "$persistence_zh_before" ] ||
  fail "failed primary frontmatter persistence changed the zh-tw article"
[ "$(sha256sum "$persistence_en" | awk '{print $1}')" = "$persistence_en_before" ] ||
  fail "failed primary frontmatter persistence changed the English article"
pass "frontmatter persistence failures remain retryable and never publish stage PASS"

persistence_pair_dir="$TMP/persistence-pair"
persistence_pair_zh="$persistence_pair_dir/pair.mdx"
persistence_pair_en="$persistence_pair_dir/en-pair.mdx"
mkdir -p "$persistence_pair_dir"
cat > "$persistence_pair_zh" <<'MDX'
---
title: Persistence fixture
---
Fixture body.
MDX
cp "$persistence_pair_zh" "$persistence_pair_en"
persistence_pair_zh_before="$(sha256sum "$persistence_pair_zh" | awk '{print $1}')"
persistence_pair_en_before="$(sha256sum "$persistence_pair_en" | awk '{print $1}')"
persistence_pair_score='{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 8,
    "fidelity": 8,
    "consistency": 8,
    "sourceBoundary": 8,
    "commentarySeparation": 8
  },
  "score": 8,
  "verdict": "PASS",
  "model": "codex-test"
}'
# shellcheck source=scripts/score-helpers.sh
source "$ROOT_DIR/scripts/score-helpers.sh"
set +e
PATH="$persistence_bin:$PATH" \
PERSISTENCE_FAILURE_MODE=en-fails \
PERSISTENCE_REAL_NODE="$persistence_real_node" \
PERSISTENCE_FRONTMATTER_HELPER="$ROOT_DIR/scripts/frontmatter-scores.mjs" \
PERSISTENCE_PARTIAL_WRITES="$persistence_partial_writes" \
write_score_to_frontmatter "$persistence_pair_zh" factCheck "$persistence_pair_score" \
  >"$TMP/persistence-pair.out" 2>"$TMP/persistence-pair.err"
persistence_pair_rc=$?
set -e
[ "$persistence_pair_rc" -ne 0 ] ||
  fail "English frontmatter persistence failure must return nonzero"
if grep -q 'command not found' "$TMP/persistence-pair.out" "$TMP/persistence-pair.err"; then
  fail "bilingual persistence fixture did not invoke the score helper"
fi
[ "$(grep -c '^zh-write$' "$persistence_partial_writes")" = "1" ] ||
  fail "bilingual persistence fixture did not complete the primary write before English failure"
[ "$(sha256sum "$persistence_pair_zh" | awk '{print $1}')" = "$persistence_pair_zh_before" ] ||
  fail "English persistence failure did not roll back the successful zh-tw write"
[ "$(sha256sum "$persistence_pair_en" | awk '{print $1}')" = "$persistence_pair_en_before" ] ||
  fail "English persistence failure changed the English article"
pass "bilingual persistence rolls back both artifacts when the English write fails"

[ "$persistence_ledger_rc" -eq 70 ] ||
  fail "stage PASS ledger failure must classify as rc=70"
[ "$(grep -c '^ledger-fails$' "$persistence_calls")" = "1" ] ||
  fail "stage PASS ledger failure must invoke the judge once"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status // empty' "$persistence_ledger_progress")" = "RUNNER_ERROR" ] ||
  fail "stage PASS ledger failure must record RUNNER_ERROR"
[ "$(jq -r '."gp-1-20260128-demo.mdx".stages.factChecker.status // empty' "$persistence_ledger_progress")" = "runner_error" ] ||
  fail "stage PASS ledger failure must not leave resumable PASS"
[ "$(jq -r '."gp-1-20260128-demo.mdx".topLevelAttempts // -1' "$persistence_ledger_progress")" = "0" ] ||
  fail "stage PASS ledger failure must not consume content attempts"
pass "stage PASS ledger failures remain runner errors instead of false success"

# Writer rollback must restore the current validated state, not the Git HEAD
# baseline. Earlier judge scores may already have been persisted in this run.
rewrite_pair_dir="$TMP/rewrite-pair"
rewrite_pair_zh="$rewrite_pair_dir/pair.mdx"
rewrite_pair_en="$rewrite_pair_dir/en-pair.mdx"
rewrite_pair_zh_before="$rewrite_pair_dir/zh-before"
rewrite_pair_en_before="$rewrite_pair_dir/en-before"
mkdir -p "$rewrite_pair_dir"
printf '%s\n' \
  '---' \
  'title: Rewrite fixture' \
  'scores:' \
  '  factCheck:' \
  '    score: 8' \
  '---' \
  'Validated zh body.' > "$rewrite_pair_zh"
printf '%s\n' \
  '---' \
  'title: Rewrite fixture EN' \
  'scores:' \
  '  factCheck:' \
  '    score: 8' \
  '---' \
  'Validated en body.' > "$rewrite_pair_en"
cp "$rewrite_pair_zh" "$rewrite_pair_zh_before"
cp "$rewrite_pair_en" "$rewrite_pair_en_before"
chmod 640 "$rewrite_pair_zh"
chmod 604 "$rewrite_pair_en"
rewrite_pair_zh_mode_before="$(stat_mode "$rewrite_pair_zh")"
rewrite_pair_en_mode_before="$(stat_mode "$rewrite_pair_en")"

set +e
rewrite_snapshot="$(
  tribunal_post_pair_snapshot_create "$rewrite_pair_zh" 2>"$TMP/rewrite-snapshot.err"
)"
rewrite_snapshot_rc=$?
set -e
[ "$rewrite_snapshot_rc" -eq 0 ] ||
  fail "current-state rewrite snapshot creation must succeed, got rc=$rewrite_snapshot_rc"
[ -n "$rewrite_snapshot" ] ||
  fail "current-state rewrite snapshot creation did not return its integrity token"
rewrite_snapshot_path="$(snapshot_path_from_token "$rewrite_snapshot")"
[ "$(stat_mode "$rewrite_snapshot_path")" = "700" ] ||
  fail "current-state rewrite snapshot directory must have mode 700"

printf '%s\n' 'writer corrupted zh' > "$rewrite_pair_zh"
printf '%s\n' 'writer corrupted en' > "$rewrite_pair_en"
set +e
tribunal_post_pair_snapshot_restore "$rewrite_pair_zh" "$rewrite_snapshot" \
  >"$TMP/rewrite-restore.out" 2>"$TMP/rewrite-restore.err"
rewrite_restore_rc=$?
set -e
[ "$rewrite_restore_rc" -eq 0 ] ||
  fail "current-state bilingual rewrite restore must succeed, got rc=$rewrite_restore_rc"
cmp -s "$rewrite_pair_zh" "$rewrite_pair_zh_before" ||
  fail "rewrite restore did not preserve the validated zh bytes and prior score"
cmp -s "$rewrite_pair_en" "$rewrite_pair_en_before" ||
  fail "rewrite restore did not preserve the validated EN bytes and prior score"
[ "$(stat_mode "$rewrite_pair_zh")" = "$rewrite_pair_zh_mode_before" ] ||
  fail "rewrite restore did not preserve the validated zh-tw file mode"
[ "$(stat_mode "$rewrite_pair_en")" = "$rewrite_pair_en_mode_before" ] ||
  fail "rewrite restore did not preserve the validated English file mode"
tribunal_post_pair_snapshot_discard "$rewrite_snapshot" ||
  fail "successful rewrite snapshot cleanup failed"
[ ! -e "$rewrite_snapshot_path" ] ||
  fail "successful rewrite snapshot cleanup left the private directory behind"
pass "writer rollback restores the current bilingual bytes, scores, and modes"

# Writer output is staged in a private candidate directory. The parent applies
# only stable candidate bytes after confirming the canonical pair still exactly
# matches the captured baseline.
candidate_pair_dir="$TMP/candidate-pair"
candidate_work_dir="$TMP/candidate-work"
candidate_zh="$candidate_pair_dir/pair.mdx"
candidate_en="$candidate_pair_dir/en-pair.mdx"
mkdir -p "$candidate_pair_dir" "$candidate_work_dir"
chmod 700 "$candidate_work_dir"
printf '%s\n' '---' 'title: Candidate zh' '---' 'candidate baseline zh' > "$candidate_zh"
printf '%s\n' '---' 'title: Candidate en' '---' 'candidate baseline en' > "$candidate_en"
chmod 640 "$candidate_zh"
chmod 604 "$candidate_en"
candidate_snapshot="$(tribunal_post_pair_snapshot_create "$candidate_zh")"
tribunal_post_pair_candidate_materialize "$candidate_work_dir" "$candidate_snapshot" ||
  fail "candidate materialization failed"
grep -Fq 'candidate baseline zh' "$candidate_work_dir/pair.mdx" ||
  fail "candidate materialization lost zh-tw bytes"
grep -Fq 'candidate baseline en' "$candidate_work_dir/en-pair.mdx" ||
  fail "candidate materialization lost English bytes"
printf '%s\n' '---' 'title: Candidate zh' '---' 'writer candidate zh' \
  > "$candidate_work_dir/pair.mdx"
printf '%s\n' '---' 'title: Candidate en' '---' 'writer candidate en' \
  > "$candidate_work_dir/en-pair.mdx"
candidate_output_token="$(
  tribunal_post_pair_candidate_capture \
    "$candidate_work_dir" "$candidate_snapshot"
)"
candidate_captured_dir="$TMP/candidate-captured"
mkdir -p "$candidate_captured_dir"
chmod 700 "$candidate_captured_dir"
tribunal_post_pair_candidate_materialize \
  "$candidate_captured_dir" "$candidate_output_token" ||
  fail "captured candidate materialization failed"
tribunal_post_pair_candidate_apply \
  "$candidate_zh" "$candidate_captured_dir" "$candidate_snapshot" ||
  fail "candidate application failed"
grep -Fq 'writer candidate zh' "$candidate_zh" ||
  fail "candidate application did not update zh-tw canonical bytes"
grep -Fq 'writer candidate en' "$candidate_en" ||
  fail "candidate application did not update English canonical bytes"
[ "$(stat_mode "$candidate_zh")" = "640" ] ||
  fail "candidate application changed the canonical zh-tw mode"
[ "$(stat_mode "$candidate_en")" = "604" ] ||
  fail "candidate application changed the canonical English mode"
pass "parent applies isolated bilingual candidate bytes with canonical modes"

tribunal_post_pair_candidate_rollback \
  "$candidate_zh" "$candidate_snapshot" "$candidate_output_token" ||
  fail "automatic candidate rollback failed"
grep -Fq 'candidate baseline zh' "$candidate_zh" ||
  fail "automatic candidate rollback did not restore zh-tw baseline bytes"
grep -Fq 'candidate baseline en' "$candidate_en" ||
  fail "automatic candidate rollback did not restore English baseline bytes"
[ "$(stat_mode "$candidate_zh")" = "640" ] ||
  fail "automatic candidate rollback changed the canonical zh-tw mode"
[ "$(stat_mode "$candidate_en")" = "604" ] ||
  fail "automatic candidate rollback changed the canonical English mode"
tribunal_post_pair_snapshot_discard "$candidate_snapshot" ||
  fail "candidate snapshot cleanup failed"
pass "automatic rollback CAS-restores the captured bilingual baseline"

candidate_guard_dir="$TMP/candidate-guards"
candidate_guard_work="$TMP/candidate-guards-work"
candidate_guard_zh="$candidate_guard_dir/pair.mdx"
mkdir -p "$candidate_guard_dir" "$candidate_guard_work"
chmod 700 "$candidate_guard_work"
printf '%s\n' '---' 'title: Candidate guard' '---' 'guard baseline' \
  > "$candidate_guard_zh"
candidate_guard_snapshot="$(
  tribunal_post_pair_snapshot_create "$candidate_guard_zh"
)"
tribunal_post_pair_candidate_materialize \
  "$candidate_guard_work" "$candidate_guard_snapshot" ||
  fail "candidate guard materialization failed"
printf '%s\n' 'unexpected' > "$candidate_guard_work/unexpected.txt"
set +e
tribunal_post_pair_candidate_capture \
  "$candidate_guard_work" "$candidate_guard_snapshot" \
  >"$TMP/candidate-unexpected.out" 2>"$TMP/candidate-unexpected.err"
candidate_unexpected_rc=$?
set -e
[ "$candidate_unexpected_rc" -ne 0 ] ||
  fail "candidate capture accepted an unexpected workspace entry"
rm -f "$candidate_guard_work/unexpected.txt"
for entry_id in $(seq 1 256); do
  : > "$candidate_guard_work/unexpected-$entry_id"
done
set +e
printf '%s' "$candidate_guard_snapshot" |
  timeout 5s python3 "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" \
    capture-candidate "$candidate_guard_work" - \
    >"$TMP/candidate-entry-bomb.out" 2>"$TMP/candidate-entry-bomb.err"
candidate_entry_bomb_rc=$?
set -e
[ "$candidate_entry_bomb_rc" -ne 0 ] ||
  fail "candidate capture accepted an unexpected entry set"
[ "$candidate_entry_bomb_rc" -ne 124 ] ||
  fail "candidate capture enumerated an unexpected entry set without a bound"
find "$candidate_guard_work" -maxdepth 1 -type f -name 'unexpected-*' -delete
rm -f "$candidate_guard_work/pair.mdx"
ln "$candidate_guard_zh" "$candidate_guard_work/pair.mdx"
set +e
tribunal_post_pair_candidate_capture \
  "$candidate_guard_work" "$candidate_guard_snapshot" \
  >"$TMP/candidate-hardlink.out" 2>"$TMP/candidate-hardlink.err"
candidate_hardlink_rc=$?
set -e
[ "$candidate_hardlink_rc" -ne 0 ] ||
  fail "candidate capture accepted a hardlinked canonical file"
rm -f "$candidate_guard_work/pair.mdx"
tribunal_post_pair_candidate_materialize \
  "$candidate_guard_work" "$candidate_guard_snapshot" ||
  fail "candidate guard rematerialization failed"
printf '%s\n' '---' 'title: Mutated guard' '---' 'guard baseline' \
  > "$candidate_guard_work/pair.mdx"
set +e
tribunal_post_pair_candidate_capture \
  "$candidate_guard_work" "$candidate_guard_snapshot" \
  >"$TMP/candidate-frontmatter.out" 2>"$TMP/candidate-frontmatter.err"
candidate_frontmatter_rc=$?
set -e
[ "$candidate_frontmatter_rc" -ne 0 ] ||
  fail "candidate capture accepted protected frontmatter drift"
rm -f "$candidate_guard_work/pair.mdx"
mkfifo "$candidate_guard_work/pair.mdx"
set +e
printf '%s' "$candidate_guard_snapshot" |
  timeout 5s python3 "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" \
    capture-candidate "$candidate_guard_work" - \
    >"$TMP/candidate-fifo.out" 2>"$TMP/candidate-fifo.err"
candidate_fifo_rc=$?
set -e
[ "$candidate_fifo_rc" -ne 0 ] ||
  fail "candidate capture accepted a FIFO"
[ "$candidate_fifo_rc" -ne 124 ] ||
  fail "candidate FIFO blocked before the type guard"
grep -Fq 'not a regular file' "$TMP/candidate-fifo.err" ||
  fail "candidate FIFO did not fail at the regular-file guard"
rm -f "$candidate_guard_work/pair.mdx"
tribunal_post_pair_candidate_materialize \
  "$candidate_guard_work" "$candidate_guard_snapshot" ||
  fail "candidate size-guard rematerialization failed"
truncate -s 3M "$candidate_guard_work/pair.mdx"
set +e
tribunal_post_pair_candidate_capture \
  "$candidate_guard_work" "$candidate_guard_snapshot" \
  >"$TMP/candidate-size.out" 2>"$TMP/candidate-size.err"
candidate_size_rc=$?
set -e
[ "$candidate_size_rc" -ne 0 ] ||
  fail "candidate capture accepted an oversized sparse file"
grep -Fq 'candidate file exceeds byte limit' "$TMP/candidate-size.err" ||
  fail "oversized candidate did not fail at the byte-limit guard"
tribunal_post_pair_snapshot_discard "$candidate_guard_snapshot" ||
  fail "candidate guard snapshot cleanup failed"
pass "candidate capture rejects bounded unexpected entries, hardlinks, FIFOs, frontmatter drift, and oversized files"

candidate_race_dir="$TMP/candidate-race"
candidate_race_work="$TMP/candidate-race-work"
candidate_race_zh="$candidate_race_dir/pair.mdx"
mkdir -p "$candidate_race_dir" "$candidate_race_work"
chmod 700 "$candidate_race_work"
printf '%s\n' '---' 'title: Candidate race' '---' 'captured baseline' \
  > "$candidate_race_zh"
candidate_race_snapshot="$(tribunal_post_pair_snapshot_create "$candidate_race_zh")"
tribunal_post_pair_candidate_materialize \
  "$candidate_race_work" "$candidate_race_snapshot" ||
  fail "candidate race materialization failed"
printf '%s\n' '---' 'title: Candidate race' '---' 'writer candidate' \
  > "$candidate_race_work/pair.mdx"
printf '%s\n' '---' 'title: Candidate race' '---' 'parallel human edit' \
  > "$candidate_race_zh"
set +e
tribunal_post_pair_candidate_apply \
  "$candidate_race_zh" "$candidate_race_work" "$candidate_race_snapshot" \
  >"$TMP/candidate-race.out" 2>"$TMP/candidate-race.err"
candidate_race_rc=$?
set -e
[ "$candidate_race_rc" -eq 70 ] ||
  fail "candidate apply over a changed baseline must fail closed with rc=70"
grep -Fq 'parallel human edit' "$candidate_race_zh" ||
  fail "candidate apply overwrote a parallel canonical edit"
tribunal_post_pair_snapshot_discard "$candidate_race_snapshot" ||
  fail "candidate race snapshot cleanup failed"
pass "candidate apply refuses to overwrite a changed canonical baseline"

# Atomic exchange is the compare-and-swap boundary, not the preceding read.
# Inject one edit immediately before exchange and another immediately after it;
# both must survive, including when English was already exchanged and needs a
# conditional rollback.
if ! python3 - "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" <<'PY'
import importlib.util
import os
import pathlib
import secrets
import sys
import tempfile

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("tribunal_snapshot", module_path)
if spec is None or spec.loader is None:
    raise SystemExit("could not load snapshot helper")
snapshot = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = snapshot
spec.loader.exec_module(snapshot)

frontmatter = b"---\ntitle: Atomic CAS fixture\n---\n"
baseline_zh = frontmatter + b"baseline zh\n"
baseline_en = frontmatter + b"baseline en\n"
candidate_zh = frontmatter + b"candidate zh\n"
candidate_en = frontmatter + b"candidate en\n"
human_zh = frontmatter + b"parallel human zh\n"


def replace_path(
    directory_fd: int, name: str, payload: bytes, mode: int
) -> tuple[int, int]:
    temporary = f".parallel-edit-{secrets.token_hex(8)}"
    snapshot._write_new_file(directory_fd, temporary, payload, mode)
    os.replace(
        temporary,
        name,
        src_dir_fd=directory_fd,
        dst_dir_fd=directory_fd,
    )
    info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    return (info.st_dev, info.st_ino)


def run_scenario(inject_after_exchange: bool, parallel_payload: bytes) -> None:
    with tempfile.TemporaryDirectory(
        prefix="tribunal-cas-", dir=os.environ.get("TMPDIR") or "/tmp"
    ) as root_text:
        root = pathlib.Path(root_text)
        post_dir = root / "posts"
        candidate_dir = root / "candidate"
        post_dir.mkdir()
        candidate_dir.mkdir()
        candidate_dir.chmod(0o700)
        zh_path = post_dir / "pair.mdx"
        en_path = post_dir / "en-pair.mdx"
        zh_path.write_bytes(baseline_zh)
        en_path.write_bytes(baseline_en)
        zh_path.chmod(0o640)
        en_path.chmod(0o604)

        token = snapshot.create_snapshot(str(zh_path))
        try:
            snapshot.materialize_candidate(str(candidate_dir), token)
            (candidate_dir / "pair.mdx").write_bytes(candidate_zh)
            (candidate_dir / "en-pair.mdx").write_bytes(candidate_en)

            original_exchange = snapshot._rename_exchange
            injected = False
            injected_identity = None

            def exchange_with_parallel_edit(
                directory_fd: int, first_name: str, second_name: str
            ) -> None:
                nonlocal injected, injected_identity
                should_inject = not injected and second_name == "pair.mdx"
                if should_inject and not inject_after_exchange:
                    injected_identity = replace_path(
                        directory_fd, second_name, parallel_payload, 0o640
                    )
                    injected = True
                original_exchange(directory_fd, first_name, second_name)
                if should_inject and inject_after_exchange:
                    injected_identity = replace_path(
                        directory_fd, second_name, parallel_payload, 0o640
                    )
                    injected = True

            snapshot._rename_exchange = exchange_with_parallel_edit
            try:
                snapshot.apply_candidate(str(zh_path), str(candidate_dir), token)
            except snapshot.SnapshotError:
                pass
            else:
                raise AssertionError("parallel edit unexpectedly committed as success")
            finally:
                snapshot._rename_exchange = original_exchange

            if zh_path.read_bytes() != parallel_payload:
                raise AssertionError("parallel zh-tw edit was overwritten")
            final_info = zh_path.stat()
            if injected_identity != (final_info.st_dev, final_info.st_ino):
                raise AssertionError("byte-identical parallel inode was overwritten")
            if en_path.read_bytes() != baseline_en:
                raise AssertionError("partially exchanged English post was not rolled back")
        finally:
            snapshot.discard_snapshot(token)


def run_failed_second_rollback_exchange() -> None:
    with tempfile.TemporaryDirectory(
        prefix="tribunal-cas-recovery-",
        dir=os.environ.get("TMPDIR") or "/tmp",
    ) as root_text:
        root = pathlib.Path(root_text)
        post_dir = root / "posts"
        candidate_dir = root / "candidate"
        post_dir.mkdir()
        candidate_dir.mkdir()
        candidate_dir.chmod(0o700)
        zh_path = post_dir / "pair.mdx"
        zh_path.write_bytes(baseline_zh)
        zh_path.chmod(0o640)

        token = snapshot.create_snapshot(str(zh_path))
        try:
            snapshot.materialize_candidate(str(candidate_dir), token)
            (candidate_dir / "pair.mdx").write_bytes(candidate_zh)

            original_exchange = snapshot._rename_exchange
            exchange_count = 0

            def exchange_with_failed_human_restore(
                directory_fd: int, first_name: str, second_name: str
            ) -> None:
                nonlocal exchange_count
                exchange_count += 1
                if exchange_count == 3:
                    raise snapshot.SnapshotError(
                        "injected second rollback exchange failure"
                    )
                original_exchange(directory_fd, first_name, second_name)
                if exchange_count == 1:
                    replace_path(directory_fd, second_name, human_zh, 0o640)

            snapshot._rename_exchange = exchange_with_failed_human_restore
            try:
                snapshot.apply_candidate(str(zh_path), str(candidate_dir), token)
            except snapshot.SnapshotError:
                pass
            else:
                raise AssertionError("failed rollback exchange unexpectedly succeeded")
            finally:
                snapshot._rename_exchange = original_exchange

            retained_payloads = []
            for path in post_dir.iterdir():
                if path.name.startswith(".tribunal-restore-"):
                    retained_payloads.append(path.read_bytes())
            if human_zh not in retained_payloads:
                raise AssertionError(
                    "failed second rollback exchange deleted the displaced human edit"
                )
        finally:
            snapshot.discard_snapshot(token)


run_scenario(inject_after_exchange=False, parallel_payload=human_zh)
run_scenario(inject_after_exchange=False, parallel_payload=baseline_zh)
run_scenario(inject_after_exchange=True, parallel_payload=human_zh)
run_failed_second_rollback_exchange()
PY
then
  fail "atomic candidate exchange overwrote an injected parallel edit"
fi
pass "atomic candidate CAS and rollback preserve pre/post-exchange parallel edits"

# A real SIGKILL after the first bilingual exchange must leave enough fsynced
# evidence to repair the mixed pair. Recovery itself is restartable: kill it
# after its first reverse exchange, then run the public CLI again.
if ! python3 - "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" <<'PY'
import importlib.util
import os
import pathlib
import signal
import stat
import subprocess
import sys
import tempfile

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location(
    "tribunal_snapshot_crash_recovery", module_path
)
if spec is None or spec.loader is None:
    raise SystemExit("could not load snapshot helper")
snapshot = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = snapshot
spec.loader.exec_module(snapshot)

frontmatter = b"---\ntitle: Crash journal fixture\n---\n"
baseline_zh = frontmatter + b"baseline zh\n"
baseline_en = frontmatter + b"baseline en\n"
candidate_zh = frontmatter + b"candidate zh\n"
candidate_en = frontmatter + b"candidate en\n"
human_zh = frontmatter + b"parallel human zh\n"

apply_child = r"""
import importlib.util
import os
import pathlib
import signal
import sys

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("tribunal_snapshot_killed_apply", module_path)
snapshot = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = snapshot
spec.loader.exec_module(snapshot)
original_exchange = snapshot._rename_exchange

def kill_after_first_exchange(directory_fd, first_name, second_name):
    original_exchange(directory_fd, first_name, second_name)
    os.kill(os.getpid(), signal.SIGKILL)

snapshot._rename_exchange = kill_after_first_exchange
snapshot.apply_candidate(sys.argv[2], sys.argv[3], pathlib.Path(sys.argv[4]).read_text())
"""

recover_child = r"""
import importlib.util
import os
import pathlib
import signal
import sys

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("tribunal_snapshot_killed_recovery", module_path)
snapshot = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = snapshot
spec.loader.exec_module(snapshot)
original_exchange = snapshot._rename_exchange

def kill_after_first_exchange(directory_fd, first_name, second_name):
    original_exchange(directory_fd, first_name, second_name)
    os.kill(os.getpid(), signal.SIGKILL)

snapshot._rename_exchange = kill_after_first_exchange
snapshot.recover_pending(sys.argv[2])
"""


def prepare_killed_apply(root: pathlib.Path):
    post_dir = root / "posts"
    candidate_dir = root / "candidate"
    post_dir.mkdir()
    candidate_dir.mkdir()
    candidate_dir.chmod(0o700)
    zh_path = post_dir / "pair.mdx"
    en_path = post_dir / "en-pair.mdx"
    zh_path.write_bytes(baseline_zh)
    en_path.write_bytes(baseline_en)
    zh_path.chmod(0o640)
    en_path.chmod(0o604)
    token = snapshot.create_snapshot(str(zh_path))
    snapshot.materialize_candidate(str(candidate_dir), token)
    (candidate_dir / "pair.mdx").write_bytes(candidate_zh)
    (candidate_dir / "en-pair.mdx").write_bytes(candidate_en)
    token_path = root / "token.json"
    token_path.write_text(token)
    killed = subprocess.run(
        [
            sys.executable,
            "-c",
            apply_child,
            str(module_path),
            str(zh_path),
            str(candidate_dir),
            str(token_path),
        ],
        check=False,
    )
    if killed.returncode != -signal.SIGKILL:
        raise AssertionError(
            f"apply child was not killed after its first exchange: {killed.returncode}"
        )
    journal_name = snapshot._journal_name_for_target(zh_path.name)
    journal_path = post_dir / journal_name
    if not journal_path.is_file():
        raise AssertionError("SIGKILL lost the durable apply journal")
    if stat.S_IMODE(journal_path.stat().st_mode) != 0o600:
        raise AssertionError("durable apply journal mode is not 600")
    post_fd = os.open(post_dir, os.O_RDONLY | os.O_DIRECTORY)
    try:
        parsed, _, _ = snapshot._read_apply_journal(post_fd, journal_name)
    finally:
        os.close(post_fd)
    recorded_payloads = {
        state.payload
        for member in parsed.members
        for state in (member.baseline, member.candidate)
    }
    if not {baseline_zh, baseline_en, candidate_zh, candidate_en}.issubset(
        recorded_payloads
    ):
        raise AssertionError("apply journal omitted baseline/candidate evidence")
    if zh_path.read_bytes() != baseline_zh or en_path.read_bytes() != candidate_en:
        raise AssertionError("first exchange did not leave the expected mixed pair")
    return post_dir, zh_path, en_path, token, journal_path


with tempfile.TemporaryDirectory(
    prefix="tribunal-crash-journal-",
    dir=os.environ.get("TMPDIR") or "/tmp",
) as root_text:
    root = pathlib.Path(root_text)
    post_dir, zh_path, en_path, token, journal_path = prepare_killed_apply(root)
    try:
        killed_recovery = subprocess.run(
            [
                sys.executable,
                "-c",
                recover_child,
                str(module_path),
                str(post_dir),
            ],
            check=False,
        )
        if killed_recovery.returncode != -signal.SIGKILL:
            raise AssertionError(
                "recovery child was not killed after its first reverse exchange"
            )
        if not journal_path.is_file():
            raise AssertionError("interrupted recovery discarded its journal")
        if zh_path.read_bytes() != baseline_zh or en_path.read_bytes() != baseline_en:
            raise AssertionError("interrupted recovery did not restore pair baseline")

        recovered = subprocess.run(
            [
                sys.executable,
                str(module_path),
                "recover-pending",
                str(post_dir),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if recovered.returncode != 0 or recovered.stdout.strip() != "1":
            raise AssertionError(
                f"restartable recovery failed: {recovered.returncode} "
                f"{recovered.stderr.strip()}"
            )
        if journal_path.exists():
            raise AssertionError("successful recovery retained its journal")
        if any(
            path.name.startswith(".tribunal-restore-")
            for path in post_dir.iterdir()
        ):
            raise AssertionError("successful recovery retained known candidate temps")
        if zh_path.read_bytes() != baseline_zh or en_path.read_bytes() != baseline_en:
            raise AssertionError("restartable recovery did not preserve baseline pair")
        if (
            stat.S_IMODE(zh_path.stat().st_mode) != 0o640
            or stat.S_IMODE(en_path.stat().st_mode) != 0o604
        ):
            raise AssertionError("restartable recovery changed canonical modes")
    finally:
        snapshot.discard_snapshot(token)

with tempfile.TemporaryDirectory(
    prefix="tribunal-crash-journal-human-",
    dir=os.environ.get("TMPDIR") or "/tmp",
) as root_text:
    root = pathlib.Path(root_text)
    post_dir, zh_path, _, token, journal_path = prepare_killed_apply(root)
    try:
        zh_path.write_bytes(human_zh)
        failed = subprocess.run(
            [
                sys.executable,
                str(module_path),
                "recover-pending",
                str(post_dir),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if failed.returncode != 70:
            raise AssertionError("unknown human inode did not fail closed")
        if zh_path.read_bytes() != human_zh:
            raise AssertionError("recovery overwrote the unknown human edit")
        if not journal_path.is_file():
            raise AssertionError("unknown-state recovery discarded its evidence")
    finally:
        snapshot.discard_snapshot(token)

with tempfile.TemporaryDirectory(
    prefix="tribunal-crash-journal-guards-",
    dir=os.environ.get("TMPDIR") or "/tmp",
) as root_text:
    post_dir = pathlib.Path(root_text) / "posts"
    post_dir.mkdir()
    journal_name = snapshot._journal_name_for_target("pair.mdx")
    journal_path = post_dir / journal_name
    outside = pathlib.Path(root_text) / "outside"
    outside.write_text("must survive")
    journal_path.symlink_to(outside)
    symlinked = subprocess.run(
        [
            sys.executable,
            str(module_path),
            "recover-pending",
            str(post_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if symlinked.returncode != 70 or outside.read_text() != "must survive":
        raise AssertionError("symlinked apply journal did not fail closed")
    journal_path.unlink()
    os.mkfifo(journal_path)
    fifo = subprocess.run(
        [
            sys.executable,
            str(module_path),
            "recover-pending",
            str(post_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if fifo.returncode != 70:
        raise AssertionError("special-file apply journal did not fail closed")
    journal_path.unlink()
    for index in range(3):
        (post_dir / f"ordinary-{index}").touch()
    original_scan_bound = snapshot.MAX_RECOVERY_SCAN_ENTRIES
    snapshot.MAX_RECOVERY_SCAN_ENTRIES = 2
    try:
        try:
            snapshot.recover_pending(str(post_dir))
        except snapshot.SnapshotError:
            pass
        else:
            raise AssertionError("pending recovery scan exceeded its bound")
    finally:
        snapshot.MAX_RECOVERY_SCAN_ENTRIES = original_scan_bound
PY
then
  fail "durable candidate journal did not recover a SIGKILL-interrupted pair"
fi
pass "durable candidate journal recovers SIGKILL and preserves unknown evidence"

# Automatic rollback must use the same exchange CAS in reverse. Inject a
# canonical edit immediately before or after the zh-tw rollback exchange, after
# English has already exchanged. The edit must survive, including a
# byte-identical replacement inode, and the partial English rollback must be
# undone back to the applied writer candidate.
if ! python3 - "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" <<'PY'
import importlib.util
import os
import pathlib
import secrets
import sys
import tempfile

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location(
    "tribunal_snapshot_automatic_rollback", module_path
)
if spec is None or spec.loader is None:
    raise SystemExit("could not load snapshot helper")
snapshot = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = snapshot
spec.loader.exec_module(snapshot)

frontmatter = b"---\ntitle: Automatic rollback CAS fixture\n---\n"
baseline_zh = frontmatter + b"baseline zh\n"
baseline_en = frontmatter + b"baseline en\n"
candidate_zh = frontmatter + b"candidate zh\n"
candidate_en = frontmatter + b"candidate en\n"
human_zh = frontmatter + b"parallel human zh\n"


def replace_path(
    directory_fd: int, name: str, payload: bytes, mode: int
) -> tuple[int, int]:
    temporary = f".rollback-parallel-edit-{secrets.token_hex(8)}"
    snapshot._write_new_file(directory_fd, temporary, payload, mode)
    os.replace(
        temporary,
        name,
        src_dir_fd=directory_fd,
        dst_dir_fd=directory_fd,
    )
    info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    return (info.st_dev, info.st_ino)


def run_scenario(inject_after_exchange: bool, parallel_payload: bytes) -> None:
    with tempfile.TemporaryDirectory(
        prefix="tribunal-rollback-cas-",
        dir=os.environ.get("TMPDIR") or "/tmp",
    ) as root_text:
        root = pathlib.Path(root_text)
        post_dir = root / "posts"
        writer_dir = root / "writer"
        applied_dir = root / "applied"
        baseline_dir = root / "baseline"
        post_dir.mkdir()
        for directory in (writer_dir, applied_dir, baseline_dir):
            directory.mkdir()
            directory.chmod(0o700)
        zh_path = post_dir / "pair.mdx"
        en_path = post_dir / "en-pair.mdx"
        zh_path.write_bytes(baseline_zh)
        en_path.write_bytes(baseline_en)
        zh_path.chmod(0o640)
        en_path.chmod(0o604)

        baseline_token = snapshot.create_snapshot(str(zh_path))
        try:
            snapshot.materialize_candidate(str(writer_dir), baseline_token)
            (writer_dir / "pair.mdx").write_bytes(candidate_zh)
            (writer_dir / "en-pair.mdx").write_bytes(candidate_en)
            candidate_token = snapshot.capture_candidate(
                str(writer_dir), baseline_token
            )
            snapshot.materialize_candidate(str(applied_dir), candidate_token)
            snapshot.apply_candidate(
                str(zh_path), str(applied_dir), baseline_token
            )

            # Reverse apply: baseline bytes are the desired candidate, while
            # candidate_token is the exact current-state expectation.
            snapshot.materialize_candidate(str(baseline_dir), baseline_token)
            original_exchange = snapshot._rename_exchange
            injected = False
            injected_identity = None

            def exchange_with_parallel_edit(
                directory_fd: int, first_name: str, second_name: str
            ) -> None:
                nonlocal injected, injected_identity
                should_inject = not injected and second_name == "pair.mdx"
                if should_inject and not inject_after_exchange:
                    injected_identity = replace_path(
                        directory_fd, second_name, parallel_payload, 0o640
                    )
                    injected = True
                original_exchange(directory_fd, first_name, second_name)
                if should_inject and inject_after_exchange:
                    injected_identity = replace_path(
                        directory_fd, second_name, parallel_payload, 0o640
                    )
                    injected = True

            snapshot._rename_exchange = exchange_with_parallel_edit
            try:
                snapshot.apply_candidate(
                    str(zh_path), str(baseline_dir), candidate_token
                )
            except snapshot.SnapshotError:
                pass
            else:
                raise AssertionError(
                    "parallel edit unexpectedly committed as rollback success"
                )
            finally:
                snapshot._rename_exchange = original_exchange

            if zh_path.read_bytes() != parallel_payload:
                raise AssertionError(
                    "automatic rollback overwrote the parallel zh-tw edit"
                )
            final_info = zh_path.stat()
            if injected_identity != (final_info.st_dev, final_info.st_ino):
                raise AssertionError(
                    "automatic rollback overwrote byte-identical replacement inode"
                )
            if en_path.read_bytes() != candidate_en:
                raise AssertionError(
                    "automatic rollback retained a partial English baseline"
                )
        finally:
            snapshot.discard_snapshot(baseline_token)


run_scenario(inject_after_exchange=False, parallel_payload=human_zh)
run_scenario(inject_after_exchange=False, parallel_payload=candidate_zh)
run_scenario(inject_after_exchange=True, parallel_payload=human_zh)
PY
then
  fail "automatic rollback exchange overwrote an injected parallel edit"
fi
pass "automatic rollback CAS preserves pre/post-exchange and byte-identical parallel edits"

# If no EN sidecar existed at snapshot time, a writer-created EN file belongs
# to that rewrite and must disappear during rollback.
rewrite_absent_dir="$TMP/rewrite-absent-en"
rewrite_absent_zh="$rewrite_absent_dir/pair.mdx"
rewrite_absent_en="$rewrite_absent_dir/en-pair.mdx"
rewrite_absent_before="$rewrite_absent_dir/zh-before"
mkdir -p "$rewrite_absent_dir"
printf '%s\n' 'validated zh without EN' > "$rewrite_absent_zh"
cp "$rewrite_absent_zh" "$rewrite_absent_before"
rewrite_absent_snapshot="$(tribunal_post_pair_snapshot_create "$rewrite_absent_zh")"
printf '%s\n' 'writer changed zh' > "$rewrite_absent_zh"
printf '%s\n' 'writer created EN' > "$rewrite_absent_en"
tribunal_post_pair_snapshot_restore "$rewrite_absent_zh" "$rewrite_absent_snapshot" ||
  fail "rewrite restore with originally absent EN must succeed"
cmp -s "$rewrite_absent_zh" "$rewrite_absent_before" ||
  fail "rewrite restore with absent EN did not preserve zh bytes"
if [ -e "$rewrite_absent_en" ] || [ -L "$rewrite_absent_en" ]; then
  fail "rewrite restore did not remove the writer-created EN sidecar"
fi
tribunal_post_pair_snapshot_discard "$rewrite_absent_snapshot" ||
  fail "absent-EN rewrite snapshot cleanup failed"
pass "writer rollback removes an EN sidecar that did not exist at snapshot time"

# Restore failures are infrastructure failures. Preflight a hostile directory
# target so the assertion remains reliable even when this suite runs as root.
rewrite_failure_dir="$TMP/rewrite-restore-failure"
rewrite_failure_zh="$rewrite_failure_dir/pair.mdx"
rewrite_failure_en="$rewrite_failure_dir/en-pair.mdx"
mkdir -p "$rewrite_failure_dir"
printf '%s\n' 'validated zh' > "$rewrite_failure_zh"
printf '%s\n' 'validated en' > "$rewrite_failure_en"
rewrite_failure_snapshot="$(tribunal_post_pair_snapshot_create "$rewrite_failure_zh")"
rewrite_failure_snapshot_path="$(snapshot_path_from_token "$rewrite_failure_snapshot")"
rm -f "$rewrite_failure_en"
mkdir "$rewrite_failure_en"
set +e
tribunal_post_pair_snapshot_restore "$rewrite_failure_zh" "$rewrite_failure_snapshot" \
  >"$TMP/rewrite-restore-failure.out" 2>"$TMP/rewrite-restore-failure.err"
rewrite_failure_rc=$?
set -e
[ "$rewrite_failure_rc" -eq 70 ] ||
  fail "unsafe rewrite restore target must fail closed with rc=70, got $rewrite_failure_rc"
grep -Fq "$rewrite_failure_snapshot_path" "$TMP/rewrite-restore-failure.err" ||
  fail "rewrite restore failure did not report the preserved recovery path"
[ -d "$rewrite_failure_snapshot_path" ] ||
  fail "rewrite restore failure removed its recovery snapshot"
[ "$(stat_mode "$rewrite_failure_snapshot_path")" = "700" ] ||
  fail "preserved rewrite recovery snapshot must remain private"
rewrite_durable_token="$(
  TRIBUNAL_MAIN_REPO="$rewrite_failure_dir/coordinator" \
    tribunal_post_pair_snapshot_persist_recovery "$rewrite_failure_snapshot"
)"
[ -f "$rewrite_durable_token" ] ||
  fail "restore failure did not persist a durable self-contained token"
case "$rewrite_durable_token" in
  "$rewrite_failure_dir/coordinator/.score-loop/recovery/"*) ;;
  *) fail "durable recovery token did not use the supervisor runtime root" ;;
esac
[ "$(stat_mode "$rewrite_durable_token")" = "600" ] ||
  fail "durable recovery token must have mode 600"
if ! python3 - "$rewrite_durable_token" "$rewrite_failure_snapshot" <<'PY'
import pathlib
import sys

if pathlib.Path(sys.argv[1]).read_text(encoding="utf-8") != sys.argv[2]:
    raise SystemExit(1)
PY
then
  fail "durable recovery token did not preserve the parent-held payload"
fi
rm -f "$rewrite_durable_token"
pass "writer rollback failures preserve private recovery evidence and return rc=70"

# The writer runs under the same uid and can enumerate /tmp. Its edits must not
# be trusted as recovery input: the parent-held digest token detects tampering.
rewrite_tamper_dir="$TMP/rewrite-tamper"
rewrite_tamper_zh="$rewrite_tamper_dir/pair.mdx"
mkdir -p "$rewrite_tamper_dir"
printf '%s\n' 'validated pre-writer bytes' > "$rewrite_tamper_zh"
rewrite_tamper_snapshot="$(tribunal_post_pair_snapshot_create "$rewrite_tamper_zh")"
rewrite_tamper_snapshot_path="$(snapshot_path_from_token "$rewrite_tamper_snapshot")"
printf '%s\n' 'same-uid attacker poisoned recovery bytes' \
  > "$rewrite_tamper_snapshot_path/zh"
printf '%s\n' 'writer state must remain visible on failed restore' > "$rewrite_tamper_zh"
set +e
tribunal_post_pair_snapshot_restore "$rewrite_tamper_zh" "$rewrite_tamper_snapshot" \
  >"$TMP/rewrite-tamper.out" 2>"$TMP/rewrite-tamper.err"
rewrite_tamper_rc=$?
set -e
[ "$rewrite_tamper_rc" -eq 0 ] ||
  fail "parent-held recovery token must survive disk snapshot tampering"
grep -Fq 'validated pre-writer bytes' "$rewrite_tamper_zh" ||
  fail "tampered disk snapshot overrode the parent-held recovery payload"
[ -d "$rewrite_tamper_snapshot_path" ] ||
  fail "tampered rewrite recovery evidence was not preserved"
set +e
tribunal_post_pair_snapshot_discard "$rewrite_tamper_snapshot" \
  >"$TMP/rewrite-tamper-discard.out" 2>"$TMP/rewrite-tamper-discard.err"
rewrite_tamper_discard_rc=$?
set -e
[ "$rewrite_tamper_discard_rc" -ne 0 ] ||
  fail "tampered disk evidence must not be silently trusted during cleanup"
pass "parent-held recovery bytes survive same-uid disk snapshot tampering"

# macOS commonly exposes TMPDIR through a symlinked ancestor (for example
# /var → /private/var). Canonicalize trusted ancestors, while keeping the
# snapshot leaf and every payload entry no-follow.
rewrite_symlink_tmp_real="$TMP/rewrite-symlink-tmp-real"
rewrite_symlink_tmp_link="$TMP/rewrite-symlink-tmp-link"
rewrite_symlink_tmp_post_dir="$TMP/rewrite-symlink-tmp-post"
rewrite_symlink_tmp_zh="$rewrite_symlink_tmp_post_dir/pair.mdx"
mkdir -p "$rewrite_symlink_tmp_real" "$rewrite_symlink_tmp_post_dir"
ln -s "$rewrite_symlink_tmp_real" "$rewrite_symlink_tmp_link"
printf '%s\n' 'validated through symlinked TMPDIR' > "$rewrite_symlink_tmp_zh"
set +e
rewrite_symlink_tmp_snapshot="$(
  TMPDIR="$rewrite_symlink_tmp_link" \
    tribunal_post_pair_snapshot_create "$rewrite_symlink_tmp_zh" \
    2>"$TMP/rewrite-symlink-tmp.err"
)"
rewrite_symlink_tmp_rc=$?
set -e
[ "$rewrite_symlink_tmp_rc" -eq 0 ] ||
  fail "symlink-ancestor TMPDIR snapshot must succeed, got rc=$rewrite_symlink_tmp_rc"
rewrite_symlink_tmp_snapshot_path="$(
  snapshot_path_from_token "$rewrite_symlink_tmp_snapshot"
)"
case "$rewrite_symlink_tmp_snapshot_path" in
  "$rewrite_symlink_tmp_real"/tribunal-rewrite.*) ;;
  *) fail "symlink-ancestor TMPDIR did not resolve to its canonical directory" ;;
esac
tribunal_post_pair_snapshot_discard "$rewrite_symlink_tmp_snapshot" ||
  fail "symlink-ancestor TMPDIR snapshot cleanup failed"
[ ! -e "$rewrite_symlink_tmp_snapshot_path" ] ||
  fail "symlink-ancestor TMPDIR cleanup left its snapshot behind"
pass "trusted symlink ancestors work without weakening snapshot-leaf no-follow"

if grep -Fq 'git checkout --' "$TRIBUNAL"; then
  fail "writer rollback must not reset target posts to Git HEAD"
fi
pass "writer rollback no longer resets earlier persisted scores to Git HEAD"

# Exercise the real final-build orchestration with skipped, already-passed
# judges and bounded fake build/writer commands. This verifies lifecycle order,
# not merely the snapshot primitive.
final_gate_bin="$TMP/final-gate-bin"
final_gate_version="$(node "$ROOT_DIR/scripts/tribunal-version.mjs" current)"
final_gate_post="gp-1-20260128-demo.mdx"
final_gate_zh="$ROOT_DIR/src/content/posts/$final_gate_post"
final_gate_en="$ROOT_DIR/src/content/posts/en-$final_gate_post"
final_gate_zh_pristine="$TMP/final-gate-zh-pristine"
final_gate_en_pristine="$TMP/final-gate-en-pristine"
final_gate_zh_baseline="$TMP/final-gate-zh-baseline"
final_gate_en_baseline="$TMP/final-gate-en-baseline"
final_gate_real_jq="$(command -v jq)"
mkdir -p "$final_gate_bin"
cp -p "$final_gate_zh" "$final_gate_zh_pristine"
cp -p "$final_gate_en" "$final_gate_en_pristine"
cp -p "$final_gate_zh_pristine" "$final_gate_zh_baseline"
cp -p "$final_gate_en_pristine" "$final_gate_en_baseline"

seed_final_gate_scores() {
  local file="$1"
  node "$ROOT_DIR/scripts/frontmatter-scores.mjs" write "$file" factCheck \
    '{"dimensions":{"accuracy":9,"fidelity":9,"consistency":9,"sourceBoundary":9,"commentarySeparation":9},"score":9,"verdict":"PASS","model":"gpt-test"}'
  node "$ROOT_DIR/scripts/frontmatter-scores.mjs" write "$file" librarian \
    '{"dimensions":{"glossary":9,"crossRef":9,"sourceAlign":9,"attribution":9},"score":9,"verdict":"PASS","model":"gpt-test"}'
  node "$ROOT_DIR/scripts/frontmatter-scores.mjs" write "$file" freshEyes \
    '{"dimensions":{"readability":9,"firstImpression":9,"payoffDensity":9,"lengthFit":9,"clarity":9},"score":9,"verdict":"PASS","model":"gpt-test"}'
  node "$ROOT_DIR/scripts/frontmatter-scores.mjs" write "$file" vibe \
    '{"dimensions":{"persona":9,"moguNote":9,"vibe":9,"narrative":9},"score":9,"verdict":"PASS","model":"gpt-test"}'
}
seed_final_gate_scores "$final_gate_zh_baseline"
seed_final_gate_scores "$final_gate_en_baseline"

cleanup_final_gate_fixture() {
  cp -p "$final_gate_zh_pristine" "$final_gate_zh" 2>/dev/null || true
  if [ -d "$final_gate_en" ]; then
    rm -f "$final_gate_en/$(basename "$final_gate_en_baseline")" 2>/dev/null || true
    rmdir "$final_gate_en" 2>/dev/null || true
  fi
  cp -p "$final_gate_en_pristine" "$final_gate_en" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup_final_gate_fixture EXIT

resume_artifact_bin="$TMP/resume-artifact-bin"
resume_artifact_progress="$TMP/resume-artifact-progress.json"
resume_artifact_calls="$TMP/resume-artifact-calls"
mkdir -p "$resume_artifact_bin"
cat > "$resume_artifact_bin/codex" <<'RESUME_ARTIFACT_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  prompt="${!#}"
  score_path="$(
    printf '%s\n' "$prompt" |
      sed -n 's/^Write your JSON result to: //p' |
      tail -1
  )"
  [ -n "$score_path" ] || exit 72
  printf 'judge-ran\n' >> "$RESUME_ARTIFACT_CALLS"
  cat > "$score_path" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 9,
    "fidelity": 9,
    "consistency": 9,
    "sourceBoundary": 9,
    "commentarySeparation": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {}
}
JSON
  exit 0
fi
exit 1
RESUME_ARTIFACT_CODEX
chmod +x "$resume_artifact_bin/codex"
jq -n \
  --arg article "$final_gate_post" \
  --argjson version "$final_gate_version" \
  '{
    ($article): {
      article: $article,
      status: "PENDING",
      tribunalVersion: $version,
      topLevelAttempts: 0,
      stages: {
        factChecker: {
          status: "pass",
          tribunalVersion: $version,
          score: {
            dimensions: {
              accuracy: 9,
              fidelity: 9,
              consistency: 9,
              sourceBoundary: 9,
              commentarySeparation: 9
            },
            score: 9
          }
        }
      }
    }
  }' > "$resume_artifact_progress"
: > "$resume_artifact_calls"
set +e
PATH="$resume_artifact_bin:$PATH" \
PROGRESS_FILE="$resume_artifact_progress" \
TRIBUNAL_FORCE_PROVIDER=codex \
GP_CODEX_MODEL=gpt-test \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
RESUME_ARTIFACT_CALLS="$resume_artifact_calls" \
bash "$TRIBUNAL" --only-stage factChecker --no-commit "$final_gate_post" \
  >"$TMP/resume-artifact.out" 2>"$TMP/resume-artifact.err"
resume_artifact_rc=$?
set -e
[ "$resume_artifact_rc" -eq 0 ] ||
  fail "missing frontmatter artifact resume must rerun successfully"
[ "$(grep -c '^judge-ran$' "$resume_artifact_calls")" = "1" ] ||
  fail "PASS ledger without frontmatter artifact skipped the judge"
node "$ROOT_DIR/scripts/frontmatter-scores.mjs" \
  get "$final_gate_zh" factCheck | jq -e '.score == 9' >/dev/null ||
  fail "resumed judge did not restore the missing zh-tw score artifact"
node "$ROOT_DIR/scripts/frontmatter-scores.mjs" \
  get "$final_gate_en" factCheck | jq -e '.score == 9' >/dev/null ||
  fail "resumed judge did not restore the missing English score artifact"
cp -p "$final_gate_zh_pristine" "$final_gate_zh"
cp -p "$final_gate_en_pristine" "$final_gate_en"
pass "PASS ledgers rerun when persisted frontmatter artifacts are missing"

# A deleted tracked English sidecar is not equivalent to a monolingual post.
# The resume path must fail as infrastructure before a judge can stamp another
# zh-only PASS.
seed_final_gate_scores "$final_gate_zh"
seed_final_gate_scores "$final_gate_en"
rm -f "$final_gate_en"
: > "$resume_artifact_calls"
set +e
PATH="$resume_artifact_bin:$PATH" \
PROGRESS_FILE="$resume_artifact_progress" \
TRIBUNAL_FORCE_PROVIDER=codex \
GP_CODEX_MODEL=gpt-test \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
RESUME_ARTIFACT_CALLS="$resume_artifact_calls" \
bash "$TRIBUNAL" --only-stage factChecker --no-commit "$final_gate_post" \
  >"$TMP/resume-missing-en.out" 2>"$TMP/resume-missing-en.err"
resume_missing_en_rc=$?
set -e
[ "$resume_missing_en_rc" -eq 70 ] ||
  fail "missing tracked English artifact must fail closed with rc=70"
[ ! -s "$resume_artifact_calls" ] ||
  fail "missing tracked English artifact invoked a judge that cannot restore it"
jq -e --arg article "$final_gate_post" \
  '.[$article].stages.factChecker.status == "runner_error"' \
  "$resume_artifact_progress" >/dev/null ||
  fail "missing tracked English artifact retained a resumable PASS"
grep -Fq 'tracked English artifact is missing' \
  "$TMP/resume-missing-en.out" "$TMP/resume-missing-en.err" ||
  fail "missing tracked English artifact did not emit its fail-closed reason"
cp -p "$final_gate_zh_pristine" "$final_gate_zh"
cp -p "$final_gate_en_pristine" "$final_gate_en"
pass "tracked English deletion cannot resume or publish a zh-only PASS"

cat > "$final_gate_bin/codex" <<'FINAL_GATE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "login" ] && [ "${2:-}" = "status" ]; then
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  argv=" $* "
  case "$argv" in
    *" --sandbox workspace-write "*) ;;
    *) echo "writer did not use workspace-write sandbox" >&2; exit 72 ;;
  esac
  has_arg() {
    needle="$1"
    shift
    for value in "$@"; do
      [ "$value" != "$needle" ] || return 0
    done
    return 1
  }
  for required in --ignore-user-config --ignore-rules --ephemeral --strict-config; do
    has_arg "$required" "$@" ||
      {
        echo "writer missing safe flag: $required" >&2
        printf 'argv=' >&2
        printf '<%q>' "$@" >&2
        printf '\n' >&2
        exit 72
      }
  done
  ! has_arg --add-dir "$@" ||
    { echo "writer widened its writable roots" >&2; exit 72; }
  prompt="${!#}"
  candidate_zh="$(
    printf '%s\n' "$prompt" |
      sed -n '/^## Writable zh-tw candidate$/{n;p;}' |
      tail -1
  )"
  candidate_en="$(
    printf '%s\n' "$prompt" |
      sed -n '/^## Writable English candidate, if present$/{n;p;}' |
      tail -1
  )"
  [ -f "$candidate_zh" ] || {
    echo "writer prompt did not point at a materialized zh-tw candidate" >&2
    exit 72
  }
  count=0
  [ ! -r "$FINAL_GATE_WRITER_COUNT" ] ||
    count="$(cat "$FINAL_GATE_WRITER_COUNT")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$FINAL_GATE_WRITER_COUNT"
  if [ "$FINAL_GATE_BEHAVIOR" = "second-infra" ] && [ "$count" -eq 2 ]; then
    echo "second writer failed before candidate apply" >&2
    exit 70
  fi
  printf '\n<!-- final-gate-writer-%s -->\n' "$count" >> "$candidate_zh"
  case "$FINAL_GATE_BEHAVIOR" in
    quota|quota-ledger-fail)
      exit 75
      ;;
    quota-tamper)
      snapshot_zh="$(find "$TMPDIR" -path '*/tribunal-rewrite.*/zh' -print -quit)"
      [ -n "$snapshot_zh" ] || exit 71
      printf '%s\n' 'same-uid writer poisoned final-gate snapshot' > "$snapshot_zh"
      exit 75
      ;;
    quota-unsafe-target)
      rm -f "$candidate_en"
      mkdir "$candidate_en"
      exit 75
      ;;
    success-background)
      setsid sh -c '
        trap "" TERM
        sleep 1
        printf "\n<!-- escaped-background-writer -->\n" >> "$1"
      ' _ "$candidate_zh" >/dev/null 2>&1 &
      exit 0
      ;;
  esac
  exit 0
fi
exit 1
FINAL_GATE_CODEX

cat > "$final_gate_bin/grok" <<'FINAL_GATE_GROK'
#!/usr/bin/env bash
if [ "${1:-}" = "--help" ]; then
  exit 0
fi
if [ "${1:-}" = "models" ]; then
  printf 'Default model: grok-4.5\nAvailable models:\n  * grok-4.5 (default)\n'
  exit 0
fi
prompt="${!#}"
candidate_zh="$(
  printf '%s\n' "$prompt" |
    sed -n '/^## Writable zh-tw candidate$/{n;p;}' |
    tail -1
)"
[ -f "$candidate_zh" ] || exit 72
count=0
[ ! -r "$FINAL_GATE_WRITER_COUNT" ] ||
  count="$(cat "$FINAL_GATE_WRITER_COUNT")"
count=$((count + 1))
printf '%s\n' "$count" > "$FINAL_GATE_WRITER_COUNT"
printf '\n<!-- final-gate-grok-writer-%s -->\n' "$count" >> "$candidate_zh"
printf 'grok-ok\n'
FINAL_GATE_GROK

cat > "$final_gate_bin/systemd-run" <<'FINAL_GATE_SYSTEMD_RUN'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = -- ]; then
    shift
    break
  fi
  shift
done
[ "$#" -gt 0 ] || exit 64
exec "$@"
FINAL_GATE_SYSTEMD_RUN

cat > "$final_gate_bin/pnpm" <<'FINAL_GATE_PNPM'
#!/usr/bin/env bash
count=0
[ ! -r "$FINAL_GATE_BUILD_COUNT" ] ||
  count="$(cat "$FINAL_GATE_BUILD_COUNT")"
count=$((count + 1))
printf '%s\n' "$count" > "$FINAL_GATE_BUILD_COUNT"
case "$FINAL_GATE_BEHAVIOR" in
  operational)
    echo "FATAL ERROR: JavaScript heap out of memory"
    exit 1
    ;;
  success|success-background)
    if [ "$count" -gt 1 ]; then
      exit 0
    fi
    ;;
  exhausted|second-infra|quota|quota-tamper|quota-ledger-fail|quota-unsafe-target)
    ;;
  *)
    exit 2
    ;;
esac
printf 'MDX SyntaxError while rendering %s\n' "$FINAL_GATE_POST_REL"
exit 1
FINAL_GATE_PNPM

cat > "$final_gate_bin/jq" <<'FINAL_GATE_JQ'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *QUOTA_SUSPENDED*)
      cmp -s "$FINAL_GATE_BASELINE" "$FINAL_GATE_POST_PATH" || exit 91
      if [ "$FINAL_GATE_BEHAVIOR" = "quota-ledger-fail" ]; then
        exit 9
      fi
      ;;
  esac
done
exec "$FINAL_GATE_REAL_JQ" "$@"
FINAL_GATE_JQ
chmod +x "$final_gate_bin/codex" "$final_gate_bin/grok" \
  "$final_gate_bin/systemd-run" "$final_gate_bin/pnpm" "$final_gate_bin/jq"

write_final_gate_progress() {
  local progress_file="$1"
  jq -n \
    --arg article "$final_gate_post" \
    --argjson version "$final_gate_version" \
    '{
      ($article): {
        article: $article,
        status: "PENDING",
        tribunalVersion: $version,
        topLevelAttempts: 0,
        stages: {
          factChecker: {
            status: "pass",
            tribunalVersion: $version,
            score: {
              dimensions: {
                accuracy: 9,
                fidelity: 9,
                consistency: 9,
                sourceBoundary: 9,
                commentarySeparation: 9
              },
              score: 9
            }
          },
          librarian: {
            status: "pass",
            tribunalVersion: $version,
            score: {
              dimensions: {
                glossary: 9,
                crossRef: 9,
                sourceAlign: 9,
                attribution: 9
              },
              score: 9
            }
          },
          freshEyes: {
            status: "pass",
            tribunalVersion: $version,
            score: {
              dimensions: {
                readability: 9,
                firstImpression: 9,
                payoffDensity: 9,
                lengthFit: 9,
                clarity: 9
              },
              score: 9
            }
          },
          vibe: {
            status: "pass",
            tribunalVersion: $version,
            score: {
              dimensions: {
                persona: 9,
                moguNote: 9,
                vibe: 9,
                narrative: 9
              },
              score: 9
            }
          }
        }
      }
    }' > "$progress_file"
}

run_final_gate_scenario() {
  local name="$1" behavior="$2"
  local writer_mode="${3:-codex}" runtime_profile=legacy
  local scenario_dir="$TMP/final-gate-$name"
  local progress_file="$scenario_dir/progress.json"
  local coordinator_dir="$scenario_dir/coordinator"
  local -a tribunal_args
  mkdir -p \
    "$scenario_dir/tmp" \
    "$scenario_dir/article-locks" \
    "$scenario_dir/shared-locks" \
    "$coordinator_dir/src/content/posts"
  chmod 700 "$scenario_dir/article-locks"
  if [ -d "$final_gate_en" ]; then
    rmdir "$final_gate_en"
  fi
  cp -p "$final_gate_zh_baseline" "$final_gate_zh"
  cp -p "$final_gate_en_baseline" "$final_gate_en"
  cp -p "$final_gate_zh_baseline" \
    "$coordinator_dir/src/content/posts/$final_gate_post"
  cp -p "$final_gate_en_baseline" \
    "$coordinator_dir/src/content/posts/en-$final_gate_post"
  git -C "$coordinator_dir" init -q
  git -C "$coordinator_dir" config user.name "Tribunal Test"
  git -C "$coordinator_dir" config user.email "tribunal-test@example.com"
  git -C "$coordinator_dir" add "src/content/posts/$final_gate_post"
  git -C "$coordinator_dir" add "src/content/posts/en-$final_gate_post"
  git -C "$coordinator_dir" commit -qm "test: baseline"
  write_final_gate_progress "$progress_file"
  printf '0\n' > "$scenario_dir/writer-count"
  printf '0\n' > "$scenario_dir/build-count"

  tribunal_args=(--no-commit "$final_gate_post")
  if [ "$writer_mode" = grok ]; then
    runtime_profile=vm-codex
  fi

  set +e
  PATH="$final_gate_bin:$PATH" \
  TMPDIR="$scenario_dir/tmp" \
  PROGRESS_FILE="$progress_file" \
  TRIBUNAL_ARTICLE_LOCK_DIR="$scenario_dir/article-locks" \
  TRIBUNAL_SHARED_LOCK_DIR="$scenario_dir/shared-locks" \
  TRIBUNAL_MAIN_REPO="$coordinator_dir" \
  TRIBUNAL_RUNTIME_PROFILE="$runtime_profile" \
  TRIBUNAL_FORCE_PROVIDER=codex \
  GP_WRITER_MODE="$writer_mode" \
  GP_CODEX_MODEL=gpt-test \
  TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
  FINAL_GATE_BEHAVIOR="$behavior" \
  FINAL_GATE_POST_PATH="$final_gate_zh" \
  FINAL_GATE_EN_PATH="$final_gate_en" \
  FINAL_GATE_POST_REL="src/content/posts/$final_gate_post" \
  FINAL_GATE_BASELINE="$final_gate_zh_baseline" \
  FINAL_GATE_BUILD_COUNT="$scenario_dir/build-count" \
  FINAL_GATE_WRITER_COUNT="$scenario_dir/writer-count" \
  FINAL_GATE_REAL_JQ="$final_gate_real_jq" \
  bash "$TRIBUNAL" "${tribunal_args[@]}" \
    >"$scenario_dir/out" 2>"$scenario_dir/err"
  FINAL_GATE_LAST_RC=$?
  set -e

  FINAL_GATE_LAST_DIR="$scenario_dir"
  FINAL_GATE_LAST_COORDINATOR="$coordinator_dir"
  FINAL_GATE_LAST_PROGRESS="$progress_file"
}

run_final_gate_scenario operational operational
[ "$FINAL_GATE_LAST_RC" -eq 1 ] ||
  fail "initial operational final-build failure must return rc=1"
[ "$(cat "$FINAL_GATE_LAST_DIR/writer-count")" = "0" ] ||
  fail "initial operational final-build failure invoked the writer"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "initial operational final-build failure changed the target post"
if find "$FINAL_GATE_LAST_DIR/tmp" -maxdepth 1 -name 'tribunal-rewrite.*' -print -quit |
  grep -q .; then
  fail "initial operational final-build failure created a rewrite snapshot"
fi
pass "initial operational final-build failures do not snapshot or restore"

run_final_gate_scenario exhausted exhausted
[ "$FINAL_GATE_LAST_RC" -eq 1 ] ||
  fail "exhausted final-build repairs must return rc=1"
if [ "$(cat "$FINAL_GATE_LAST_DIR/writer-count")" != "2" ]; then
  sed -n '1,200p' "$FINAL_GATE_LAST_DIR/out" >&2 || true
  sed -n '1,200p' "$FINAL_GATE_LAST_DIR/err" >&2 || true
  fail "final-build repair did not stop after two writer attempts"
fi
[ "$(cat "$FINAL_GATE_LAST_DIR/build-count")" = "3" ] ||
  fail "final-build repair did not run one initial and two repaired builds"
if ! cmp -s "$final_gate_zh" "$final_gate_zh_baseline"; then
  diff -u "$final_gate_zh_baseline" "$final_gate_zh" >&2 || true
  fail "multi-attempt final-build failure did not restore the original snapshot"
fi
cmp -s "$final_gate_en" "$final_gate_en_baseline" ||
  fail "multi-attempt final-build failure changed the English counterpart"
if find "$FINAL_GATE_LAST_DIR/tmp" -maxdepth 1 -name 'tribunal-rewrite.*' -print -quit |
  grep -q .; then
  fail "multi-attempt final-build failure left its restored snapshot behind"
fi
pass "final-build repairs snapshot once and restore after bounded exhaustion"

run_final_gate_scenario second-infra second-infra
[ "$FINAL_GATE_LAST_RC" -eq 70 ] ||
  fail "second final-build writer infrastructure failure must return rc=70"
[ "$(cat "$FINAL_GATE_LAST_DIR/writer-count")" = "2" ] ||
  fail "second-infra scenario did not reach the second writer"
[ "$(cat "$FINAL_GATE_LAST_DIR/build-count")" = "2" ] ||
  fail "second-infra scenario ran a build after the failed writer"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "second writer infrastructure failure retained the first repair's zh-tw bytes"
cmp -s "$final_gate_en" "$final_gate_en_baseline" ||
  fail "second writer infrastructure failure changed the English counterpart"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "RUNNER_ERROR" ] ||
  fail "second writer infrastructure failure did not persist RUNNER_ERROR"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].stages.finalBuild.error' "$FINAL_GATE_LAST_PROGRESS")" = "writer_candidate_transaction_failed" ] ||
  fail "second writer infrastructure failure lost its specific runner-error reason"
if find "$FINAL_GATE_LAST_DIR/tmp" -maxdepth 1 -name 'tribunal-rewrite.*' -print -quit |
  grep -q .; then
  fail "second writer infrastructure failure left its restored snapshot behind"
fi
pass "later writer infrastructure failures restore the outer pre-repair baseline"

run_final_gate_scenario success success
[ "$FINAL_GATE_LAST_RC" -eq 0 ] ||
  fail "successful final-build repair must return rc=0"
grep -Fq '<!-- final-gate-writer-1 -->' "$final_gate_zh" ||
  fail "successful final-build repair discarded the writer change"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "PASS" ] ||
  fail "successful final-build repair did not persist PASS"
if find "$FINAL_GATE_LAST_DIR/tmp" -maxdepth 1 -name 'tribunal-rewrite.*' -print -quit |
  grep -q .; then
  fail "successful final-build repair left its snapshot behind"
fi
pass "successful final-build repair retains writer changes and discards recovery state"

run_final_gate_scenario grok-success success grok
if [ "$FINAL_GATE_LAST_RC" -ne 0 ]; then
  sed -n '1,200p' "$FINAL_GATE_LAST_DIR/out" >&2 || true
  sed -n '1,200p' "$FINAL_GATE_LAST_DIR/err" >&2 || true
  fail "successful Grok final-build repair must return rc=0"
fi
grep -Fq '<!-- final-gate-grok-writer-1 -->' "$final_gate_zh" ||
  fail "successful Grok final-build repair discarded the writer change"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "PASS" ] ||
  fail "successful Grok final-build repair did not persist PASS"
pass "Grok final-build repair accepts complete provider provenance"

run_final_gate_scenario success-background success-background
[ "$FINAL_GATE_LAST_RC" -eq 0 ] ||
  fail "writer with a leftover background descendant must still complete safely"
sleep 1.2
grep -Fq '<!-- final-gate-writer-1 -->' "$final_gate_zh" ||
  fail "writer descendant cleanup discarded the synchronous writer change"
if grep -Fq '<!-- escaped-background-writer -->' "$final_gate_zh"; then
  fail "writer background descendant survived process-group quiescence"
fi
pass "setsid-escaped writer descendants remain confined to disposable candidates"

run_final_gate_scenario quota quota
[ "$FINAL_GATE_LAST_RC" -eq 75 ] ||
  fail "final-build writer quota must return rc=75"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "final-build quota ledger was written before exact post restoration"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "QUOTA_SUSPENDED" ] ||
  fail "restored final-build quota did not persist QUOTA_SUSPENDED"
pass "final-build quota restores the post pair before persisting suspension"

run_final_gate_scenario quota-ledger-fail quota-ledger-fail
[ "$FINAL_GATE_LAST_RC" -eq 70 ] ||
  fail "final-build quota ledger failure must return rc=70, got $FINAL_GATE_LAST_RC"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "final-build quota ledger failure did not retain the restored post"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "RUNNER_ERROR" ] ||
  fail "final-build quota ledger failure did not persist RUNNER_ERROR"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].stages.finalBuild.error' "$FINAL_GATE_LAST_PROGRESS")" = "quota_suspension_persistence_failed" ] ||
  fail "final-build quota ledger failure lost its specific runner-error reason"
pass "final-build quota ledger failures fail closed as runner errors"

run_final_gate_scenario quota-tamper quota-tamper
[ "$FINAL_GATE_LAST_RC" -eq 75 ] ||
  fail "disk-tampered final-build snapshot must restore from the parent token"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "parent-held final-build recovery bytes were not restored"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "QUOTA_SUSPENDED" ] ||
  fail "recovered disk-tampered snapshot did not persist quota suspension"
pass "final-build recovery does not trust writer-accessible snapshot bytes"

run_final_gate_scenario quota-unsafe-target quota-unsafe-target
[ "$FINAL_GATE_LAST_RC" -eq 75 ] ||
  fail "quota with a hostile candidate must leave canonical posts untouched"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "hostile quota candidate changed canonical zh-tw bytes"
cmp -s "$final_gate_en" "$final_gate_en_baseline" ||
  fail "hostile quota candidate changed canonical English bytes"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$FINAL_GATE_LAST_PROGRESS")" = "QUOTA_SUSPENDED" ] ||
  fail "hostile quota candidate did not persist QUOTA_SUSPENDED"
[ "$(git -C "$FINAL_GATE_LAST_COORDINATOR" rev-list --count HEAD)" = "1" ] ||
  fail "quota checkpoint created an article commit"
cmp -s \
  "$FINAL_GATE_LAST_COORDINATOR/src/content/posts/$final_gate_post" \
  "$final_gate_zh_baseline" ||
  fail "quota checkpoint published untrusted zh-tw candidate bytes"
cmp -s \
  "$FINAL_GATE_LAST_COORDINATOR/src/content/posts/en-$final_gate_post" \
  "$final_gate_en_baseline" ||
  fail "quota checkpoint published an unsafe English candidate"
pass "quota checkpoints discard hostile candidates without canonical writes"

if [ -d "$final_gate_en" ]; then
  rmdir "$final_gate_en"
fi
cp -p "$final_gate_zh_baseline" "$final_gate_zh"
cp -p "$final_gate_en_baseline" "$final_gate_en"

# The stage rewrite path owns the same restore-before-ledger contract as the
# final-build repair path. Exercise it through the real run_stage orchestration.
stage_quota_bin="$TMP/stage-quota-bin"
stage_quota_real_jq="$(command -v jq)"
mkdir -p "$stage_quota_bin"
cat > "$stage_quota_bin/codex" <<'STAGE_QUOTA_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  prompt="${!#}"
  score_path="$(
    printf '%s\n' "$prompt" |
      sed -n 's/^Write your JSON result to: //p' |
      tail -1
  )"
  if [ -n "$score_path" ]; then
    cat > "$score_path" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 4,
    "fidelity": 9,
    "consistency": 9,
    "sourceBoundary": 9,
    "commentarySeparation": 9
  },
  "score": 4,
  "verdict": "FAIL",
  "reasons": {"accuracy": "stage quota fixture"}
}
JSON
    exit 0
  fi
  argv=" $* "
  case "$argv" in
    *" --sandbox workspace-write "*) ;;
    *) echo "stage writer did not use workspace-write sandbox" >&2; exit 72 ;;
  esac
  prompt="${!#}"
  candidate_zh="$(
    printf '%s\n' "$prompt" |
      sed -n '/^## Writable zh-tw candidate$/{n;p;}' |
      tail -1
  )"
  [ -f "$candidate_zh" ] || exit 72
  printf '\n<!-- stage-quota-writer -->\n' >> "$candidate_zh"
  exit 75
fi
exit 1
STAGE_QUOTA_CODEX

cat > "$stage_quota_bin/jq" <<'STAGE_QUOTA_JQ'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *QUOTA_SUSPENDED*)
      cmp -s "$STAGE_QUOTA_BASELINE" "$STAGE_QUOTA_POST_PATH" || exit 91
      if [ "$STAGE_QUOTA_BEHAVIOR" = "ledger-fail" ]; then
        exit 9
      fi
      ;;
  esac
done
exec "$STAGE_QUOTA_REAL_JQ" "$@"
STAGE_QUOTA_JQ
cat > "$stage_quota_bin/pnpm" <<'STAGE_QUOTA_PNPM'
#!/usr/bin/env bash
exit 99
STAGE_QUOTA_PNPM
chmod +x "$stage_quota_bin/codex" "$stage_quota_bin/jq" "$stage_quota_bin/pnpm"

run_stage_quota_scenario() {
  local behavior="$1"
  local scenario_dir="$TMP/stage-quota-$behavior"
  local progress_file="$scenario_dir/progress.json"
  mkdir -p "$scenario_dir/tmp" "$scenario_dir/article-locks" "$scenario_dir/shared-locks"
  chmod 700 "$scenario_dir/article-locks"
  cp -p "$final_gate_zh_baseline" "$final_gate_zh"
  cp -p "$final_gate_en_baseline" "$final_gate_en"
  printf '{}\n' > "$progress_file"

  set +e
  PATH="$stage_quota_bin:$PATH" \
  TMPDIR="$scenario_dir/tmp" \
  PROGRESS_FILE="$progress_file" \
  TRIBUNAL_ARTICLE_LOCK_DIR="$scenario_dir/article-locks" \
  TRIBUNAL_SHARED_LOCK_DIR="$scenario_dir/shared-locks" \
  TRIBUNAL_FORCE_PROVIDER=codex \
  GP_WRITER_MODE=codex \
  GP_CODEX_MODEL=gpt-test \
  TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
  STAGE_QUOTA_BEHAVIOR="$behavior" \
  STAGE_QUOTA_POST_PATH="$final_gate_zh" \
  STAGE_QUOTA_BASELINE="$final_gate_zh_baseline" \
  STAGE_QUOTA_REAL_JQ="$stage_quota_real_jq" \
  bash "$TRIBUNAL" --only-stage factChecker --allow-rewrite --no-commit \
    "$final_gate_post" >"$scenario_dir/out" 2>"$scenario_dir/err"
  STAGE_QUOTA_LAST_RC=$?
  set -e
  STAGE_QUOTA_LAST_PROGRESS="$progress_file"
}

run_stage_quota_scenario quota
[ "$STAGE_QUOTA_LAST_RC" -eq 75 ] ||
  fail "stage writer quota must return rc=75, got $STAGE_QUOTA_LAST_RC"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "stage writer quota was persisted before exact zh-tw restoration"
cmp -s "$final_gate_en" "$final_gate_en_baseline" ||
  fail "stage writer quota changed the English counterpart"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$STAGE_QUOTA_LAST_PROGRESS")" = "QUOTA_SUSPENDED" ] ||
  fail "stage writer quota did not persist QUOTA_SUSPENDED"
pass "stage writer quota restores the pair before persisting suspension"

run_stage_quota_scenario ledger-fail
[ "$STAGE_QUOTA_LAST_RC" -eq 70 ] ||
  fail "stage writer quota ledger failure must return rc=70"
cmp -s "$final_gate_zh" "$final_gate_zh_baseline" ||
  fail "stage quota ledger failure lost the restored zh-tw state"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].status' "$STAGE_QUOTA_LAST_PROGRESS")" = "RUNNER_ERROR" ] ||
  fail "stage quota ledger failure did not persist RUNNER_ERROR"
[ "$(jq -r --arg a "$final_gate_post" '.[$a].stages.factChecker.error' "$STAGE_QUOTA_LAST_PROGRESS")" = "quota_suspension_persistence_failed" ] ||
  fail "stage quota ledger failure lost its specific runner-error reason"
pass "stage quota ledger failures remain exact runner errors after restoration"

if [ -d "$final_gate_en" ]; then
  rmdir "$final_gate_en"
fi
cp -p "$final_gate_zh_baseline" "$final_gate_zh"
cp -p "$final_gate_en_baseline" "$final_gate_en"
