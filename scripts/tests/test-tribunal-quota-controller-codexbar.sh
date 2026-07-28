#!/usr/bin/env bash
# Behavioral regression for the deployed closed-loop quota controller.
# All Codex/CodexBar calls are local fakes; the combined monitor is a poison
# marker so any compatibility-path regression is observable.

set -euo pipefail

if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "SKIP: Tribunal quota loop requires Bash 4+."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-codexbar-controller.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
FIXTURE_ROOT="$TMP/root"
mkdir -p "$FIXTURE_ROOT/scripts" "$FIXTURE_ROOT/.codex/agents" \
  "$FIXTURE_ROOT/src/content/posts" "$TMP/bin"
cp \
  "$ROOT_DIR/scripts/tribunal-helpers.sh" \
  "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" \
  "$ROOT_DIR/scripts/tribunal-quota-loop.sh" \
  "$ROOT_DIR/scripts/tribunal-runtime.slice" \
  "$ROOT_DIR/scripts/tribunal-run-control.sh" \
  "$ROOT_DIR/scripts/tribunal-version.mjs" \
  "$FIXTURE_ROOT/scripts/"
printf 'model = "gpt-controller-fixture"\n' \
  > "$FIXTURE_ROOT/.codex/agents/tribunal-writer.toml"
for role in vibe-opus-scorer fact-checker librarian fresh-eyes; do
  printf 'model = "gpt-%s-controller-fixture"\n' "$role" \
    > "$FIXTURE_ROOT/.codex/agents/$role.toml"
done

cat > "$TMP/bin/codex" <<'CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  exit 0
fi
prompt="${!#}"
canary_path="$(printf '%s\n' "$prompt" | sed -n 's/^Canary path: //p')"
canary_token="$(printf '%s\n' "$prompt" | sed -n 's/^Canary token: //p')"
[ -n "$canary_path" ] && [ -n "$canary_token" ] || exit 2
printf '%s\n' "$canary_token" > "$canary_path"
printf 'OK\n'
CODEX
chmod +x "$TMP/bin/codex"

cat > "$TMP/bin/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
case "$*" in
  "--user show tribunal-runtime.slice -p LoadState --value") printf 'loaded\n' ;;
  "--user show tribunal-runtime.slice -p ActiveState --value") printf 'active\n' ;;
  "--user show tribunal-runtime.slice -p MemoryMax --value") printf '4294967296\n' ;;
  "--user show tribunal-runtime.slice -p CPUQuotaPerSecUSec --value") printf '2s\n' ;;
  "--user show tribunal-runtime.slice -p TasksMax --value") printf '1024\n' ;;
  "--user show tribunal-runtime.slice -p FragmentPath --value")
    printf '%s\n' "$FAKE_SYSTEMD_FRAGMENT_PATH" ;;
  "--user show tribunal-runtime.slice -p NeedDaemonReload --value") printf 'no\n' ;;
  "--user show tribunal-runtime.slice -p DropInPaths --value") printf '\n' ;;
  "--user show tribunal-loop.service -p Slice --value") printf 'tribunal-runtime.slice\n' ;;
  *) exit 1 ;;
esac
SYSTEMCTL
cat > "$TMP/bin/systemd-run" <<'SYSTEMD_RUN'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--" ]; then
    shift
    break
  fi
  shift
done
[ "$#" -gt 0 ] || exit 64
exec "$@"
SYSTEMD_RUN
chmod +x "$TMP/bin/systemctl" "$TMP/bin/systemd-run"
cp "$ROOT_DIR/scripts/tribunal-runtime.slice" \
  "$TMP/installed-tribunal-runtime.slice"

cat > "$TMP/bin/usage-monitor.sh" <<'MONITOR'
#!/usr/bin/env bash
: > "$COMBINED_MONITOR_CALLED"
exit 97
MONITOR
chmod +x "$TMP/bin/usage-monitor.sh"

cat > "$TMP/bin/claude" <<'CLAUDE'
#!/usr/bin/env bash
: > "$CLAUDE_CALLED"
exit 96
CLAUDE
chmod +x "$TMP/bin/claude"

cat > "$TMP/bin/codexbar" <<'CODEXBAR'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CODEXBAR_ARGV"
case "${CODEXBAR_BEHAVIOR:-fixture}" in
  fixture) printf '%s\n' "$CODEXBAR_FIXTURE" ;;
  fail) exit 42 ;;
  timeout) sleep 5 ;;
  *) exit 43 ;;
esac
CODEXBAR
chmod +x "$TMP/bin/codexbar"

now_epoch="$(
  python3 - <<'PY'
import datetime
print(int(datetime.datetime(2026, 7, 28, tzinfo=datetime.timezone.utc).timestamp()))
PY
)"
sample='[
  {
    "provider": "codex",
    "source": "cli",
    "usage": {
      "primary": {
        "usedPercent": 0,
        "windowMinutes": 300,
        "resetsAt": "2026-07-28T05:00:00Z"
      },
      "secondary": {
        "usedPercent": 0,
        "windowMinutes": 10080,
        "resetsAt": "2026-08-04T00:00:00Z"
      }
    }
  }
]'

run_controller() {
  local behavior="${1:-fixture}"
  shift || true
  local output
  output="$(
    env \
      PATH="$TMP/bin:$PATH" \
      COMBINED_MONITOR_CALLED="$TMP/combined-monitor.called" \
      CLAUDE_CALLED="$TMP/claude.called" \
      CODEXBAR_ARGV="$TMP/codexbar.argv" \
      CODEXBAR_BEHAVIOR="$behavior" \
      CODEXBAR_FIXTURE="$sample" \
      FAKE_SYSTEMD_FRAGMENT_PATH="$TMP/installed-tribunal-runtime.slice" \
      USAGE_MONITOR="$TMP/bin/usage-monitor.sh" \
      TRIBUNAL_DEPLOYED_MODE=1 \
      TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
      GP_WRITER_MODE=codex \
      TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC=2 \
      TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
      GP_CODEXBAR_TIMEOUT_SECONDS=1 \
      QUOTA_FLOOR=10 \
      QUOTA_BURST_ALLOWANCE=2 \
      MIN_COOLDOWN=10 \
      MAX_COOLDOWN=1800 \
      "$@" \
      bash "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh" \
        --workers 2 --controller-once 0
  )"
  printf '%s\n' "$output" | tail -1
}

rm -f "$TMP/codexbar.argv" "$TMP/combined-monitor.called"
out="$(run_controller fixture)"
[ "$out" = "10|2|none|pacing" ] ||
  fail "valid Codex JSON should pace configured workers, got: $out"
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
  fail "deployed controller argv drifted from provider-specific Codex JSON command"
[ ! -e "$TMP/combined-monitor.called" ] ||
  fail "deployed controller invoked the combined usage monitor"
[ ! -e "$TMP/claude.called" ] ||
  fail "deployed controller invoked the Claude binary"
pass "deployed controller invokes only the exact provider-specific CodexBar command"

rm -f "$TMP/codexbar.argv" "$TMP/combined-monitor.called"
out="$(run_controller fixture TRIBUNAL_QUOTA_CODEXBAR_JSON="$sample")"
[ "$out" = "10|2|none|pacing" ] ||
  fail "deterministic injected Codex JSON should pace workers, got: $out"
[ ! -e "$TMP/codexbar.argv" ] ||
  fail "fixture injection unexpectedly invoked CodexBar"
[ ! -e "$TMP/combined-monitor.called" ] ||
  fail "fixture injection unexpectedly invoked the combined monitor"
pass "deterministic JSON injection bypasses every external quota command"

live_primary_null="$(
  printf '%s\n' "$sample" |
    jq '
      .[0].source = "codex-cli"
      | .[0].usage.primary = null
    '
)"
out="$(
  run_controller fixture \
    TRIBUNAL_QUOTA_CODEXBAR_JSON="$live_primary_null"
)"
[ "$out" = "10|2|none|pacing" ] ||
  fail "live inactive-primary Codex JSON should pace from weekly quota, got: $out"
pass "deployed controller treats a live null primary window as inactive"

weekly_floor="$(
  printf '%s\n' "$live_primary_null" |
    jq '.[0].usage.secondary.usedPercent = 91'
)"
out="$(
  run_controller fixture \
    TRIBUNAL_QUOTA_CODEXBAR_JSON="$weekly_floor"
)"
case "$out" in
  *"|0|seven_day|floor_stop") ;;
  *) fail "inactive primary must preserve the weekly floor, got: $out" ;;
esac

weekly_debt="$(
  printf '%s\n' "$live_primary_null" |
    jq '.[0].usage.secondary.usedPercent = 25'
)"
out="$(
  run_controller fixture \
    TRIBUNAL_QUOTA_CODEXBAR_JSON="$weekly_debt"
)"
case "$out" in
  *"|0|seven_day|weekly_debt") ;;
  *) fail "inactive primary must preserve weekly burn debt, got: $out" ;;
esac
pass "inactive primary never bypasses weekly floor or burn-rate controls"

mkdir -p "$FIXTURE_ROOT/.score-loop/state"
: > "$FIXTURE_ROOT/.score-loop/state/quota-history.jsonl"
for _ in 1 2 3 4 5; do
  printf '%s\n' \
    '{"event":"dispatch","five_hr_pct":50,"five_hr_resets_sec":3600,"seven_day_pct":60,"seven_day_resets_sec":500000,"recommended_workers":1}' \
    '{"event":"complete","five_hr_pct":-1,"five_hr_resets_sec":-1,"seven_day_pct":59,"seven_day_resets_sec":499000,"recommended_workers":1}' \
    >> "$FIXTURE_ROOT/.score-loop/state/quota-history.jsonl"
done
dry_output="$(
  env \
    PATH="$TMP/bin:$PATH" \
    CODEXBAR_ARGV="$TMP/codexbar.argv" \
    CODEXBAR_BEHAVIOR=fixture \
    CODEXBAR_FIXTURE="$sample" \
    FAKE_SYSTEMD_FRAGMENT_PATH="$TMP/installed-tribunal-runtime.slice" \
    TRIBUNAL_DEPLOYED_MODE=1 \
    TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
    GP_WRITER_MODE=codex \
    TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC=2 \
    TRIBUNAL_QUOTA_NOW_EPOCH="$now_epoch" \
    TRIBUNAL_QUOTA_CODEXBAR_JSON="$live_primary_null" \
    ARTICLE_COST_PCT=0.5 \
    bash "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh" \
      --workers 1 --dry-run 2>&1
)"
printf '%s\n' "$dry_output" | grep -Fq 'ARTICLE_COST_PCT=0.5 ' ||
  fail "window availability transition polluted EMA calibration: $dry_output"
pass "EMA skips samples whose active quota-window mask changed"

malformed='{not-json'
missing_fields='[{"provider":"codex","source":"cli","usage":{"primary":{"usedPercent":0}}}]'
combined="$(
  printf '%s\n' "$sample" |
    jq '. + [{"provider":"claude","source":"cli","usage":{}}]'
)"
expired_reset="$(
  printf '%s\n' "$sample" |
    jq --argjson now "$now_epoch" '.[0].usage.primary.resetsAt = $now'
)"
wrong_source="$(printf '%s\n' "$sample" | jq '.[0].source = "web"')"
wrong_window="$(
  printf '%s\n' "$sample" |
    jq '.[0].usage.secondary.windowMinutes = 1440'
)"
malformed_primary="$(
  printf '%s\n' "$live_primary_null" |
    jq '.[0].usage.primary = false'
)"
missing_primary="$(
  printf '%s\n' "$live_primary_null" |
    jq 'del(.[0].usage.primary)'
)"
for fixture in \
  "$malformed" "$missing_fields" "$combined" "$expired_reset" \
  "$wrong_source" "$wrong_window" "$malformed_primary" "$missing_primary"; do
  out="$(run_controller fixture TRIBUNAL_QUOTA_CODEXBAR_JSON="$fixture")"
  [ "$out" = "600|1|none|fallback" ] ||
    fail "invalid Codex JSON must enter observable fallback, got: $out"
done
[ ! -e "$TMP/combined-monitor.called" ] ||
  fail "invalid Codex JSON fell back to the combined monitor"
pass "malformed, incomplete, and combined JSON fail closed without substitution"

rm -f "$TMP/combined-monitor.called"
out="$(run_controller fail)"
[ "$out" = "600|1|none|fallback" ] ||
  fail "CodexBar command failure must enter observable fallback, got: $out"
[ ! -e "$TMP/combined-monitor.called" ] ||
  fail "CodexBar command failure fell back to the combined monitor"
pass "CodexBar command failure enters the existing observable fallback"

start="$SECONDS"
out="$(run_controller timeout)"
elapsed=$((SECONDS - start))
[ "$out" = "600|1|none|fallback" ] ||
  fail "CodexBar timeout must enter observable fallback, got: $out"
[ "$elapsed" -lt 4 ] ||
  fail "CodexBar timeout was not bounded (elapsed=${elapsed}s)"
[ ! -e "$TMP/combined-monitor.called" ] ||
  fail "CodexBar timeout fell back to the combined monitor"
pass "CodexBar timeout is bounded and fails closed"

grep -Fq \
  'UNKNOWN_QUOTA_READINGS="-1|-1|-1|-1|0|0|0"' \
  "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh" ||
  fail "controller lacks one canonical unknown-quota telemetry tuple"
if grep -Fq \
  '0|-1|0|-1|0|0|0' \
  "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh"; then
  fail "controller still records unavailable quota as exhausted zero percent"
fi
[ "$(
  grep -Fc \
    'readings="$UNKNOWN_QUOTA_READINGS"' \
    "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh"
)" -eq 2 ] ||
  fail "dispatch/complete fallback telemetry does not reuse the unknown tuple"
grep -Fq \
  'readings_raw="$UNKNOWN_QUOTA_READINGS"' \
  "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh" ||
  fail "tick fallback telemetry does not reuse the unknown tuple"
pass "fallback telemetry preserves unknown percentages instead of inventing zero"

set +e
legacy_output="$(
  env \
    PATH="$TMP/bin:$PATH" \
    TRIBUNAL_DEPLOYED_MODE=1 \
    USAGE_MONITOR="$TMP/bin/usage-monitor.sh" \
    bash "$FIXTURE_ROOT/scripts/tribunal-quota-loop.sh" \
      --workers 1 --controller-once 0 --legacy-quota 2>&1
)"
legacy_rc=$?
set -e
[ "$legacy_rc" -eq 78 ] ||
  fail "deployed --legacy-quota must be rejected with rc 78, got: $legacy_rc"
case "$legacy_output" in
  *"provider-specific Codex quota is required"*) ;;
  *) fail "deployed --legacy-quota rejection was not actionable: $legacy_output" ;;
esac
[ ! -e "$TMP/combined-monitor.called" ] ||
  fail "rejected deployed --legacy-quota invoked the combined monitor"
[ ! -e "$TMP/claude.called" ] ||
  fail "deployed quota regression invoked the Claude binary"
pass "deployed mode rejects the combined legacy quota path before any probe"
