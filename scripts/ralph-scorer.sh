#!/usr/bin/env bash
# Ralph Scorer — Independent review via claude -p
# Usage: ./ralph-scorer.sh <post-filename>
# Output: JSON score written to /tmp/ralph-score-<ticketId>.json
# Exit: 0 = success, 1 = error
#
# Runs a SEPARATE Claude instance (claude -p) to ensure
# the reviewer is never the same agent as the writer.

set -euo pipefail
cd "$(dirname "$0")/.."

POST_FILE="$1"
POST_PATH="src/content/posts/$POST_FILE"
SCORING_STANDARD="scripts/ralph-vibe-scoring-standard.md"
TRANSLATION_PROMPT="TRANSLATION_PROMPT.md"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

# Extract ticketId
TICKET_ID=$(grep -m1 'ticketId' "$POST_PATH" | grep -o '"[^"]*"' | tr -d '"' || echo "unknown")
OUT_FILE="/tmp/ralph-score-${TICKET_ID}.json"

# Build the prompt as a temp file (avoids arg length limits)
PROMPT_FILE=$(mktemp /tmp/ralph-prompt-XXXXX.md)
trap "rm -f $PROMPT_FILE" EXIT

cat > "$PROMPT_FILE" <<EOF
You are an independent quality reviewer for gu-log blog posts. You have NO relationship to the writer. Score honestly and harshly.

## Scoring Standard

$(cat "$SCORING_STANDARD")

## Persona Reference (LHY Style)

$(cat "$TRANSLATION_PROMPT")

## Post to Review (file: $POST_FILE)

$(cat "$POST_PATH")

## Instructions

1. Read the scoring standard carefully — especially the calibration examples (CP-85=10, CP-30=9, SP-93=3, SP-110=2/2/3, CP-146=6, Lv-07=6)
2. Score on THREE dimensions (0-10): Persona (LHY style), ClawdNote (吐槽+洞察 quality), Vibe (fun/chill/informed)
3. Be HARSH. The bar is high. 9 = almost LHY level. 10 = indistinguishable from LHY.
4. Check for these instant score killers:
   - CodexNote/GeminiNote/ClaudeCodeNote used instead of ClawdNote → ClawdNote score max 5
   - Bullet-dump ending → Vibe max 6
   - 「各位觀眾好」opening → Persona max 5
   - Motivational-poster closing → Vibe max 6
5. Write your review to: $OUT_FILE

## Required Output (write to $OUT_FILE)

Write ONLY this JSON to the file:

{
  "ticketId": "$TICKET_ID",
  "file": "$POST_FILE",
  "scores": {
    "persona": { "score": N, "reason": "specific one-line justification citing examples from the post" },
    "clawdNote": { "score": N, "reason": "specific one-line justification" },
    "vibe": { "score": N, "reason": "specific one-line justification" }
  },
  "meetBar": true_or_false,
  "topIssues": ["issue1", "issue2", "issue3"]
}

IMPORTANT: Output ONLY the JSON content. No markdown fences, no explanation.
EOF

# Run independent Claude instance for scoring
claude -p \
  --model claude-opus-4-6 \
  --permission-mode bypassPermissions \
  --max-turns 3 \
  "$(cat "$PROMPT_FILE")" 2>/dev/null

# Check if output file was created
if [ -f "$OUT_FILE" ]; then
  cat "$OUT_FILE"
else
  # Fallback: claude might have printed to stdout instead of writing file
  echo "WARN: Score file not created at $OUT_FILE — check claude output" >&2
  exit 1
fi
