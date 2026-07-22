#!/usr/bin/env bash
# Focused/no-token regression tests for the batch runner's provider-aware quota gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BATCH_RUNNER="$ROOT_DIR/scripts/tribunal-batch-runner.sh"
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

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
fake_monitor="$tmp_dir/usage-monitor.sh"
cat > "$fake_monitor" <<'MONITOR'
#!/usr/bin/env bash
if [ "${FAKE_USAGE_RC:-0}" -ne 0 ]; then
  exit "$FAKE_USAGE_RC"
fi
printf '%s\n' "${FAKE_USAGE_JSON:-[]}"
MONITOR
chmod +x "$fake_monitor"

USAGE_MONITOR="$fake_monitor"
QUOTA_FLOOR_PCT=3
export USAGE_MONITOR QUOTA_FLOOR_PCT
ACTIVE_GLOBAL_PROVIDER=codex
ACTIVE_VIBE_PROVIDER=codex
ACTIVE_WRITER_MODE=none
ACTIVE_WRITER_PROVIDER=claude
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

tribunal_writer_provider() {
  case "$ACTIVE_WRITER_PROVIDER" in
    codex|claude) printf '%s\n' "$ACTIVE_WRITER_PROVIDER" ;;
    *) return 1 ;;
  esac
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

run_case() {
  local global_provider="$1"
  local vibe_provider="$2"
  local json="$3"
  local monitor_rc="${4:-0}"

  ACTIVE_GLOBAL_PROVIDER="$global_provider"
  ACTIVE_VIBE_PROVIDER="$vibe_provider"
  FAKE_USAGE_JSON="$json"
  FAKE_USAGE_RC="$monitor_rc"
  export FAKE_USAGE_JSON FAKE_USAGE_RC
  LOG_OUTPUT=""

  set +e
  check_quota_above_floor
  CASE_RC=$?
  set -e
}

run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 0 ] || fail "codex-only quota should pass; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"codex"*"minimum=70"*) ;; *) fail "codex-only log lacks provider/minimum: $LOG_OUTPUT" ;; esac
pass "codex-only requires OpenAI short and weekly buckets"

run_case codex codex '[{"provider":"codex","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 0 ] || fail "legacy Codex provider alias should pass; rc=$CASE_RC log=$LOG_OUTPUT"
pass "Codex telemetry alias remains supported"

run_case claude claude '[{"provider":"claude","status":"ok","five_hr_remaining_pct":65,"weekly_remaining_pct":60}]'
[ "$CASE_RC" -eq 0 ] || fail "claude-only quota should pass; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"claude"*"minimum=60"*) ;; *) fail "claude-only log lacks provider/minimum: $LOG_OUTPUT" ;; esac
pass "claude-only requires Claude short and weekly buckets"

run_case codex claude '[{"provider":"openai","status":"ok","session_remaining_pct":75,"weekly_remaining_pct":70},{"provider":"claude","status":"ok","five_hr_remaining_pct":40,"weekly_remaining_pct":35}]'
[ "$CASE_RC" -eq 0 ] || fail "mixed quota should pass above floor; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"codex"*"claude"*"minimum=35"*) ;; *) fail "mixed quota did not select the strict minimum: $LOG_OUTPUT" ;; esac
pass "mixed providers gate on the strictest active bucket"

run_case codex claude '[{"provider":"openai","status":"ok","session_remaining_pct":75,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "missing active Claude entry must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "missing active provider fails closed"

run_case codex codex '[{"provider":"openai","status":"ok","weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "missing active short bucket must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "missing active provider bucket fails closed"

run_case codex codex '[{"provider":"openai","status":"error","session_remaining_pct":90,"weekly_remaining_pct":90}]'
[ "$CASE_RC" -eq 2 ] || fail "active provider error status must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "active provider error status fails closed"

run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":1,"weekly_remaining_pct":1},{"provider":"openai","status":"ok","session_remaining_pct":90,"weekly_remaining_pct":90}]'
[ "$CASE_RC" -eq 2 ] || fail "duplicate active provider telemetry must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "duplicate active provider telemetry fails closed"

run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70},{"provider":"claude","status":"error"}]'
[ "$CASE_RC" -eq 0 ] || fail "inactive provider error must not block an active healthy provider; rc=$CASE_RC log=$LOG_OUTPUT"
pass "inactive provider errors are ignored"

run_case codex claude '[{"provider":"openai","status":"ok","session_remaining_pct":90,"weekly_remaining_pct":90},{"provider":"claude","status":"ok","five_hr_remaining_pct":3,"weekly_remaining_pct":80}]'
[ "$CASE_RC" -eq 1 ] || fail "one provider at floor must stop all work; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"minimum=3"*) ;; *) fail "low-provider log lacks strict minimum: $LOG_OUTPUT" ;; esac
pass "one low active provider stops the mixed run"

run_case codex codex '[]' 9
[ "$CASE_RC" -eq 2 ] || fail "usage-monitor failure must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "usage-monitor failure fails closed"

run_case codex codex '{not-json'
[ "$CASE_RC" -eq 2 ] || fail "malformed telemetry must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "malformed telemetry fails closed"

QUOTA_FLOOR_PCT=invalid
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "invalid quota floor must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "invalid quota floor fails closed"
QUOTA_FLOOR_PCT=3

run_case unknown codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "provider resolver failure must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "provider resolver failure fails closed"

GP_JUDGE_ALLOW_CLAUDE=1
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "enabled Claude judge fallback must require Claude telemetry; rc=$CASE_RC log=$LOG_OUTPUT"
pass "enabled Claude judge fallback joins active providers"
GP_JUDGE_ALLOW_CLAUDE=0

ACTIVE_WRITER_MODE=cli
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "CLI writer must require Claude telemetry; rc=$CASE_RC log=$LOG_OUTPUT"
pass "CLI writer provider joins active providers"

ACTIVE_WRITER_MODE=codex
run_case claude claude '[{"provider":"claude","status":"ok","five_hr_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "Codex writer must require OpenAI telemetry; rc=$CASE_RC log=$LOG_OUTPUT"
pass "Codex writer provider joins active providers"

ACTIVE_WRITER_MODE=subagent
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 0 ] || fail "external writer broker must not invent an in-process provider; rc=$CASE_RC log=$LOG_OUTPUT"
pass "external writer broker does not invent a provider"

ACTIVE_WRITER_MODE=unknown
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "unknown writer mode must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "unknown writer mode fails closed"
