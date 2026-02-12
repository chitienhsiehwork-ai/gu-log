#!/usr/bin/env bash
# Coverage Ratchet Script
# Compares current coverage against baseline and enforces non-regression.
# - If coverage drops more than 5% below baseline → FAIL
# - If coverage improves → update baseline (ratchet up)
# - Always appends to coverage-history.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BASELINE_FILE="$PROJECT_DIR/quality/coverage-baseline.json"
HISTORY_FILE="$PROJECT_DIR/quality/coverage-history.json"
REPORT_FILE="$PROJECT_DIR/quality/coverage/report.json"

if [ ! -f "$BASELINE_FILE" ]; then
  echo "❌ No baseline found at $BASELINE_FILE"
  echo "   Run tests first to generate a baseline."
  exit 1
fi

if [ ! -f "$REPORT_FILE" ]; then
  echo "❌ No coverage report found at $REPORT_FILE"
  echo "   Run: npx playwright test <stable-tests> first."
  exit 1
fi

# Extract current coverage from monocart report JSON
# The summary is in the coverage.summary object
CURRENT_STATEMENTS=$(jq -r '.coverage.summary.statements // .summary.statements // empty' "$REPORT_FILE" 2>/dev/null || echo "")
CURRENT_BRANCHES=$(jq -r '.coverage.summary.branches // .summary.branches // empty' "$REPORT_FILE" 2>/dev/null || echo "")
CURRENT_FUNCTIONS=$(jq -r '.coverage.summary.functions // .summary.functions // empty' "$REPORT_FILE" 2>/dev/null || echo "")
CURRENT_LINES=$(jq -r '.coverage.summary.lines // .summary.lines // empty' "$REPORT_FILE" 2>/dev/null || echo "")

# If we can't extract from report.json, try reading from the console output
if [ -z "$CURRENT_STATEMENTS" ] || [ "$CURRENT_STATEMENTS" = "null" ]; then
  echo "⚠️  Could not parse coverage from report.json. Using manual values if provided."
  echo "   Usage: $0 [statements] [branches] [functions] [lines]"
  if [ $# -ge 4 ]; then
    CURRENT_STATEMENTS="$1"
    CURRENT_BRANCHES="$2"
    CURRENT_FUNCTIONS="$3"
    CURRENT_LINES="$4"
  else
    echo "❌ No coverage data available."
    exit 1
  fi
fi

# Read baseline
BASELINE_STATEMENTS=$(jq -r '.statements' "$BASELINE_FILE")
BASELINE_BRANCHES=$(jq -r '.branches' "$BASELINE_FILE")
BASELINE_FUNCTIONS=$(jq -r '.functions' "$BASELINE_FILE")
BASELINE_LINES=$(jq -r '.lines' "$BASELINE_FILE")

echo "📊 Coverage Ratchet Check"
echo "========================="
echo ""
echo "Metric       Baseline    Current     Delta"
echo "----------   --------    --------    ------"

FAIL=0
IMPROVED=0

check_metric() {
  local name="$1"
  local baseline="$2"
  local current="$3"
  local threshold=5

  local delta
  delta=$(echo "$current - $baseline" | bc -l)
  local delta_fmt
  delta_fmt=$(printf "%+.2f%%" "$delta")

  local status="✅"
  local neg_threshold
  neg_threshold=$(echo "$baseline - $threshold" | bc -l)

  if (( $(echo "$current < $neg_threshold" | bc -l) )); then
    status="❌ REGRESSION"
    FAIL=1
  elif (( $(echo "$current > $baseline" | bc -l) )); then
    status="🔼 IMPROVED"
    IMPROVED=1
  fi

  printf "%-12s %7.2f%%    %7.2f%%    %s %s\n" "$name" "$baseline" "$current" "$delta_fmt" "$status"
}

check_metric "Statements" "$BASELINE_STATEMENTS" "$CURRENT_STATEMENTS"
check_metric "Branches" "$BASELINE_BRANCHES" "$CURRENT_BRANCHES"
check_metric "Functions" "$BASELINE_FUNCTIONS" "$CURRENT_FUNCTIONS"
check_metric "Lines" "$BASELINE_LINES" "$CURRENT_LINES"

echo ""

# Append to history
TODAY=$(date +%Y-%m-%d)
HISTORY_ENTRY=$(jq -n \
  --arg date "$TODAY" \
  --argjson statements "$CURRENT_STATEMENTS" \
  --argjson branches "$CURRENT_BRANCHES" \
  --argjson functions "$CURRENT_FUNCTIONS" \
  --argjson lines "$CURRENT_LINES" \
  '{date: $date, statements: $statements, branches: $branches, functions: $functions, lines: $lines}')

if [ -f "$HISTORY_FILE" ]; then
  jq --argjson entry "$HISTORY_ENTRY" '. + [$entry]' "$HISTORY_FILE" > "${HISTORY_FILE}.tmp"
  mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
else
  echo "[$HISTORY_ENTRY]" > "$HISTORY_FILE"
fi
echo "📝 Appended to coverage history."

# Ratchet: if improved, update baseline
if [ "$IMPROVED" -eq 1 ] && [ "$FAIL" -eq 0 ]; then
  jq \
    --argjson s "$CURRENT_STATEMENTS" \
    --argjson b "$CURRENT_BRANCHES" \
    --argjson f "$CURRENT_FUNCTIONS" \
    --argjson l "$CURRENT_LINES" \
    --arg d "$TODAY" \
    '.statements = $s | .branches = $b | .functions = $f | .lines = $l | .date = $d' \
    "$BASELINE_FILE" > "${BASELINE_FILE}.tmp"
  mv "${BASELINE_FILE}.tmp" "$BASELINE_FILE"
  echo "🔼 Baseline ratcheted up!"
fi

if [ "$FAIL" -eq 1 ]; then
  echo "❌ COVERAGE REGRESSION DETECTED (>5% drop from baseline)"
  exit 1
else
  echo "✅ Coverage check passed."
  exit 0
fi
