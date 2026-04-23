#!/usr/bin/env bash
# Vibe Scorer — Independent review via Claude Code subagent (vibe-opus-scorer)
# Usage: ./vibe-scorer.sh <post-filename> [output-path]
#   ./vibe-scorer.sh "sp-110-xxx.mdx"
#   ./vibe-scorer.sh "sp-110-xxx.mdx" "/tmp/vibe/run-1/score.json"
# Exit: 0 = success (valid JSON written), 1 = error

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/tribunal-helpers.sh

POST_FILE="$1"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

# Extract ticketId using shared helper
TICKET_ID=$(get_ticket_id "$POST_PATH")
[ -z "$TICKET_ID" ] && TICKET_ID="unknown"

# Output path: explicit arg or default
OUT_FILE="${2:-/tmp/vibe-score-${TICKET_ID}.json}"

# Ensure output dir exists
mkdir -p "$(dirname "$OUT_FILE")"

# Clean previous score file
rm -f "$OUT_FILE"

# Run independent Claude Code instance with the vibe-opus-scorer subagent
# Timeout: 10 minutes per score. Opus 4.6 (pinned) on decorative-trap posts
# can need 10+ turns to do strip test + read standard + write JSON.
# Max-turns 30 gives scorer enough space; real cost is still bounded by timeout.
# Claude Code refuses --permission-mode bypassPermissions under root (CCC runs
# as root), so drop it there and keep it for non-root (mac-CC).
scorer_cmd=(timeout 600 claude -p --agent vibe-opus-scorer --max-turns 30)
[ "$(id -u)" != "0" ] && scorer_cmd+=(--permission-mode bypassPermissions)
"${scorer_cmd[@]}" \
  "Score this post: src/content/posts/$POST_FILE
Write your JSON output to exactly this path: $OUT_FILE" || true

# Validate output
if validate_score_json "$OUT_FILE" "$POST_FILE"; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Scorer output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
