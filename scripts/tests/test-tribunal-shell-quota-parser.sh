#!/usr/bin/env bash
# Regression tests for the shell quota-error probe. Uses a fake CodexBar only:
# no Codex/Claude CLI calls and no tribunal pipeline execution.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-shell-quota.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

sample='[
  {
    "provider": "codex",
    "source": "cli",
    "usage": {
      "primary": {
        "usedPercent": 30,
        "windowMinutes": 300,
        "resetsAt": "2026-07-28T00:12:00Z"
      },
      "secondary": {
        "usedPercent": 36,
        "windowMinutes": 10080,
        "resetsAt": "2026-08-01T11:00:00Z"
      }
    }
  }
]'

cat > "$TMP/bin/codexbar" <<'CODEXBAR'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CODEXBAR_ARGV"
printf '%s\n' "$CODEXBAR_FIXTURE"
CODEXBAR
chmod +x "$TMP/bin/codexbar"

CODEXBAR_ARGV="$TMP/codexbar.argv" \
CODEXBAR_FIXTURE="$sample" \
PATH="$TMP/bin:$PATH" \
  tribunal_quota_codexbar_json > "$TMP/codexbar.json"

cat > "$TMP/expected.argv" <<'ARGV'
usage
--provider
codex
--source
cli
--format
json
--pretty
ARGV
cmp -s "$TMP/expected.argv" "$TMP/codexbar.argv" ||
  fail "quota probe argv drifted from the provider-specific Codex JSON command"
pass "quota errors invoke only the exact Codex provider/source JSON argv"

now_epoch="$(
  python3 - <<'PY'
import datetime
print(int(datetime.datetime(2026, 7, 28, tzinfo=datetime.timezone.utc).timestamp()))
PY
)"
parsed="$(TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" tribunal_quota_parse_json "$sample")"
IFS='|' read -r session_left session_reset weekly_left weekly_reset <<< "$parsed"

[ "$session_left" = "70" ] || fail "session percent should be 70, got $session_left"
[ "$session_reset" = "720" ] || fail "session reset should be 720s (12m), got $session_reset"
[ "$weekly_left" = "64" ] || fail "weekly percent should be 64, got $weekly_left"
[ "$weekly_reset" = "385200" ] || fail "weekly reset should be 385200s (4d11h), got $weekly_reset"
pass "CodexBar JSON parser reads primary/secondary usage and ISO reset times"

live_primary_null="$(
  printf '%s\n' "$sample" |
    jq '
      .[0].source = "codex-cli"
      | .[0].usage.primary = null
      | .[0].usage.secondary.usedPercent = 63
    '
)"
parsed="$(
  TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
    tribunal_quota_parse_json "$live_primary_null"
)"
IFS='|' read -r session_left session_reset weekly_left weekly_reset <<< "$parsed"
[ "$session_left" = "-1" ] ||
  fail "unavailable session percent should use sentinel -1, got $session_left"
[ "$session_reset" = "-1" ] ||
  fail "inactive session window should use reset sentinel -1, got $session_reset"
[ "$weekly_left" = "37" ] ||
  fail "live weekly percent should be 37, got $weekly_left"
[ "$weekly_reset" = "385200" ] ||
  fail "live weekly reset should remain 385200s, got $weekly_reset"
pass "CodexBar parser accepts live codex-cli source with an inactive primary window"

decision="$(
  TRIBUNAL_QUOTA_CODEXBAR_JSON="$live_primary_null" \
  TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
    tribunal_quota_decision codex 0
)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
[ "$action" = "suspend" ] ||
  fail "unavailable primary quota should suspend after a model quota error"
[ "$tier" = "unknown" ] ||
  fail "unavailable primary quota must not be mislabeled as session exhaustion"
[ "$reset_seconds" = "0" ] ||
  fail "unavailable primary quota must not infer a reset"
case "$reason" in
  *"primary quota window unavailable"*) ;;
  *) fail "unavailable primary quota reason is not actionable: $reason" ;;
esac
pass "model quota errors fail closed when the primary window is unavailable"

stale_reset="$(
  printf '%s\n' "$sample" |
    jq --argjson now "$now_epoch" \
      '.[0].usage.primary.resetsAt = $now'
)"
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$stale_reset" >/dev/null 2>&1; then
  fail "Codex quota parser accepted an expired primary reset"
fi
past_reset="$(
  printf '%s\n' "$sample" |
    jq --argjson past "$((now_epoch - 1))" \
      '.[0].usage.secondary.resetsAt = $past'
)"
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$past_reset" >/dev/null 2>&1; then
  fail "Codex quota parser accepted an expired secondary reset"
fi
wrong_source="$(printf '%s\n' "$sample" | jq '.[0].source = "web"')"
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$wrong_source" >/dev/null 2>&1; then
  fail "Codex quota parser accepted a non-CLI source"
fi
for spoofed_source in my-codex-cli claude-cli; do
  spoofed_payload="$(
    printf '%s\n' "$sample" |
      jq --arg source "$spoofed_source" '.[0].source = $source'
  )"
  if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
    tribunal_quota_parse_json "$spoofed_payload" >/dev/null 2>&1; then
    fail "Codex quota parser accepted spoofed source $spoofed_source"
  fi
done
wrong_window="$(
  printf '%s\n' "$sample" |
    jq '.[0].usage.primary.windowMinutes = 60'
)"
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$wrong_window" >/dev/null 2>&1; then
  fail "Codex quota parser accepted drifted window metadata"
fi
invalid_primary="$(
  printf '%s\n' "$live_primary_null" |
    jq '.[0].usage.primary = false'
)"
missing_primary="$(
  printf '%s\n' "$live_primary_null" |
    jq 'del(.[0].usage.primary)'
)"
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$invalid_primary" >/dev/null 2>&1; then
  fail "Codex quota parser accepted a non-null malformed primary window"
fi
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$missing_primary" >/dev/null 2>&1; then
  fail "Codex quota parser treated a missing primary key as an explicit null window"
fi
pass "quota JSON parser rejects expired resets and source/window schema drift"

claude_only='[{"provider":"claude","source":"cli","usage":{"primary":{"usedPercent":100,"resetsAt":"2026-07-28T00:12:00Z"},"secondary":{"usedPercent":10,"resetsAt":"2026-08-01T11:00:00Z"}}}]'
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$claude_only" >/dev/null 2>&1; then
  fail "Codex quota parser accepted a Claude-only payload"
fi
combined="$(
  printf '%s\n' "$sample" |
    jq '. + [{"provider":"claude","source":"cli","usage":{}}]'
)"
if TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  tribunal_quota_parse_json "$combined" >/dev/null 2>&1; then
  fail "Codex quota parser accepted a combined-provider payload"
fi
pass "quota JSON parsing rejects Claude-only/combined-provider substitution"

session_exhausted="$(
  printf '%s\n' "$sample" |
    jq '.[0].usage.primary.usedPercent = 100'
)"
decision="$(
  TRIBUNAL_QUOTA_CODEXBAR_JSON="$session_exhausted" \
  TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  GP_QUOTA_MAX_WAIT=6h \
    tribunal_quota_decision codex 0
)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
[ "$action" = "wait" ] || fail "decision action should be wait, got $action ($decision)"
[ "$tier" = "session" ] || fail "decision tier should be session, got $tier ($decision)"
[ "$reset_seconds" = "720" ] || fail "decision reset should be 720s, got $reset_seconds ($decision)"
case "$reason" in
  *"12m"*) ;;
  *) fail "decision reason should mention 12m, got: $reason" ;;
esac
pass "short session quota decision sleeps until reset"

decision="$(
  TRIBUNAL_QUOTA_CODEXBAR_JSON="$sample" \
  TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
    tribunal_quota_decision codex 0
)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
[ "$action" = "suspend" ] ||
  fail "conflicting nonzero quota telemetry should suspend"
[ "$tier" = "unknown" ] ||
  fail "conflicting nonzero quota telemetry must not invent an exhausted tier"
[ "$reset_seconds" = "0" ] ||
  fail "conflicting nonzero quota telemetry must not invent a reset"
case "$reason" in
  *"validated quota windows remain nonzero"*) ;;
  *) fail "conflicting quota reason is not actionable: $reason" ;;
esac
pass "model quota errors do not override validated nonzero windows"

weekly_exhausted="$(printf '%s\n' "$sample" | jq '.[0].usage.secondary.usedPercent = 100')"
decision="$(
  TRIBUNAL_QUOTA_CODEXBAR_JSON="$weekly_exhausted" \
  TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
  GP_QUOTA_MAX_WAIT=6h \
    tribunal_quota_decision codex 0
)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
[ "$action" = "suspend" ] || fail "weekly exhausted action should suspend, got $action ($decision)"
[ "$tier" = "weekly" ] || fail "weekly exhausted tier should be weekly, got $tier ($decision)"
[ "$reset_seconds" = "385200" ] || fail "weekly exhausted reset should be 385200s, got $reset_seconds ($decision)"
case "$reason" in
  *"4d 11h"*) ;;
  *) fail "weekly exhausted reason should mention 4d 11h, got: $reason" ;;
esac
pass "weekly quota exhaustion suspends with real reset metadata"

rm -f "$TMP/codexbar.argv"
decision="$(CODEXBAR_ARGV="$TMP/codexbar.argv" CODEXBAR_FIXTURE="$sample" \
  PATH="$TMP/bin:$PATH" tribunal_quota_decision claude 0)"
IFS='|' read -r action tier reset_seconds reason <<< "$decision"
if [ "$action" != "suspend" ] || [ "$tier" != "unknown" ]; then
  fail "legacy Claude compatibility quota should fail closed without a probe"
fi
[ ! -e "$TMP/codexbar.argv" ] ||
  fail "legacy Claude compatibility path invoked CodexBar"
pass "legacy Claude compatibility quota path never probes Claude or combined usage"

# The Claude CLI's real messages (shared with gp-pipeline's classifier) split
# into quota and login, and a quota wait comes only from Claude's own reset.
CLAUDE_SAMPLES="$ROOT_DIR/tools/gp-pipeline/internal/llm/testdata/claude-cli-errors.json"
sample_file="$TMP/claude-sample.txt"
for class in quota login other; do
  while IFS= read -r message; do
    printf '%s\n' "$message" > "$sample_file"
    got="$(tribunal_claude_failure_class "$sample_file" || true)"
    want="$class"
    [ "$class" != other ] || want=""
    [ "$got" = "$want" ] ||
      fail "Claude message classified as '$got', want '$want': $message"
  done < <(jq -r --arg class "$class" '.[$class][]' "$CLAUDE_SAMPLES")
done
while IFS= read -r row; do
  message="$(jq -r '.message' <<<"$row")"
  now_epoch="$(jq -r '.now | fromdateiso8601' <<<"$row")"
  want="$(jq -r 'if .reset == "" then "none" else ((.reset | fromdateiso8601) - (.now | fromdateiso8601)) end' <<<"$row")"
  printf '%s\n' "$message" > "$sample_file"
  got="$(TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" tribunal_claude_reset_seconds "$sample_file" || printf 'none')"
  [ "$got" = "$want" ] ||
    fail "Claude reset for '$message' at $(jq -r '.now' <<<"$row") = $got, want $want"
done < <(jq -c '.resets[]' "$CLAUDE_SAMPLES")
pass "real Claude CLI quota and login messages classify like gp-pipeline, with Claude's own reset time"

run_claude_writer_failure() {
  local message="$1" status_file="$2" output="$3"
  (
    tribunal_writer_mode() { printf 'claude\n'; }
    tribunal_claude_agent_model() { printf 'claude-writer-fixture\n'; }
    tribunal_writer_exec_raw() {
      printf '%s\n' "$CLAUDE_FIXTURE_MESSAGE"
      return 1
    }
    CLAUDE_FIXTURE_MESSAGE="$message" \
    CODEXBAR_ARGV="$TMP/codexbar.argv" CODEXBAR_FIXTURE="$sample" \
    PATH="$TMP/bin:$PATH" \
    TRIBUNAL_MAIN_REPO="$TMP/main" \
    TRIBUNAL_QUOTA_NOW_EPOCH="$(jq -rn '"2026-09-26T12:00:00Z" | fromdateiso8601')" \
    TRIBUNAL_QUOTA_STATUS_FILE="$status_file" \
      tribunal_writer_exec "$TMP" tribunal-writer 'writer fixture' >"$output" 2>&1
  )
}

pause_file="$TMP/main/.score-loop/state/claude-writer-pause.json"
rm -f "$TMP/codexbar.argv" "$pause_file"
set +e
run_claude_writer_failure "You've hit your session limit · resets 5pm (UTC)" \
  "$TMP/writer-quota-status" "$TMP/writer-quota.out"
writer_rc=$?
set -e
[ "$writer_rc" -eq 75 ] ||
  fail "Claude-model writer quota error should suspend with rc75, got $writer_rc"
grep -Fxq 'provider=claude' "$TMP/writer-quota-status" ||
  fail "Claude-model writer quota status did not record provider=claude"
grep -Fxq 'action=suspend' "$TMP/writer-quota-status" ||
  fail "Claude-model writer quota status did not record suspend"
grep -Fxq 'tier=unknown' "$TMP/writer-quota-status" ||
  fail "Claude-model writer quota must not infer a tier"
grep -Fxq 'reset_seconds=18120' "$TMP/writer-quota-status" ||
  fail "Claude-model writer quota must wait for Claude's own reset plus the buffer"
[ ! -e "$TMP/codexbar.argv" ] ||
  fail "Claude-model writer quota error probed CodexBar"
pause_left="$(TRIBUNAL_MAIN_REPO="$TMP/main" tribunal_claude_pause_remaining)" ||
  fail "Claude-model writer quota did not pause daemon dispatch"
[ "$pause_left" -gt 18000 ] && [ "$pause_left" -le 18120 ] ||
  fail "Claude quota pause lasts ${pause_left}s, want the reported reset plus buffer"
jq '.until = 1' "$pause_file" > "$pause_file.tmp" && mv "$pause_file.tmp" "$pause_file"
if TRIBUNAL_MAIN_REPO="$TMP/main" tribunal_claude_pause_remaining >/dev/null; then
  fail "an expired Claude quota pause still holds dispatch"
fi
[ ! -e "$pause_file" ] || fail "an expired Claude quota pause was not cleared"
pass "Claude-model writer quota errors suspend as unknown, wait for Claude's reset and pause dispatch without CodexBar"

set +e
run_claude_writer_failure "Your org is out of usage · contact your admin" \
  "$TMP/writer-default-status" "$TMP/writer-default.out"
writer_rc=$?
set -e
[ "$writer_rc" -eq 75 ] ||
  fail "Claude quota without a reset should still suspend, got $writer_rc"
grep -Fxq 'reset_seconds=3720' "$TMP/writer-default-status" ||
  fail "Claude quota without a reset must use the conservative default wait"
pass "Claude quota without a reported reset uses the conservative default wait"

rm -f "$pause_file" "$TMP/writer-login-status"
set +e
run_claude_writer_failure "Not logged in · Please run /login" \
  "$TMP/writer-login-status" "$TMP/writer-login.out"
writer_rc=$?
set -e
[ "$writer_rc" -eq 78 ] ||
  fail "Claude login failure should stop the writer with rc78, got $writer_rc"
grep -q 'claude auth login' "$TMP/writer-login.out" ||
  fail "Claude login failure did not tell the operator to run claude auth login"
[ ! -s "$TMP/writer-login-status" ] ||
  fail "Claude login failure was recorded as a quota suspension"
[ ! -e "$pause_file" ] || fail "Claude login failure wrote a quota pause"
pass "Claude login failures stop the writer with an actionable error, separate from quota"
