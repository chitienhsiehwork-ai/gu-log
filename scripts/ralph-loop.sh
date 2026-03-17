#!/usr/bin/env bash
# Ralph Loop — Shell orchestrator for quality sweep
# Usage: ./ralph-loop.sh [RALPH_LIMIT]
#   ./ralph-loop.sh       → full sweep (all posts)
#   ./ralph-loop.sh 1     → process 1 post only (test)
#   ./ralph-loop.sh 5     → process 5 posts

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/ralph-helpers.sh

LIMIT="${1:-0}"
PROGRESS="scripts/ralph-progress.json"
QUEUE="scripts/ralph-queue.txt"
MAX_ATTEMPTS=3
PROCESSED=0

# Create per-run temp directory
RUN_ID="ralph-$(date +%Y%m%d-%H%M%S)"
RUN_DIR="/tmp/$RUN_ID"
mkdir -p "$RUN_DIR"

log_file="$RUN_DIR/ralph.log"
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$log_file"; }

# ==================== LOCK ====================
LOCKFILE="/tmp/ralph-loop.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  echo "ERROR: Another Ralph Loop is already running. Exiting."
  exit 1
fi

# ==================== PREFLIGHT CHECKS ====================
preflight_ok=true

# Validate limit is numeric
if [ "$LIMIT" != "0" ] && ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  log "ERROR: RALPH_LIMIT must be a number, got: $LIMIT"
  exit 1
fi

# Check required tools
for cmd in claude jq git pnpm node; do
  if ! command -v "$cmd" &>/dev/null; then
    log "ERROR: Required tool '$cmd' not found"
    preflight_ok=false
  fi
done

# Check scorer agent exists
if [ ! -f ".claude/agents/ralph-scorer.md" ]; then
  log "ERROR: Scorer agent not found at .claude/agents/ralph-scorer.md"
  preflight_ok=false
fi

# Check for clean git tree (warn, not block)
if [ -n "$(git status --porcelain)" ]; then
  log "WARN: Git tree is dirty. Unrelated files may get committed."
  log "  Dirty files: $(git status --porcelain | head -5)"
fi

# Abort if in rebase/merge state
if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
  log "ERROR: Git is in a rebase state. Resolve manually first."
  exit 1
fi

# Check progress file
if ! jq -e '.posts' "$PROGRESS" >/dev/null 2>&1; then
  log "ERROR: Invalid progress file: $PROGRESS"
  preflight_ok=false
fi

if [ "$preflight_ok" = false ]; then
  log "PREFLIGHT FAILED. Aborting."
  exit 1
fi

# Set startedAt if first run
if [ "$(jq -r '.startedAt // "null"' "$PROGRESS")" = "null" ]; then
  jq --arg ts "$(date -Iseconds)" '.startedAt = $ts' "$PROGRESS" > "${PROGRESS}.tmp" \
    && mv "${PROGRESS}.tmp" "$PROGRESS"
fi

# ==================== MAIN LOOP ====================
mapfile -t POSTS < <(sed '/^[[:space:]]*$/d' "$QUEUE")  # strip blank lines
TOTAL=${#POSTS[@]}
log "Ralph Loop starting. Queue: $TOTAL posts. Limit: $([ "$LIMIT" -gt 0 ] && echo "$LIMIT" || echo "unlimited"). Run: $RUN_ID"

for POST_FILE in "${POSTS[@]}"; do
  # Strip trailing CR/whitespace
  POST_FILE=$(echo "$POST_FILE" | tr -d '\r' | xargs)

  # Check limit
  if [ "$LIMIT" -gt 0 ] && [ "$PROCESSED" -ge "$LIMIT" ]; then
    log "RALPH_LIMIT=$LIMIT reached. Stopping."
    break
  fi

  # Skip if already processed
  STATUS=$(jq -r --arg f "$POST_FILE" '.posts[$f].status // "PENDING"' "$PROGRESS")
  if [ "$STATUS" = "PASS" ] || [[ "$STATUS" =~ TRIED|SKIPPED ]]; then
    continue
  fi

  POST_PATH="src/content/posts/$POST_FILE"
  EN_PATH="src/content/posts/en-$POST_FILE"
  if [ ! -f "$POST_PATH" ]; then
    log "WARN: File not found: $POST_PATH — marking SKIPPED"
    jq --arg f "$POST_FILE" --arg ts "$(date -Iseconds)" \
      '.posts[$f] = { status: "SKIPPED", timestamp: $ts }' \
      "$PROGRESS" > "${PROGRESS}.tmp" && mv "${PROGRESS}.tmp" "$PROGRESS"
    continue
  fi

  TICKET_ID=$(get_ticket_id "$POST_PATH")
  [ -z "$TICKET_ID" ] && TICKET_ID="unknown-$(basename "$POST_FILE" .mdx)"
  log "=== Processing $TICKET_ID ($POST_FILE) ==="

  # Per-post temp dir
  POST_DIR="$RUN_DIR/$TICKET_ID"
  mkdir -p "$POST_DIR"

  ATTEMPT=0
  PASSED=false
  SCORE_P=0; SCORE_C=0; SCORE_V=0
  FAILURE_TYPE=""
  LAST_BUILD_ERROR=""

  while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
    ATTEMPT=$((ATTEMPT + 1))
    SCORE_FILE="$POST_DIR/score-attempt-${ATTEMPT}.json"
    log "  Attempt $ATTEMPT/$MAX_ATTEMPTS — Scoring..."

    # Score via independent subagent
    if bash scripts/ralph-scorer.sh "$POST_FILE" "$SCORE_FILE" \
        > "$POST_DIR/scorer-stdout-${ATTEMPT}.txt" \
        2> "$POST_DIR/scorer-stderr-${ATTEMPT}.txt"; then
      read_scores "$SCORE_FILE"
      log "  Scores: P=$SCORE_P C=$SCORE_C V=$SCORE_V"

      # Check if passed
      if [ "$SCORE_P" -ge 9 ] && [ "$SCORE_C" -ge 9 ] && [ "$SCORE_V" -ge 9 ]; then
        PASSED=true
        log "  ✅ PASS"
        break
      fi
    else
      log "  Scorer failed (attempt $ATTEMPT). See $POST_DIR/scorer-stderr-${ATTEMPT}.txt"
      FAILURE_TYPE="SCORER_ERROR"
      continue
    fi

    # Not passed — rewrite if we have attempts left
    if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
      log "  Rewriting (writer reads reviewer feedback)..."

      # Build error feedback from previous attempt (if any)
      BUILD_FEEDBACK=""
      if [ -n "$LAST_BUILD_ERROR" ]; then
        BUILD_FEEDBACK="
## Previous Build Error (FIX THIS)
Your last rewrite caused a build error:
$LAST_BUILD_ERROR
Fix the syntax issue this time."
      fi

      # Writer agent — reads scorer feedback and scoring standard
      if claude -p \
        --model claude-opus-4-6 \
        --permission-mode bypassPermissions \
        --max-turns 20 \
        "You are a rewriter for gu-log blog posts. Your job is to improve a post that failed quality review.

## References (read ALL before rewriting)
1. Read scripts/ralph-vibe-scoring-standard.md — THE scoring rubric with calibration examples
2. Read TRANSLATION_PROMPT.md — LHY persona and style rules
3. Read CONTRIBUTING.md — frontmatter schema, ClawdNote format
4. Read the reviewer's feedback: cat $SCORE_FILE
$BUILD_FEEDBACK
## Task
Rewrite src/content/posts/$POST_FILE to fix EVERY issue the reviewer flagged.
Also create/rewrite the English version at $EN_PATH with lang: en and same ticketId.

## Rules
- Keep ALL existing frontmatter fields intact (ticketId, source, sourceUrl, title, summary, tags, lang, dates, translatedBy)
- Only update translatedBy.model using: node scripts/detect-model.mjs claude-opus-4-6
- ALL notes must be ClawdNote (convert any CodexNote/GeminiNote/ClaudeCodeNote)
- Import ONLY ClawdNote from components (remove unused imports)
- Apply full LHY persona — professor teaching with life analogies, not news article
- ClawdNote density: ~1 per 25 lines of prose, each with personality and opinion
- No bullet-dump endings, no motivational closings, no 「各位觀眾好」openings
- Kaomoji: sprinkle naturally, avoid markdown special chars" \
        > "$POST_DIR/writer-stdout-${ATTEMPT}.txt" 2>&1; then
        log "  Writer completed."
      else
        log "  Writer errored. See $POST_DIR/writer-stdout-${ATTEMPT}.txt"
        FAILURE_TYPE="WRITER_ERROR"
      fi

      # Shell-level build check
      log "  Running build check..."
      if ! pnpm run build > "$POST_DIR/build-${ATTEMPT}.txt" 2>&1; then
        LAST_BUILD_ERROR=$(tail -20 "$POST_DIR/build-${ATTEMPT}.txt")
        log "  ❌ Build failed! See $POST_DIR/build-${ATTEMPT}.txt"
        log "  Reverting post changes..."
        # Revert tracked changes
        git checkout -- "$POST_PATH" 2>/dev/null || true
        git checkout -- "$EN_PATH" 2>/dev/null || true
        # Remove untracked en file if writer just created it
        if ! git ls-files --error-unmatch "$EN_PATH" &>/dev/null; then
          rm -f "$EN_PATH"
        fi
        FAILURE_TYPE="BUILD_ERROR"
        continue
      fi
      LAST_BUILD_ERROR=""
      log "  Build passed."

      # Verify post was actually changed
      if git diff --quiet -- "$POST_PATH"; then
        log "  WARN: Writer didn't change the post. Wasted attempt."
      fi

      # Verify en file exists
      if [ ! -f "$EN_PATH" ]; then
        log "  WARN: English version still missing after rewrite"
      fi
    fi
  done

  # Determine final status
  if [ "$PASSED" = true ]; then
    RESULT_STATUS="PASS"
  elif [ -n "$FAILURE_TYPE" ]; then
    RESULT_STATUS="$FAILURE_TYPE"
  else
    RESULT_STATUS="OPUS46_TRIED_3_TIMES"
  fi

  # Commit FIRST, then update progress (atomic ordering)
  log "  Committing ($RESULT_STATUS)..."
  git add -- "$POST_PATH" "$EN_PATH" 2>/dev/null || true

  COMMITTED=false
  if git diff --cached --quiet; then
    log "  Nothing to commit (post unchanged or PASS on first score)"
  else
    if git commit -m "ralph: $TICKET_ID — $RESULT_STATUS (P:$SCORE_P C:$SCORE_C V:$SCORE_V)"; then
      COMMITTED=true
    else
      log "  ❌ Git commit failed! Marking as GIT_ERROR."
      RESULT_STATUS="GIT_ERROR"
      git reset HEAD -- "$POST_PATH" "$EN_PATH" 2>/dev/null || true
    fi
  fi

  # NOW update progress (after successful commit or on PASS-without-changes)
  jq --arg f "$POST_FILE" \
     --arg t "$TICKET_ID" \
     --arg s "$RESULT_STATUS" \
     --argjson p "$SCORE_P" \
     --argjson c "$SCORE_C" \
     --argjson v "$SCORE_V" \
     --argjson a "$ATTEMPT" \
     --arg ts "$(date -Iseconds)" \
     '(.posts[$f] // {}) * {
        ticketId: $t,
        status: $s,
        scores: { persona: $p, clawdNote: $c, vibe: $v },
        attempts: $a,
        timestamp: $ts
      } | .posts[$f] = . | .lastUpdated = $ts' \
     "$PROGRESS" > "${PROGRESS}.tmp" && mv "${PROGRESS}.tmp" "$PROGRESS" || {
    # jq syntax above is tricky — fallback to simple overwrite
    jq --arg f "$POST_FILE" \
       --arg t "$TICKET_ID" \
       --arg s "$RESULT_STATUS" \
       --argjson p "$SCORE_P" \
       --argjson c "$SCORE_C" \
       --argjson v "$SCORE_V" \
       --argjson a "$ATTEMPT" \
       --arg ts "$(date -Iseconds)" \
       '.posts[$f] = {
          ticketId: $t,
          status: $s,
          scores: { persona: $p, clawdNote: $c, vibe: $v },
          attempts: $a,
          timestamp: $ts
        } | .lastUpdated = $ts' \
       "$PROGRESS" > "${PROGRESS}.tmp" && mv "${PROGRESS}.tmp" "$PROGRESS"
  }

  # Recompute stats from posts (idempotent)
  recompute_stats "$PROGRESS"

  # Commit progress update
  git add -- "$PROGRESS"
  git commit -m "ralph: update progress — $TICKET_ID $RESULT_STATUS" --no-verify 2>/dev/null || true

  # Push
  if ! git push 2>/dev/null; then
    log "  ❌ Git push failed! Attempting pull --rebase..."
    if git pull --rebase && git push; then
      log "  Push recovered after rebase."
    else
      log "  ❌ Rebase/push failed. Aborting rebase and stopping loop."
      git rebase --abort 2>/dev/null || true
      break
    fi
  fi

  PROCESSED=$((PROCESSED + 1))
  log "  Done. Processed: $PROCESSED$([ "$LIMIT" -gt 0 ] && echo "/$LIMIT" || echo "")"
done

# Final summary
recompute_stats "$PROGRESS"
PASSED_COUNT=$(jq '.stats.passed' "$PROGRESS")
FAILED_COUNT=$(jq '.stats.failed' "$PROGRESS")
REWRITTEN_COUNT=$(jq '.stats.rewritten' "$PROGRESS")
TOTAL_PROCESSED=$(jq '.stats.processed' "$PROGRESS")

# Check for unpushed commits
UNPUSHED=$(git log --oneline '@{u}..HEAD' 2>/dev/null | wc -l || echo "?")

log "=== Ralph Loop Complete ==="
log "Processed this run: $PROCESSED"
log "Total processed: $TOTAL_PROCESSED | Passed: $PASSED_COUNT | Rewritten: $REWRITTEN_COUNT | Failed: $FAILED_COUNT"
log "Unpushed commits: $UNPUSHED"
log "Run log: $log_file"
