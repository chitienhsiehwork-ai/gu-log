#!/usr/bin/env bash
# Focused/no-token regression tests for the batch runner's provider-aware quota gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BATCH_RUNNER="$ROOT_DIR/scripts/tribunal-batch-runner.sh"
QUOTA_LOOP="$ROOT_DIR/scripts/tribunal-quota-loop.sh"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"

# shellcheck source=scripts/tribunal-helpers.sh
source "$HELPERS"

# Load only the quota section; sourcing the full batch runner would execute its
# main program. The section is deliberately bounded by stable headings.
quota_section=$(awk '
  /^# ─── Quota Check/ { capture=1 }
  capture && /^# ─── Build Unscored/ { exit }
  capture { print }
' "$BATCH_RUNNER")
eval "$quota_section"

# Load the selector without executing the batch runner's main program.
selector_section=$(awk '
  /^# ─── Build Unscored/ { capture=1 }
  capture && /^# ─── Main/ { exit }
  capture { print }
' "$BATCH_RUNNER")
eval "$selector_section"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# The batch reads quota the way the deployed daemon does: CodexBar's Codex
# JSON through tribunal_quota_codexbar_json/tribunal_quota_parse_json. A fake
# codexbar that always fails proves no case below falls back to a live probe,
# and the retired usage-monitor must play no part (#1164).
mkdir -p "$tmp_dir/bin"
printf '#!/bin/sh\nexit 1\n' > "$tmp_dir/bin/codexbar"
chmod +x "$tmp_dir/bin/codexbar"
PATH="$tmp_dir/bin:$PATH"
unset TRIBUNAL_QUOTA_CODEXBAR_JSON
USAGE_MONITOR="$tmp_dir/missing-usage-monitor.sh"
export USAGE_MONITOR
TRIBUNAL_QUOTA_NOW_EPOCH=1800000000
export TRIBUNAL_QUOTA_NOW_EPOCH

# codex_json <5h used % or null> <weekly used %>
codex_json() {
  local primary='null'
  if [ "$1" != null ]; then
    primary="{\"usedPercent\":$1,\"windowMinutes\":300,\"resetsAt\":1800003600}"
  fi
  printf '[{"provider":"codex","source":"cli","usage":{"primary":%s,"secondary":{"usedPercent":%s,"windowMinutes":10080,"resetsAt":1800300000}}}]\n' \
    "$primary" "$2"
}

QUOTA_FLOOR=10
ACTIVE_GLOBAL_PROVIDER=codex
ACTIVE_VIBE_PROVIDER=codex
ACTIVE_WRITER_MODE=none
CLAUDE_AVAILABLE=true
GP_JUDGE_ALLOW_CLAUDE=0
LOG_OUTPUT=""

# Override only provider discovery; the production gate must still call the
# canonical resolver interfaces from tribunal-helpers.sh.
tribunal_llm_provider() {
  case "$ACTIVE_GLOBAL_PROVIDER" in
    codex|claude) printf '%s\n' "$ACTIVE_GLOBAL_PROVIDER" ;;
    *) return 1 ;;
  esac
}

tribunal_judge_provider() {
  if [ "${1:-}" = "vibe-opus-scorer" ]; then
    case "$ACTIVE_VIBE_PROVIDER" in
      codex|claude) printf '%s\n' "$ACTIVE_VIBE_PROVIDER" ;;
      *) return 1 ;;
    esac
    return
  fi
  tribunal_llm_provider
}

tribunal_writer_mode() {
  printf '%s\n' "$ACTIVE_WRITER_MODE"
}

tribunal_claude_cmd() {
  [ "$CLAUDE_AVAILABLE" = true ] || return 1
  printf '%s\n' claude
}

tlog() {
  LOG_OUTPUT="${LOG_OUTPUT}${LOG_OUTPUT:+; }$*"
}

fail() {
  echo "x $*" >&2
  exit 1
}

pass() {
  echo "ok $*"
}

declare -F get_unscored_articles >/dev/null || fail "batch selector section was not loaded"

# run_case <global provider> <vibe provider> <CodexBar JSON, or "" for no injected reading>
run_case() {
  ACTIVE_GLOBAL_PROVIDER="$1"
  ACTIVE_VIBE_PROVIDER="$2"
  if [ -n "$3" ]; then
    TRIBUNAL_QUOTA_CODEXBAR_JSON="$3"
    export TRIBUNAL_QUOTA_CODEXBAR_JSON
  else
    unset TRIBUNAL_QUOTA_CODEXBAR_JSON
  fi
  LOG_OUTPUT=""

  set +e
  check_quota_above_floor
  CASE_RC=$?
  set -e
}

run_case codex codex "$(codex_json 20 30)"
[ "$CASE_RC" -eq 0 ] || fail "healthy CodexBar reading should pass without usage-monitor; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"5h=80%"*"weekly=70%"*"minimum=70%"*) ;; *) fail "quota log lacks the 5h/weekly minimum: $LOG_OUTPUT" ;; esac
pass "CodexBar reading gates on the stricter of the 5h and weekly windows, with no usage-monitor"

run_case codex codex "$(codex_json 85 30)"
[ "$CASE_RC" -eq 0 ] || fail "5h window above floor should pass; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"minimum=15%"*) ;; *) fail "5h window did not become the minimum: $LOG_OUTPUT" ;; esac
run_case codex codex "$(codex_json 90 30)"
[ "$CASE_RC" -eq 1 ] || fail "5h window at the floor must stop; rc=$CASE_RC log=$LOG_OUTPUT"
run_case codex codex "$(codex_json 10 95)"
[ "$CASE_RC" -eq 1 ] || fail "weekly window below the floor must stop; rc=$CASE_RC log=$LOG_OUTPUT"
pass "either window at or below QUOTA_FLOOR stops the batch"

run_case codex codex "$(codex_json null 40)"
[ "$CASE_RC" -eq 0 ] || fail "inactive 5h window should gate on weekly only; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"5h=-1%"*"minimum=60%"*) ;; *) fail "inactive 5h window leaked into the minimum: $LOG_OUTPUT" ;; esac
pass "an inactive 5h window is ignored, as in the daemon's controller"

run_case codex codex ""
[ "$CASE_RC" -eq 2 ] || fail "unavailable CodexBar must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"CodexBar"*) ;; *) fail "unavailable quota gave no CodexBar reason: $LOG_OUTPUT" ;; esac
run_case codex codex '{not-json'
[ "$CASE_RC" -eq 2 ] || fail "malformed CodexBar JSON must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
run_case codex codex '[{"provider":"claude","source":"cli","usage":{}}]'
[ "$CASE_RC" -eq 2 ] || fail "non-Codex CodexBar JSON must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "missing, malformed or wrong-provider CodexBar readings fail closed"

for bad_floor in invalid 101 -1 2.5 ""; do
  QUOTA_FLOOR="$bad_floor"
  run_case codex codex "$(codex_json 20 30)"
  [ "$CASE_RC" -eq 2 ] || fail "invalid QUOTA_FLOOR '$bad_floor' must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
done
QUOTA_FLOOR=10
pass "invalid QUOTA_FLOOR fails closed"

batch_floor_default=$(sed -n 's/^QUOTA_FLOOR="\${QUOTA_FLOOR:-\([0-9]*\)}".*/\1/p' "$BATCH_RUNNER")
daemon_floor_default=$(sed -n 's/^QUOTA_FLOOR="\${QUOTA_FLOOR:-\([0-9]*\)}".*/\1/p' "$QUOTA_LOOP")
[ -n "$batch_floor_default" ] && [ "$batch_floor_default" = "$daemon_floor_default" ] ||
  fail "batch floor must be QUOTA_FLOOR with the daemon's default (batch=$batch_floor_default daemon=$daemon_floor_default)"
pass "batch and daemon share the QUOTA_FLOOR variable and default"

run_case unknown codex "$(codex_json 20 30)"
[ "$CASE_RC" -eq 2 ] || fail "provider resolver failure must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "provider resolver failure fails closed"

GP_JUDGE_ALLOW_CLAUDE=1
ACTIVE_WRITER_MODE=claude
run_case codex codex "$(codex_json 20 30)"
[ "$CASE_RC" -eq 0 ] || fail "Claude writer/fallback must not demand Claude telemetry nobody provides; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"codex"*"claude"*"minimum=70%"*) ;; *) fail "mixed providers did not gate on the Codex reading: $LOG_OUTPUT" ;; esac
run_case codex codex ""
[ "$CASE_RC" -eq 2 ] || fail "a Codex judge still needs a CodexBar reading with Claude active; rc=$CASE_RC log=$LOG_OUTPUT"
pass "with Claude also active, the Codex reading still gates and still fails closed"
GP_JUDGE_ALLOW_CLAUDE=0

run_case claude claude ""
[ "$CASE_RC" -eq 0 ] || fail "Claude-only run has no quota probe and relies on pause/suspension stops; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"no Codex judge"*) ;; *) fail "Claude-only run did not say why it skipped the probe: $LOG_OUTPUT" ;; esac
pass "Claude-only run skips the Codex probe, like the daemon"

for retired_mode in subagent cli codex grok; do
  ACTIVE_WRITER_MODE="$retired_mode"
  run_case codex codex "$(codex_json 20 30)"
  [ "$CASE_RC" -eq 2 ] || fail "retired $retired_mode writer mode must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
done
pass "retired subagent/cli/Codex/Grok writer modes fail closed"

ACTIVE_WRITER_MODE=unknown
run_case codex codex "$(codex_json 20 30)"
[ "$CASE_RC" -eq 2 ] || fail "unknown writer mode must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "unknown writer mode fails closed"
ACTIVE_WRITER_MODE=none
unset TRIBUNAL_QUOTA_CODEXBAR_JSON

# The bounded batch stops, with a reason, on a quota suspension or anything a
# person must fix, and never starts an article during a Claude writer pause.
stop_progress="$tmp_dir/stop-progress.json"
jq -n '{
  "suspended.mdx": {status: "QUOTA_SUSPENDED", failedStage: "vibe",
    stages: {vibe: {status: "quota_suspended",
      error: "writer: provider=claude tier=unknown reason=Claude reported a temporary error"}}},
  "locked.mdx": {status: "PENDING"}
}' > "$stop_progress"
stop_rc=0
stop_note="$(PROGRESS_FILE="$stop_progress" tribunal_batch_stop_reason 75 suspended.mdx)" || stop_rc=$?
[ "$stop_rc" -eq 75 ] || fail "a quota-suspended article must stop the batch with rc 75, got $stop_rc"
case "$stop_note" in
  *"Claude reported a temporary error"*) ;;
  *) fail "batch stop reason lost the suspension reason: $stop_note" ;;
esac
PROGRESS_FILE="$stop_progress" tribunal_batch_stop_reason 75 locked.mdx >/dev/null ||
  fail "a per-article lock collision must not stop the batch"
stop_rc=0
stop_note="$(PROGRESS_FILE="$stop_progress" tribunal_batch_stop_reason 78 locked.mdx)" || stop_rc=$?
[ "$stop_rc" -eq 78 ] || fail "an operator-action exit must stop the batch with rc 78, got $stop_rc"
case "$stop_note" in
  *"claude auth login"*) ;;
  *) fail "operator-action stop gave no actionable reason: $stop_note" ;;
esac
# suspended.mdx keeps a stale QUOTA_SUSPENDED ledger entry: only rc 75 may read
# it, so a later rc 0/1/2 on that article (e.g. a taken-down post) must not stop.
for rc in 0 1 2; do
  PROGRESS_FILE="$stop_progress" tribunal_batch_stop_reason "$rc" suspended.mdx >/dev/null ||
    fail "article result rc=$rc must not stop the batch, even with a stale QUOTA_SUSPENDED entry"
done
export TRIBUNAL_MAIN_REPO="$tmp_dir/main"
if tribunal_batch_claude_pause >/dev/null; then
  fail "the batch saw a Claude writer pause that does not exist"
fi
tribunal_claude_pause_write 600 "Claude reported the reset: fixture"
pause_note="$(tribunal_batch_claude_pause)" ||
  fail "the batch ignored an active Claude writer pause"
case "$pause_note" in
  *"Claude reported the reset: fixture"*) ;;
  *) fail "Claude writer pause note lost its reason: $pause_note" ;;
esac
unset TRIBUNAL_MAIN_REPO
main_section="$(sed -n '/^# ─── Main/,$p' "$BATCH_RUNNER")"
pause_line="$(grep -n 'tribunal_batch_claude_pause' <<<"$main_section" | head -1 | cut -d: -f1)"
run_line="$(grep -n 'bash "$SCRIPT_DIR/tribunal.sh"' <<<"$main_section" | head -1 | cut -d: -f1)"
stop_line="$(grep -n 'tribunal_batch_stop_reason "$rc"' <<<"$main_section" | head -1 | cut -d: -f1)"
if [ -z "$pause_line" ] || [ -z "$run_line" ] || [ -z "$stop_line" ] ||
   [ "$pause_line" -ge "$run_line" ] || [ "$stop_line" -le "$run_line" ]; then
  fail "batch main loop must check the Claude pause before and the stop reason after each article"
fi
grep -q '^exit "$STOP_RC"$' "$BATCH_RUNNER" ||
  fail "batch runner must exit with the stop code after its summary"
pass "batch stops with a reason on quota suspensions, Claude pauses and operator-action exits"

selector_posts="$tmp_dir/posts"
selector_progress="$tmp_dir/progress.json"
mkdir -p "$selector_posts"

write_selector_post() {
  local file="$1"
  local translated_date="$2"
  local status="${3:-}"
  {
    printf '%s\n' '---'
    printf 'title: %s\n' "$file"
    printf 'translatedDate: %s\n' "$translated_date"
    [ -n "$status" ] && printf 'status: %s\n' "$status"
    printf '%s\n' '---' 'body'
  } > "$selector_posts/$file"
}

write_selector_post pending.mdx 2026-01-08
write_selector_post legacy-exhausted.mdx 2026-01-07
write_selector_post current-exhausted.mdx 2026-01-06
write_selector_post current-pass.mdx 2026-01-05
write_selector_post deprecated-unquoted.mdx 2026-01-04 deprecated
write_selector_post deprecated-single-quoted.mdx 2026-01-03 "'deprecated'"
write_selector_post deprecated-double-quoted.mdx 2026-01-02 '"deprecated"'
write_selector_post taken-down-unquoted.mdx 2026-01-09 taken-down
write_selector_post taken-down-double-quoted.mdx 2026-01-10 '"taken-down"'

cat > "$selector_progress" <<'JSON'
{
  "legacy-exhausted.mdx": {
    "tribunalVersion": 8,
    "status": "EXHAUSTED"
  },
  "current-exhausted.mdx": {
    "tribunalVersion": 9,
    "status": "EXHAUSTED"
  },
  "current-pass.mdx": {
    "tribunalVersion": 9,
    "status": "PASS"
  }
}
JSON

POSTS_DIR="$selector_posts"
PROGRESS_FILE="$selector_progress"
ROOT_DIR="$tmp_dir"
TRIBUNAL_VERSION=9

selector_output=$(get_unscored_articles)
expected_selector_output=$(printf '%s\n' pending.mdx legacy-exhausted.mdx)
[ "$selector_output" = "$expected_selector_output" ] ||
  fail "selector included deprecated/taken-down/current terminal entries: $selector_output"
pass "selector excludes deprecated, taken-down and current-version terminal entries"

# The quota loop keeps its own copy of the selector; it must agree with the
# batch runner, including the taken-down exclusion (openspec: post-takedown).
quota_loop_selector_section=$(awk '
  /^# ─── Build Unscored/ { capture=1 }
  capture && /^# ─── Dry Run/ { exit }
  capture { print }
' "$QUOTA_LOOP")
eval "$quota_loop_selector_section"
quota_loop_output=$(get_unscored_articles)
[ "$quota_loop_output" = "$expected_selector_output" ] ||
  fail "quota-loop selector disagrees with the batch runner: $quota_loop_output"
pass "quota-loop selector also excludes taken-down posts"
