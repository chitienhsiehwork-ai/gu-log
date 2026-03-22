#!/usr/bin/env bash
# Codex Fact Checker — Verifies factual accuracy via Codex CLI (subscription quota)
# Usage: ./codex-scorer.sh <post-filename> [output-path]
# Exit: 0 = success (valid JSON written), 1 = error

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/ralph-helpers.sh

POST_FILE="$1"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

TICKET_ID=$(get_ticket_id "$POST_PATH")
[ -z "$TICKET_ID" ] && TICKET_ID="unknown"

OUT_FILE="${2:-/tmp/codex-score-${TICKET_ID}.json}"
mkdir -p "$(dirname "$OUT_FILE")"
rm -f "$OUT_FILE"

PROMPT_FILE="scripts/prompts/fact-checker.md"
PROMPT=$(cat "$PROMPT_FILE")
POST_CONTENT=$(cat "$POST_PATH")

# Run Codex CLI — stderr has harmless auth refresh warning, suppress it
timeout 300 codex e "${PROMPT}

---

## Post to Score
Filename: ${POST_FILE}
TicketId: ${TICKET_ID}

${POST_CONTENT}" 2>/dev/null > "$OUT_FILE" || true

# Extract JSON if wrapped in markdown or prose
if ! jq empty "$OUT_FILE" 2>/dev/null; then
  ORIG=$(cat "$OUT_FILE")
  echo "$ORIG" | node -e "
    const input = require('fs').readFileSync('/dev/stdin','utf8');
    const match = input.match(/\{[\s\S]*\}/);
    if (match) { try { JSON.parse(match[0]); process.stdout.write(match[0]); } catch { process.exit(1); } }
    else process.exit(1);
  " > "${OUT_FILE}.clean" 2>/dev/null && mv "${OUT_FILE}.clean" "$OUT_FILE" || true
fi

# Validate output — single score
if [ -f "$OUT_FILE" ] && jq -e '.score >= 0 and .score <= 10' "$OUT_FILE" >/dev/null 2>&1; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Codex fact-checker output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
