#!/usr/bin/env bash
# Gemini Scorer — Independent review via Gemini CLI (Google subscription quota)
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

# Read scoring standard + post content
STANDARD=$(cat scripts/ralph-vibe-scoring-standard.md)
POST_CONTENT=$(cat "$POST_PATH")

# Build prompt
PROMPT="You are an independent quality scorer for gu-log blog posts.

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
  \"scorer\": \"gemini\",
  \"model\": \"gemini-3.1-pro-preview\",
  \"scores\": {
    \"persona\": { \"score\": N, \"note\": \"brief reason\" },
    \"clawdNote\": { \"score\": N, \"note\": \"brief reason\" },
    \"vibe\": { \"score\": N, \"note\": \"brief reason\" }
  },
  \"verdict\": \"PASS or FAIL (PASS = all three >= 9)\"
}"

# Run Gemini CLI in non-interactive mode (needs GCA auth)
GEMINI_RAW="$OUT_FILE.raw"
timeout 300 env TERM=dumb NO_COLOR=1 GOOGLE_GENAI_USE_GCA=true gemini -p "$PROMPT" -m gemini-3.1-pro-preview 2>/dev/null > "$GEMINI_RAW" || true

# Extract JSON from output (may have markdown fences or prose around it)
if [ -f "$GEMINI_RAW" ]; then
  # Try 1: strip code fences and extract JSON object
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

# Validate output
if validate_score_json "$OUT_FILE" "$POST_FILE"; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Gemini scorer output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
