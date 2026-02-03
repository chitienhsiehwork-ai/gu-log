#!/usr/bin/env bash
# Clawd Picks — 每小時跑一次 yolo-cc 自動翻譯推文
# Usage: ./scripts/clawd-picks-loop.sh [max_iterations]

set -euo pipefail

MAX_ITERATIONS=${1:-24}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$REPO_DIR/scripts/clawd-picks.log"

# Short prompt — tells container Claude to read the full instructions from file
PROMPT='Read scripts/clawd-picks-prompt.md and follow ALL steps precisely. This is an autonomous task — do not ask questions, just execute every step from 1 to 7. When done, output [[PROMISE: CLAWD PICK PUBLISHED]]'

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo "[$(date)] Iteration $i/$MAX_ITERATIONS" >> "$LOG"

  yolo-cc -w "$REPO_DIR" --ralph --max-iterations 3 \
    --completion-promise "CLAWD PICK PUBLISHED" \
    "$PROMPT" \
    >> "$LOG" 2>&1 || {
      echo "[$(date)] yolo-cc failed on iteration $i" >> "$LOG"
    }

  echo "[$(date)] Done iteration $i, sleeping 1hr..." >> "$LOG"
  [ "$i" -lt "$MAX_ITERATIONS" ] && sleep 3600
done

echo "[$(date)] All $MAX_ITERATIONS iterations complete." >> "$LOG"
