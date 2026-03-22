#!/usr/bin/env bash
# Gemini Cross-Reference Verifier — Verifies sources via Gemini CLI (Google subscription)
# Usage: ./gemini-scorer.sh <post-filename> [output-path]
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

OUT_FILE="${2:-/tmp/gemini-score-${TICKET_ID}.json}"
mkdir -p "$(dirname "$OUT_FILE")"
rm -f "$OUT_FILE"

PROMPT_FILE="scripts/prompts/crossref-verifier.md"
PROMPT=$(cat "$PROMPT_FILE")
POST_CONTENT=$(cat "$POST_PATH")

FULL_PROMPT="${PROMPT}

---

## Post to Score
Filename: ${POST_FILE}
TicketId: ${TICKET_ID}

${POST_CONTENT}"

# Run Gemini CLI in non-interactive mode (needs GCA auth)
GEMINI_RAW="$OUT_FILE.raw"
timeout 300 env TERM=dumb NO_COLOR=1 GOOGLE_GENAI_USE_GCA=true gemini -p "$FULL_PROMPT" -m gemini-3.1-pro-preview 2>/dev/null > "$GEMINI_RAW" || true

# Extract JSON from output
if [ -f "$GEMINI_RAW" ]; then
  sed '/^```/d' "$GEMINI_RAW" | node -e "
    const input = require('fs').readFileSync('/dev/stdin','utf8');
    const match = input.match(/\{[\s\S]*\}/);
    if (match) {
      try { JSON.parse(match[0]); process.stdout.write(match[0]); }
      catch { process.exit(1); }
    } else process.exit(1);
  " > "$OUT_FILE" 2>/dev/null || true
  rm -f "$GEMINI_RAW"
fi

# Validate output — crossref verifier uses different score keys
if [ -f "$OUT_FILE" ] && jq -e '.scores.sourceFidelity.score and .scores.internalCrossRefs.score and .scores.sourceCoverage.score' "$OUT_FILE" >/dev/null 2>&1; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Gemini cross-ref verifier output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
