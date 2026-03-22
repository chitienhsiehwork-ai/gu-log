#!/usr/bin/env bash
# Codex Scorer — Independent review via Codex CLI (OpenAI subscription quota)
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

# Read scoring standard + post content
STANDARD=$(cat scripts/ralph-vibe-scoring-standard.md)
POST_CONTENT=$(cat "$POST_PATH")

# Run Codex CLI — stderr has harmless auth refresh warning, suppress it
timeout 300 codex e "You are an independent quality scorer for gu-log blog posts.

## Scoring Standard
${STANDARD}

## Post to Score
Filename: ${POST_FILE}

${POST_CONTENT}

## Instructions
Score this post on THREE dimensions (0-10 each):
1. Persona — Does it read like 李宏毅教授 teaching? Life analogies, oral feel?
2. ClawdNote — Are the notes fun, opinionated, 吐槽-filled? Or boring footnotes?
3. Vibe — Would you share this with a friend? Engaging to the end?

Scoring anchors: 10=CP-85, 9=CP-30, 6=CP-146, 3=SP-93, 2=SP-110

Output ONLY valid JSON (no markdown fences, no explanation):
{
  \"ticketId\": \"${TICKET_ID}\",
  \"file\": \"${POST_FILE}\",
  \"scorer\": \"codex\",
  \"model\": \"codex-cli\",
  \"scores\": {
    \"persona\": { \"score\": N, \"note\": \"brief reason\" },
    \"clawdNote\": { \"score\": N, \"note\": \"brief reason\" },
    \"vibe\": { \"score\": N, \"note\": \"brief reason\" }
  },
  \"verdict\": \"PASS or FAIL (PASS = all three >= 9)\"
}" 2>/dev/null > "$OUT_FILE" || true

# Validate output
if validate_score_json "$OUT_FILE" "$POST_FILE"; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Codex scorer output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
