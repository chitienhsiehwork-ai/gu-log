#!/usr/bin/env bash
# Ralph Loop — Shell orchestrator for quality sweep
# Usage: ./ralph-loop.sh [RALPH_LIMIT]
#   ./ralph-loop.sh       → full sweep (all posts)
#   ./ralph-loop.sh 1     → process 1 post only (test)
#   ./ralph-loop.sh 5     → process 5 posts
#
# Each iteration:
#   1. Score via ralph-scorer subagent (claude -p --agent ralph-scorer)
#   2. If ≥9/9/9 → PASS
#   3. If <9 → Rewrite via writer agent (claude -p)
#   4. Re-score → loop up to 3 attempts
#   5. Commit + push
#   6. Next post

set -euo pipefail
cd "$(dirname "$0")/.."

LIMIT="${1:-0}"  # 0 = no limit
PROGRESS="scripts/ralph-progress.json"
QUEUE="scripts/ralph-queue.txt"
MAX_ATTEMPTS=3
PROCESSED=0

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Initialize progress if empty
if ! jq -e '.posts' "$PROGRESS" >/dev/null 2>&1; then
  log "ERROR: Invalid progress file"
  exit 1
fi

# Read queue
mapfile -t POSTS < "$QUEUE"
TOTAL=${#POSTS[@]}
log "Ralph Loop starting. Queue: $TOTAL posts. Limit: ${LIMIT:-unlimited}"

for POST_FILE in "${POSTS[@]}"; do
  # Check limit
  if [ "$LIMIT" -gt 0 ] && [ "$PROCESSED" -ge "$LIMIT" ]; then
    log "RALPH_LIMIT=$LIMIT reached. Stopping."
    break
  fi

  # Skip if already processed
  STATUS=$(jq -r --arg f "$POST_FILE" '.posts[$f].status // "PENDING"' "$PROGRESS")
  if [ "$STATUS" = "PASS" ] || [ "$STATUS" = "OPUS46_TRIED_3_TIMES" ]; then
    log "SKIP $POST_FILE ($STATUS)"
    continue
  fi

  POST_PATH="src/content/posts/$POST_FILE"
  if [ ! -f "$POST_PATH" ]; then
    log "WARN: File not found: $POST_PATH, skipping"
    continue
  fi

  TICKET_ID=$(grep -m1 'ticketId' "$POST_PATH" | grep -o '"[^"]*"' | tr -d '"' || echo "unknown")
  log "=== Processing $TICKET_ID ($POST_FILE) ==="

  ATTEMPT=0
  PASSED=false

  while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
    ATTEMPT=$((ATTEMPT + 1))
    log "  Attempt $ATTEMPT/$MAX_ATTEMPTS — Scoring..."

    # Score via independent subagent
    rm -f "/tmp/ralph-score-${TICKET_ID}.json"
    bash scripts/ralph-scorer.sh "$POST_FILE" > /tmp/ralph-scorer-output.txt 2>&1 || true

    # Read scores
    SCORE_FILE="/tmp/ralph-score-${TICKET_ID}.json"
    if [ ! -f "$SCORE_FILE" ]; then
      log "  ERROR: Scorer failed to produce output. Retrying..."
      continue
    fi

    P_SCORE=$(jq -r '.scores.persona.score' "$SCORE_FILE" 2>/dev/null || echo "0")
    C_SCORE=$(jq -r '.scores.clawdNote.score' "$SCORE_FILE" 2>/dev/null || echo "0")
    V_SCORE=$(jq -r '.scores.vibe.score' "$SCORE_FILE" 2>/dev/null || echo "0")
    MEET_BAR=$(jq -r '.meetBar' "$SCORE_FILE" 2>/dev/null || echo "false")

    log "  Scores: P=$P_SCORE C=$C_SCORE V=$V_SCORE (meetBar=$MEET_BAR)"

    # Check if passed
    if [ "$P_SCORE" -ge 9 ] && [ "$C_SCORE" -ge 9 ] && [ "$V_SCORE" -ge 9 ]; then
      PASSED=true
      log "  ✅ PASS"
      break
    fi

    # Not passed — rewrite if we have attempts left
    if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
      log "  Rewriting (writer reads reviewer feedback)..."

      # Determine if en version exists
      EN_FILE="src/content/posts/en-$POST_FILE"
      EN_INSTRUCTION=""
      if [ -f "$EN_FILE" ]; then
        EN_INSTRUCTION="Also rewrite the English version at $EN_FILE to match."
      else
        EN_INSTRUCTION="Also create the English version at $EN_FILE with lang: en and same ticketId."
      fi

      # Writer agent — reads scorer feedback and rewrites
      claude -p \
        --model claude-opus-4-6 \
        --permission-mode bypassPermissions \
        --max-turns 20 \
        "You are a rewriter for gu-log blog posts. Your job is to improve a post that failed quality review.

## References (read these first)
1. Read TRANSLATION_PROMPT.md — LHY persona and style rules
2. Read CONTRIBUTING.md — frontmatter schema, ClawdNote format
3. Read the reviewer's feedback: cat $SCORE_FILE

## Task
Rewrite src/content/posts/$POST_FILE to fix EVERY issue the reviewer flagged.
$EN_INSTRUCTION

## Rules
- Keep ticketId, source, sourceUrl unchanged
- ALL notes must be ClawdNote (convert any CodexNote/GeminiNote)
- Import ONLY ClawdNote (remove unused imports)
- Apply full LHY persona — professor teaching, not news article
- ClawdNote density: ~1 per 25 lines of prose, each with personality
- No bullet-dump endings, no motivational closings
- Run 'pnpm run build 2>&1 | tail -5' after rewriting to verify no MDX errors
- Update translatedBy.model using: node scripts/detect-model.mjs claude-opus-4-6" \
        2>/dev/null || log "  WARN: Writer may have errored"
    fi
  done

  # Update progress
  if [ "$PASSED" = true ]; then
    RESULT_STATUS="PASS"
  elif [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    RESULT_STATUS="OPUS46_TRIED_3_TIMES"
  else
    RESULT_STATUS="ERROR"
  fi

  # Update progress JSON
  jq --arg f "$POST_FILE" \
     --arg t "$TICKET_ID" \
     --arg s "$RESULT_STATUS" \
     --argjson p "$P_SCORE" \
     --argjson c "$C_SCORE" \
     --argjson v "$V_SCORE" \
     --argjson a "$ATTEMPT" \
     --arg ts "$(date -Iseconds)" \
     '.posts[$f] = {
        ticketId: $t,
        status: $s,
        scores: { persona: $p, clawdNote: $c, vibe: $v },
        attempts: $a,
        timestamp: $ts
      } |
      .lastUpdated = $ts |
      .stats.processed += 1 |
      if $s == "PASS" then .stats.passed += 1
      elif $s == "OPUS46_TRIED_3_TIMES" then .stats.failed += 1
      else . end' \
     "$PROGRESS" > "${PROGRESS}.tmp" && mv "${PROGRESS}.tmp" "$PROGRESS"

  # Commit
  log "  Committing ($RESULT_STATUS)..."
  git add -A
  git commit -m "ralph: $TICKET_ID — $RESULT_STATUS (P:$P_SCORE C:$C_SCORE V:$V_SCORE)" --no-verify 2>/dev/null || true
  git push 2>/dev/null || log "  WARN: push failed, will retry next iteration"

  PROCESSED=$((PROCESSED + 1))
  log "  Done. Processed: $PROCESSED/${LIMIT:-∞}"
done

# Summary
PASSED_COUNT=$(jq '.stats.passed' "$PROGRESS")
FAILED_COUNT=$(jq '.stats.failed' "$PROGRESS")
TOTAL_PROCESSED=$(jq '.stats.processed' "$PROGRESS")
log "=== Ralph Loop Complete ==="
log "Processed: $TOTAL_PROCESSED | Passed: $PASSED_COUNT | Failed: $FAILED_COUNT"
