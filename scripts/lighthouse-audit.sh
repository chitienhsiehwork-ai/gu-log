#!/usr/bin/env bash
# lighthouse-audit.sh - Scan live site and append results to history
# Usage: ./scripts/lighthouse-audit.sh [URL]
# Exit 1 if any category < 80

set -euo pipefail

SITE_URL="${1:-https://gu-log.vercel.app}"
HISTORY_FILE="quality/lighthouse-history.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Ensure quality dir exists
mkdir -p quality

# Check if npx lhci is available
if ! command -v npx &>/dev/null; then
  echo "Error: npx not found" >&2
  exit 1
fi

echo "🔍 Running Lighthouse audit on ${SITE_URL}..."

# Run lighthouse via lhci collect (single run for cron efficiency)
npx lhci collect \
  --url="${SITE_URL}" \
  --url="${SITE_URL}/en/" \
  --numberOfRuns=1 \
  --chrome-flags="--headless --no-sandbox --disable-gpu" \
  2>&1

# Find the latest LHR files
LHR_DIR=".lighthouseci"
LATEST_FILES=$(ls -t "${LHR_DIR}"/lhr-*.json 2>/dev/null | head -2)

if [ -z "$LATEST_FILES" ]; then
  echo "Error: No Lighthouse results found" >&2
  exit 1
fi

# Extract scores using node
RESULT=$(node -e "
const fs = require('fs');
const files = process.argv.slice(1);
const results = files.map(f => {
  const r = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const c = r.categories;
  const a = r.audits;
  return {
    url: r.requestedUrl,
    scores: {
      performance: Math.round(c.performance.score * 100),
      accessibility: Math.round(c.accessibility.score * 100),
      'best-practices': Math.round(c['best-practices'].score * 100),
      seo: Math.round(c.seo.score * 100)
    },
    coreWebVitals: {
      FCP_ms: Math.round(a['first-contentful-paint'].numericValue),
      LCP_ms: Math.round(a['largest-contentful-paint'].numericValue),
      TBT_ms: Math.round(a['total-blocking-time'].numericValue),
      CLS: parseFloat(a['cumulative-layout-shift'].numericValue.toFixed(4)),
      SI_ms: Math.round(a['speed-index'].numericValue)
    }
  };
});
console.log(JSON.stringify(results));
" ${LATEST_FILES})

# Build history entry
ENTRY=$(node -e "
const results = JSON.parse(process.argv[1]);
const entry = {
  date: '${TIMESTAMP}',
  pages: results
};
console.log(JSON.stringify(entry));
" "${RESULT}")

# Append to history file
if [ -f "${HISTORY_FILE}" ]; then
  # Read existing, append new entry
  node -e "
    const fs = require('fs');
    const history = JSON.parse(fs.readFileSync('${HISTORY_FILE}', 'utf-8'));
    history.push(JSON.parse(process.argv[1]));
    fs.writeFileSync('${HISTORY_FILE}', JSON.stringify(history, null, 2));
  " "${ENTRY}"
else
  # Create new history file
  node -e "
    const fs = require('fs');
    fs.writeFileSync('${HISTORY_FILE}', JSON.stringify([JSON.parse(process.argv[1])], null, 2));
  " "${ENTRY}"
fi

echo "✅ Results appended to ${HISTORY_FILE}"

# Check if any category < 80
FAILED=$(node -e "
const results = JSON.parse(process.argv[1]);
let failed = false;
results.forEach(r => {
  Object.entries(r.scores).forEach(([cat, score]) => {
    if (score < 80) {
      console.error('⚠️  ' + r.url + ' — ' + cat + ': ' + score + '/100 (below 80)');
      failed = true;
    }
  });
});
process.exit(failed ? 1 : 0);
" "${RESULT}")

echo "🎉 All categories above 80. Audit passed!"
