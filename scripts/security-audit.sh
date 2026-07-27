#!/usr/bin/env bash
# security-audit.sh — Record the shared bulk advisory audit and alert on high/critical
# Part of SQAA Level 1
# Exit codes:
#   0 = advisory history recorded (high/critical are recorded; the separate gate decides)
#   2 = producer, schema, or history error

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUALITY_DIR="${PROJECT_DIR}/quality"
HISTORY_FILE="${QUALITY_DIR}/security-audit-history.json"
HISTORY_TMP=""
HISTORY_LOCK_DIR="${HISTORY_FILE}.lock"
HISTORY_LOCKED=0

cleanup() {
  set +e
  if [ -n "${HISTORY_TMP}" ]; then
    rm -f "${HISTORY_TMP}" || true
  fi
  if [ "${HISTORY_LOCKED}" -eq 1 ]; then
    rmdir "${HISTORY_LOCK_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'status=$?; if [ "${status}" -ne 0 ]; then echo "ERROR: security audit recording failed" >&2; exit 2; fi' ERR
trap 'exit 2' HUP INT TERM

mkdir -p "${QUALITY_DIR}"

# Use the same fail-closed bulk advisory producer as the blocking security gate.
if ! COUNTS=$(cd "${PROJECT_DIR}" && node scripts/security-gate.mjs --summary-json); then
  echo "ERROR: shared security audit producer failed"
  exit 2
fi

# Refuse malformed output before recording history.
if ! printf '%s' "${COUNTS}" | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
if (
  data.schemaVersion !== 1 ||
  data.producer !== 'npm-bulk-advisory' ||
  data.dependencySource !== 'pnpm-lock.yaml' ||
  data.unit !== 'advisory-record' ||
  !data.severities ||
  typeof data.severities !== 'object' ||
  Array.isArray(data.severities)
) process.exit(1);
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  if (!Number.isInteger(data.severities[severity]) || data.severities[severity] < 0) process.exit(1);
}
if (
  !Number.isInteger(data.total) ||
  data.total < 0 ||
  data.total !== Object.values(data.severities).reduce((sum, value) => sum + value, 0)
) process.exit(1);
"; then
  echo "ERROR: shared security audit producer returned invalid counts"
  exit 2
fi

HIGH=$(echo "${COUNTS}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.severities.high)")
CRITICAL=$(echo "${COUNTS}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.severities.critical)")
TOTAL=$(echo "${COUNTS}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total)")

DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build history entry
ENTRY=$(node -e "
const counts = ${COUNTS};
const entry = {
  schemaVersion: 2,
  date: '${DATE}',
  producer: counts.producer,
  dependencySource: counts.dependencySource,
  unit: counts.unit,
  total: counts.total,
  severities: counts.severities,
  hasHighOrCritical: (counts.severities.high + counts.severities.critical) > 0
};
console.log(JSON.stringify(entry, null, 2));
")

# Serialize writers so two scheduled runs cannot overwrite each other's entry.
if ! mkdir "${HISTORY_LOCK_DIR}"; then
  echo "ERROR: another security audit writer holds ${HISTORY_LOCK_DIR}"
  exit 2
fi
HISTORY_LOCKED=1
HISTORY_TMP=$(mktemp "${HISTORY_FILE}.tmp.XXXXXX")

# Write beside the destination, then atomically rename. A malformed history is
# a recording error, not a fresh baseline.
if ! node -e "
const fs = require('fs');
const historyPath = process.argv[1];
const temporaryPath = process.argv[2];
let history = [];
if (fs.existsSync(historyPath)) {
  const raw = fs.readFileSync(historyPath, 'utf8');
  if (!raw.trim()) throw new Error('existing history must not be empty');
  history = JSON.parse(raw);
}
if (!Array.isArray(history)) throw new Error('history must be an array');
const entry = ${ENTRY};
history.push(entry);
fs.writeFileSync(temporaryPath, JSON.stringify(history, null, 2) + '\n');
" "${HISTORY_FILE}" "${HISTORY_TMP}"; then
  echo "ERROR: could not append security audit history"
  exit 2
fi
if ! mv "${HISTORY_TMP}" "${HISTORY_FILE}"; then
  echo "ERROR: could not atomically replace security audit history"
  exit 2
fi
HISTORY_TMP=""

# Report
echo "=== Security Audit Report ==="
echo "Date: ${DATE}"
echo "Producer: npm-bulk-advisory (pnpm-lock.yaml)"
echo "Total advisory records: ${TOTAL}"
echo "Advisory severity breakdown:"
echo "${COUNTS}" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('  info:     ' + d.severities.info);
console.log('  low:      ' + d.severities.low);
console.log('  moderate: ' + d.severities.moderate);
console.log('  high:     ' + d.severities.high);
console.log('  critical: ' + d.severities.critical);
"
echo "History appended to: ${HISTORY_FILE}"

# Report status — exit always 0 (recording-only; gating is done by security-gate.mjs)
if [ "${HIGH}" -gt 0 ] || [ "${CRITICAL}" -gt 0 ]; then
  echo ""
  echo "⚠️  HIGH/CRITICAL advisory records detected (recorded). Run security-gate.mjs for allowlist-aware gating."
else
  echo ""
  echo "✅ No high/critical advisory records. Moderate issues may be addressed at next maintenance window."
fi
exit 0
