#!/usr/bin/env bash
# Deprecated compatibility wrapper for independent vibe scoring.
# Usage: ./vibe-scorer.sh <post-filename> [output-path]

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/tribunal-helpers.sh

POST_FILE="${1:-}"
if [ -z "$POST_FILE" ]; then
  echo "Usage: bash scripts/vibe-scorer.sh <post-filename> [output-path]" >&2
  echo "Deprecated: prefer bash scripts/tribunal.sh --only-stage vibe <post-filename>" >&2
  exit 1
fi

POST_FILE="$(basename "$POST_FILE")"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

TICKET_ID="$(get_ticket_id "$POST_PATH")"
[ -z "$TICKET_ID" ] && TICKET_ID="unknown"
OUT_FILE="${2:-/tmp/vibe-score-${TICKET_ID}.json}"
mkdir -p "$(dirname "$OUT_FILE")"
rm -f "$OUT_FILE"

WORK_DIR="$(tribunal_llm_work_dir)"
trap 'rm -rf "$WORK_DIR"' EXIT

TRIBUNAL_CODEX_TIMEOUT_SEC="${TRIBUNAL_CODEX_TIMEOUT_SEC:-600}" \
  tribunal_codex_exec "$WORK_DIR" "vibe-opus-scorer" \
  "Score this post: $(pwd)/$POST_PATH
Write your JSON output to exactly this path: $OUT_FILE" >/tmp/vibe-scorer-${TICKET_ID}.log 2>&1 || true

if validate_score_json "$OUT_FILE" "$POST_FILE"; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Scorer output missing or invalid at $OUT_FILE" >&2
  [ -f "/tmp/vibe-scorer-${TICKET_ID}.log" ] && tail -80 "/tmp/vibe-scorer-${TICKET_ID}.log" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
