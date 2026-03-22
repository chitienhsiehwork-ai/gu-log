#!/usr/bin/env bash
# multi-score-batch.sh — Score unscored posts through all 3 judges
# Usage: ./multi-score-batch.sh [LIMIT]
#   ./multi-score-batch.sh       → score all unscored (up to 5 per run)
#   ./multi-score-batch.sh 1     → score 1 post only (test)
#
# Designed to be called from cron. Respects quota by:
#   - Max 5 posts per run (3 judges × 5 posts = 15 API calls)
#   - Each scorer has 5min timeout
#   - Run frequency should be set in cron job (e.g. every 6h)

set -euo pipefail
cd "$(dirname "$0")/.."

LIMIT="${1:-5}"
MANIFEST="src/data/score-manifest.json"
MULTI_DIR="/tmp/multi-score"
PROGRESS="scripts/ralph-progress.json"

mkdir -p "$MULTI_DIR"

# Find posts that have vibe score but missing fact-check or cross-ref
CANDIDATES=$(node -e "
const m = require('./$MANIFEST');
const candidates = Object.entries(m)
  .filter(([,v]) => v.vibe && (!v.factCheck || !v.crossRef))
  .map(([id]) => id);
candidates.forEach(c => console.log(c));
")

TOTAL=$(echo "$CANDIDATES" | grep -c . || echo 0)
echo "═══ Multi-Score Batch ═══"
echo "Posts needing scoring: $TOTAL"
echo "Limit this run: $LIMIT"
echo ""

if [ "$TOTAL" -eq 0 ]; then
  echo "✅ All posts fully scored!"
  exit 0
fi

# Take first LIMIT candidates
BATCH=$(echo "$CANDIDATES" | head -n "$LIMIT")
SCORED=0

for TICKET_ID in $BATCH; do
  # Find the file for this ticketId
  FILE=$(grep -rl "ticketId.*\"$TICKET_ID\"" src/content/posts/ 2>/dev/null | grep -v '^en-' | grep -v '/en-' | head -1)
  if [ -z "$FILE" ]; then
    echo "⚠️  $TICKET_ID: file not found, skipping"
    continue
  fi
  
  FILENAME=$(basename "$FILE")
  echo "→ Scoring $TICKET_ID ($FILENAME)..."
  
  # Only run the missing scorers
  EXISTING="$MULTI_DIR/multi-score-${TICKET_ID}.json"
  NEEDS_FACT=true
  NEEDS_CROSS=true
  
  if [ -f "$EXISTING" ]; then
    NEEDS_FACT=$(node -e "const d=require('$EXISTING'); console.log(!d.judges?.factCheck?.scores ? 'true' : 'false')" 2>/dev/null || echo "true")
    NEEDS_CROSS=$(node -e "const d=require('$EXISTING'); console.log(!d.judges?.crossRef?.scores ? 'true' : 'false')" 2>/dev/null || echo "true")
  fi
  
  CODEX_OUT="$MULTI_DIR/codex-${TICKET_ID}.json"
  GEMINI_OUT="$MULTI_DIR/gemini-${TICKET_ID}.json"
  
  # Run missing scorers in parallel
  PIDS=""
  if [ "$NEEDS_FACT" = "true" ]; then
    bash scripts/codex-scorer.sh "$FILENAME" "$CODEX_OUT" &
    PIDS="$PIDS $!"
  fi
  if [ "$NEEDS_CROSS" = "true" ]; then
    bash scripts/gemini-scorer.sh "$FILENAME" "$GEMINI_OUT" &
    PIDS="$PIDS $!"
  fi
  
  # Wait for scorers
  for PID in $PIDS; do
    wait "$PID" 2>/dev/null || true
  done
  
  SCORED=$((SCORED + 1))
  echo "  ✓ $TICKET_ID done ($SCORED/$LIMIT)"
done

echo ""
echo "═══ Updating manifest ═══"

# Rebuild manifest with new scores
node scripts/build-score-manifest.mjs

echo ""
echo "═══ Batch complete: $SCORED posts scored ═══"
