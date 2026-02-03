#!/usr/bin/env bash
# Clawd Picks — hourly yolo-cc loop with auto-push
# Usage: ./scripts/clawd-picks-loop.sh [max_iterations]

set -euo pipefail

MAX_ITERATIONS=${1:-24}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$REPO_DIR/scripts/clawd-picks.log"

# Short prompt — container Claude reads full instructions from file
PROMPT='Read scripts/clawd-picks-prompt.md and follow ALL steps precisely. This is an autonomous task — do not ask questions, just execute every step from 1 to 7. When done, output [[PROMISE: CLAWD PICK PUBLISHED]]'

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo "[$(date)] Iteration $i/$MAX_ITERATIONS" >> "$LOG"

  yolo-cc -w "$REPO_DIR" --ralph --max-iterations 3 \
    --completion-promise "CLAWD PICK PUBLISHED" \
    "$PROMPT" \
    >> "$LOG" 2>&1 || {
      echo "[$(date)] yolo-cc failed on iteration $i" >> "$LOG"
    }

  # Auto-push after each iteration (container can't push)
  echo "[$(date)] Syncing with origin..." >> "$LOG"
  cd "$REPO_DIR"
  git pull --rebase >> "$LOG" 2>&1 || echo "[$(date)] Pull failed" >> "$LOG"
  if git diff --quiet origin/main..HEAD 2>/dev/null; then
    echo "[$(date)] Nothing to push" >> "$LOG"
  else
    git push >> "$LOG" 2>&1 || echo "[$(date)] Push failed" >> "$LOG"
  fi

  echo "[$(date)] Done iteration $i, sleeping 1hr..." >> "$LOG"
  [ "$i" -lt "$MAX_ITERATIONS" ] && sleep 3600
done

echo "[$(date)] All $MAX_ITERATIONS iterations complete." >> "$LOG"
