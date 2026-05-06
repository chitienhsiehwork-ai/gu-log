#!/usr/bin/env bash
# Deprecated compatibility wrapper.
# Canonical quality gate is tribunal.sh. This wrapper runs only the
# VibeScorer stage through Tribunal and then exports the same score JSON that
# older callers expected.
#
# Usage:
#   bash scripts/vibe-scorer.sh <post-filename> [output-path]

set -euo pipefail
cd "$(dirname "$0")/.."

POST_FILE="${1:-}"
if [ -z "$POST_FILE" ]; then
  echo "Usage: bash scripts/vibe-scorer.sh <post-filename> [output-path]" >&2
  echo "Deprecated: prefer bash scripts/tribunal.sh --score-only --only-stage vibe <post-filename>" >&2
  exit 1
fi

POST_FILE="$(basename "$POST_FILE")"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

source scripts/tribunal-helpers.sh
TICKET_ID="$(get_ticket_id "$POST_PATH")"
[ -z "$TICKET_ID" ] && TICKET_ID="unknown"
OUT_FILE="${2:-/tmp/vibe-score-${TICKET_ID}.json}"
mkdir -p "$(dirname "$OUT_FILE")"
rm -f "$OUT_FILE"

echo "[DEPRECATED] scripts/vibe-scorer.sh now delegates to tribunal.sh --score-only --only-stage vibe" >&2
TRIBUNAL_CODEX_TIMEOUT_SEC="${TRIBUNAL_CODEX_TIMEOUT_SEC:-600}" \
  TRIBUNAL_SCORE_OUTPUT="$OUT_FILE" \
  bash scripts/tribunal.sh --score-only --only-stage vibe "$POST_FILE"

if [ ! -s "$OUT_FILE" ] || ! validate_score_json "$OUT_FILE" "$POST_FILE"; then
  echo "ERROR: Scorer output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi

cat "$OUT_FILE"
