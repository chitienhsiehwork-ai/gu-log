#!/usr/bin/env bash
# Mogu Picks — periodic autonomous candidate-to-production loop.
# Usage: ./scripts/mogu-picks-loop.sh [max_iterations]

set -euo pipefail

MAX_ITERATIONS=${1:-24}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$REPO_DIR/scripts/mogu-picks.log"
PROMPT='Read scripts/mogu-picks-prompt.md and follow it exactly. Do not ask non-critical questions. Only emit the completion promise after the MP article is verified in production.'

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo "[$(date)] Mogu Picks iteration $i/$MAX_ITERATIONS" >> "$LOG"

  yolo-cc -w "$REPO_DIR" --ralph --max-iterations 3 \
    --completion-promise "MOGU PICK PUBLISHED" \
    "$PROMPT" \
    >> "$LOG" 2>&1 || {
      echo "[$(date)] Mogu Picks worker failed on iteration $i" >> "$LOG"
    }

  # The worker owns branch/PR/CI/merge/deploy per the repo playbook. Do not
  # pull, push, or switch branches behind its back from this supervisor.
  echo "[$(date)] Iteration $i finished" >> "$LOG"
  [ "$i" -lt "$MAX_ITERATIONS" ] && sleep 3600
done

echo "[$(date)] All $MAX_ITERATIONS Mogu Picks iterations complete." >> "$LOG"
