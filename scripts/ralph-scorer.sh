#!/usr/bin/env bash
# Ralph Scorer — Independent review via Claude Code subagent
# Usage: ./ralph-scorer.sh <post-filename>
# Output: JSON score to /tmp/ralph-score-<ticketId>.json
# Exit: 0 = success, 1 = error
#
# Runs the ralph-scorer SUBAGENT (separate context window, separate model instance)
# so the reviewer is never the same agent as the writer.

set -euo pipefail
cd "$(dirname "$0")/.."

POST_FILE="$1"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

# Extract ticketId for output file naming
TICKET_ID=$(grep -m1 'ticketId' "$POST_PATH" | grep -o '"[^"]*"' | tr -d '"' || echo "unknown")
OUT_FILE="/tmp/ralph-score-${TICKET_ID}.json"

# Clean previous score file
rm -f "$OUT_FILE"

# Run independent Claude Code instance with the ralph-scorer subagent
# --model forced to opus because frontmatter model field may not be honored in -p mode
claude -p \
  --agent ralph-scorer \
  --model claude-opus-4-6 \
  --permission-mode bypassPermissions \
  --max-turns 5 \
  "Score this post: src/content/posts/$POST_FILE" 2>/dev/null

# Check if output file was created
if [ -f "$OUT_FILE" ]; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Score file not created at $OUT_FILE" >&2
  exit 1
fi
