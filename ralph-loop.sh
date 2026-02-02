#!/usr/bin/env bash
# Ralph Loop for gu-log
# Usage: ./ralph-loop.sh [max_iterations]
# Default: 10 iterations (each = one CC session tackling one task)

set -euo pipefail

MAX_ITERATIONS=${1:-10}
LOOP_DIR=".ralph"
LOG_FILE="$LOOP_DIR/loop.log"
PROMPT_FILE="$LOOP_DIR/prompt.md"

mkdir -p "$LOOP_DIR"

# The prompt CC gets each iteration
cat > "$PROMPT_FILE" << 'PROMPT'
Read CLAUDE.md and TODO.json. Then:

1. Find the highest priority task with status "pending" that has no unmet depends_on (all deps must be "done")
2. If no eligible tasks remain, create a file .ralph/DONE and exit immediately
3. Update the task's status to "in_progress" in TODO.json
4. Do the work
5. Run `npm run build` to verify no rendering errors
6. Update the task's status to "done" in TODO.json
7. Stage all changed files and commit with a descriptive message
8. Push to origin/main

IMPORTANT:
- Only do ONE task per session, then exit
- If the build fails, fix it before committing
- If you're stuck on a task for more than 10 minutes, mark it "blocked" with a note in the description, commit TODO.json, and exit
- Do NOT start a second task — just finish one and exit cleanly
PROMPT

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== Ralph Loop started: max $MAX_ITERATIONS iterations ==="

for i in $(seq 1 "$MAX_ITERATIONS"); do
  log "--- Iteration $i/$MAX_ITERATIONS ---"

  # Check if all tasks are done
  if [ -f "$LOOP_DIR/DONE" ]; then
    log "All tasks completed! Exiting loop."
    break
  fi

  # Check if there are any pending tasks left
  pending_count=$(python3 -c "
import json
with open('TODO.json') as f:
    tasks = json.load(f)['tasks']
pending = [t for t in tasks if t['status'] == 'pending']
print(len(pending))
" 2>/dev/null || echo "?")
  log "Pending tasks: $pending_count"

  if [ "$pending_count" = "0" ]; then
    log "No more pending tasks. Done!"
    break
  fi

  # Run Claude Code with the prompt (headless, non-interactive)
  log "Launching Claude Code session..."
  if claude --print --dangerously-skip-permissions < "$PROMPT_FILE" >> "$LOG_FILE" 2>&1; then
    log "Session completed successfully."
  else
    log "Session exited with error (code $?). Continuing to next iteration..."
  fi

  # Brief pause between iterations
  sleep 5
done

log "=== Ralph Loop finished ==="
echo ""
echo "Check $LOG_FILE for full output."
echo "Check TODO.json for task statuses."
