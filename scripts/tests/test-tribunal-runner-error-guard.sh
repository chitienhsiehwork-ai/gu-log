#!/usr/bin/env bash
# Regression test: a broken judge runner must stop Tribunal as infrastructure
# failure, not mark the article FAILED/EXHAUSTED.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

if grep -Fq 'TRIBUNAL_ARTICLE_LOCK_DIR:-/tmp' "$TRIBUNAL"; then
  fail "tribunal default article lock directory must not be the shared /tmp root"
fi
pass "tribunal default article lock directory is not the shared /tmp root"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
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
