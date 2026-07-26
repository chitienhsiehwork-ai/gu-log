#!/usr/bin/env bash
# security-audit.sh — Record the shared bulk advisory audit and alert on high/critical
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

# Use the same fail-closed bulk advisory producer as the blocking security gate.
if ! COUNTS=$(cd "${PROJECT_DIR}" && node scripts/security-gate.mjs --summary-json); then
  echo "ERROR: shared security audit producer failed"
  exit 2
fi

# Refuse malformed output before recording history.
if ! printf '%s' "${COUNTS}" | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
for (const severity of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
  if (!Number.isInteger(data[severity]) || data[severity] < 0) process.exit(1);
}
"; then
  echo "ERROR: shared security audit producer returned invalid counts"
  exit 2
fi

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

# Report status — exit always 0 (recording-only; gating is done by security-gate.mjs)
if [ "${HIGH}" -gt 0 ] || [ "${CRITICAL}" -gt 0 ]; then
  echo ""
  echo "⚠️  HIGH/CRITICAL vulnerabilities detected (recorded). Run security-gate.mjs for allowlist-aware gating."
else
  echo ""
  echo "✅ No high/critical vulnerabilities. Moderate issues may be addressed at next maintenance window."
fi
exit 0
