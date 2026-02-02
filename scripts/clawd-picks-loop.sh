#!/usr/bin/env bash
# Clawd Picks — 每小時跑一次 yolo-cc 自動翻譯推文
# Usage: ./scripts/clawd-picks-loop.sh [max_iterations]
# Requires: X_BEARER_TOKEN env var

set -euo pipefail

MAX_ITERATIONS=${1:-24}
LOG="scripts/clawd-picks.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "${X_BEARER_TOKEN:-}" ]; then
  echo "ERROR: X_BEARER_TOKEN is not set" >&2
  exit 1
fi

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo "[$(date)] Iteration $i/$MAX_ITERATIONS" >> "$REPO_DIR/$LOG"

  yolo-cc -w "$REPO_DIR" --ralph --max-iterations 3 \
    -e "X_BEARER_TOKEN=$X_BEARER_TOKEN" \
    --completion-promise "CLAWD PICK PUBLISHED" \
    "$(cat "$SCRIPT_DIR/clawd-picks-prompt.md")" \
    >> "$REPO_DIR/$LOG" 2>&1 || {
      echo "[$(date)] yolo-cc failed on iteration $i" >> "$REPO_DIR/$LOG"
    }

  echo "[$(date)] Done iteration $i, sleeping 1hr..." >> "$REPO_DIR/$LOG"
  [ "$i" -lt "$MAX_ITERATIONS" ] && sleep 3600
done

echo "[$(date)] All $MAX_ITERATIONS iterations complete." >> "$REPO_DIR/$LOG"
