#!/usr/bin/env bash
# security-audit.sh — Run pnpm audit, record results, alert on high/critical
# Part of SQAA Level 1
# Exit codes:
#   0 = no high/critical vulnerabilities
#   1 = high or critical vulnerabilities found (needs notification)
#   2 = script error

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUALITY_DIR="${PROJECT_DIR}/quality"
HISTORY_FILE="${QUALITY_DIR}/security-audit-history.json"

mkdir -p "${QUALITY_DIR}"

# Run pnpm audit in JSON mode (exit code 0 = clean, non-zero = vulnerabilities found)
# pnpm audit returns non-zero when vulns exist, so we capture and continue
AUDIT_JSON=$(cd "${PROJECT_DIR}" && pnpm audit --json 2>/dev/null) || true

if [ -z "${AUDIT_JSON}" ]; then
  echo "ERROR: pnpm audit returned empty output"
  exit 2
fi

# Extract severity counts using node (available in any Node project)
COUNTS=$(echo "${AUDIT_JSON}" | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const v = data.metadata?.vulnerabilities || {};
console.log(JSON.stringify({
  info: v.info || 0,
  low: v.low || 0,
  moderate: v.moderate || 0,
  high: v.high || 0,
  critical: v.critical || 0,
  total: v.total || 0
}));
")

HIGH=$(echo "${COUNTS}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.high)")
CRITICAL=$(echo "${COUNTS}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.critical)")
TOTAL=$(echo "${COUNTS}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total)")

DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build history entry
ENTRY=$(node -e "
const counts = ${COUNTS};
const entry = {
  date: '${DATE}',
  total: counts.total,
  severities: {
    info: counts.info,
    low: counts.low,
    moderate: counts.moderate,
    high: counts.high,
    critical: counts.critical
  },
  hasHighOrCritical: (counts.high + counts.critical) > 0
};
console.log(JSON.stringify(entry, null, 2));
")

# Append to history file (initialize if needed)
if [ ! -f "${HISTORY_FILE}" ] || [ ! -s "${HISTORY_FILE}" ]; then
  echo "[]" > "${HISTORY_FILE}"
fi

# Append entry to JSON array
node -e "
const fs = require('fs');
const history = JSON.parse(fs.readFileSync('${HISTORY_FILE}', 'utf8'));
const entry = ${ENTRY};
history.push(entry);
fs.writeFileSync('${HISTORY_FILE}', JSON.stringify(history, null, 2) + '\n');
"

# Report
echo "=== Security Audit Report ==="
echo "Date: ${DATE}"
echo "Total vulnerabilities: ${TOTAL}"
echo "Severity breakdown:"
echo "${COUNTS}" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('  info:     ' + d.info);
console.log('  low:      ' + d.low);
console.log('  moderate: ' + d.moderate);
console.log('  high:     ' + d.high);
console.log('  critical: ' + d.critical);
"
echo "History appended to: ${HISTORY_FILE}"

# Exit with 1 if high or critical found
if [ "${HIGH}" -gt 0 ] || [ "${CRITICAL}" -gt 0 ]; then
  echo ""
  echo "⚠️  HIGH/CRITICAL vulnerabilities detected! Immediate action recommended."
  exit 1
else
  echo ""
  echo "✅ No high/critical vulnerabilities. Moderate issues may be addressed at next maintenance window."
  exit 0
fi
