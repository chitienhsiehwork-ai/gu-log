#!/usr/bin/env bash
# Static/no-token regression tests for Tribunal v5 OpenAI-aware burn-rate pacing.

set -euo pipefail

if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "SKIP: Tribunal quota loop requires Bash 4+ (associative arrays/mapfile)."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL_LOOP="$ROOT_DIR/scripts/tribunal-quota-loop.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

run_case() {
  local json="$1"
  local active_workers="${2:-0}"
  local workers="${3:-1}"
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
    QUOTA_BURST_ALLOWANCE=2 \
    ARTICLE_COST_PCT=99 \
    AVG_ARTICLE_TIME=1800 \
    MIN_COOLDOWN=10 \
    MAX_COOLDOWN=1800 \
    bash "$TRIBUNAL_LOOP" --workers "$workers" --controller-once "$active_workers"
  rm -f "$tmp"
}

full_openai='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":300,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$full_openai" 0 3)
[ "$out" = "10|3|none|pacing" ] || fail "fresh OpenAI quota should run configured workers; got: $out"
pass "fresh OpenAI 5hr/weekly quota runs because used% is not ahead of elapsed-window burn line"

low_5hr='[{"provider":"openai","status":"ok","session_remaining_pct":20,"session_reset_min":240,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$low_5hr")
[ "$out" = "12000|0|five_hour|five_hour_debt" ] || fail "low 5hr bucket should sleep until burn line catches up; got: $out"
pass "OpenAI low 5hr quota sleeps until short-window burn line catches up"

over_weekly='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":300,"weekly_remaining_pct":75,"weekly_reset_hr":144}]'
out=$(run_case "$over_weekly")
[ "$out" = "68160|0|seven_day|weekly_debt" ] || fail "over-burned weekly bucket should sleep until 14%/day line catches up; got: $out"
pass "OpenAI weekly quota uses elapsed-window burn progress, not per-post cost"

surplus_weekly='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":60,"weekly_remaining_pct":100,"weekly_reset_hr":24}]'
out=$(run_case "$surplus_weekly")
[ "$out" = "10|1|none|pacing" ] || fail "surplus weekly quota should run; got: $out"
pass "OpenAI surplus quota opens workers instead of per-article pacing"

with_inflight='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":300,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$with_inflight" 2 3)
[ "$out" = "10|3|none|pacing" ] || fail "in-flight workers should not affect burn-rate gating; got: $out"
pass "in-flight workers do not feed back into burn-rate quota gating"

below_floor='[{"provider":"openai","status":"ok","session_remaining_pct":100,"session_reset_min":300,"weekly_remaining_pct":9,"weekly_reset_hr":72}]'
out=$(run_case "$below_floor")
[ "$out" = "259200|0|seven_day|floor_stop" ] || fail "weekly quota below reserve floor should sleep until reset; got: $out"
pass "quota below reserve floor stops until reset"

missing_reset='[{"provider":"openai","status":"ok","session_remaining_pct":100,"weekly_remaining_pct":100,"weekly_reset_hr":168}]'
out=$(run_case "$missing_reset")
[ "$out" = "600|1|none|fallback" ] || fail "missing reset metadata should fail safe into fallback; got: $out"
pass "missing OpenAI reset metadata fails safe into fallback sleep"

claude_fixture='[{"provider":"claude","status":"ok","five_hr_remaining_pct":100,"five_hr_reset":"5.0 小時","weekly_remaining_pct":100,"weekly_reset":"7.0 天"}]'
out=$(run_case "$claude_fixture")
[ "$out" = "10|1|none|pacing" ] || fail "legacy Claude fixture parser regressed; got: $out"
pass "legacy Claude quota fixture remains parseable for dev/backcompat"
