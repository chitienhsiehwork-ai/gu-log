#!/usr/bin/env bash
# Static/no-token regression tests for Tribunal v4 OpenAI-aware quota pacing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL_LOOP="$ROOT_DIR/scripts/tribunal-quota-loop.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

run_case() {
  local json="$1"
  local active_workers="${2:-0}"
  local tmp
  tmp=$(mktemp)
  cat > "$tmp" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "--json" ]; then
  cat <<'JSON'
$json
JSON
else
  echo 'fake usage-monitor: only --json is supported' >&2
  exit 2
fi
EOF
  chmod +x "$tmp"
  USAGE_MONITOR="$tmp" \
    QUOTA_FLOOR=10 \
    ARTICLE_COST_PCT=1 \
    AVG_ARTICLE_TIME=1800 \
    MIN_COOLDOWN=10 \
    MAX_COOLDOWN=1800 \
    bash "$TRIBUNAL_LOOP" --controller-once "$active_workers"
  rm -f "$tmp"
}

full_openai='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":300,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$full_openai")
[ "$out" = "6720|0|seven_day|weekly_debt" ] || fail "full OpenAI quota should pace by weekly projection; got: $out"
pass "OpenAI 5hr/weekly readings bind to projected weekly burn line"

low_5hr='[{"provider":"openai","status":"ok","session_remaining_pct":20,"session_reset_min":240,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$low_5hr")
[ "$out" = "12600|0|five_hour|five_hour_debt" ] || fail "low 5hr bucket should sleep until projected 5hr reserve catches up; got: $out"
pass "OpenAI low 5hr quota sleeps until projected short-window budget catches up"

surplus_weekly='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":60,"weekly_remaining_pct":100,"weekly_reset_hr":24}]'
out=$(run_case "$surplus_weekly")
[ "$out" = "960|1|seven_day|pacing" ] || fail "surplus weekly quota should pace instead of debt-sleep; got: $out"
pass "OpenAI surplus quota uses normal pacing rather than debt stop"

with_inflight='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":300,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$with_inflight" 2)
[ "$out" = "20160|0|seven_day|weekly_debt" ] || fail "in-flight workers should be charged before opening another slot; got: $out"
pass "in-flight workers are charged against projected quota before dispatch"

claude_fixture='[{"provider":"claude","status":"ok","five_hr_remaining_pct":100,"five_hr_reset":"5.0 小時","weekly_remaining_pct":100,"weekly_reset":"7.0 天"}]'
out=$(run_case "$claude_fixture")
[ "$out" = "6720|0|seven_day|weekly_debt" ] || fail "legacy Claude fixture parser regressed; got: $out"
pass "legacy Claude quota fixture remains parseable for dev/backcompat"
