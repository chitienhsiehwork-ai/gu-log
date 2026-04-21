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

# Branch / PR workflow mode — default "pr" per gu-log/CLAUDE.md branch policy
# (2026-04-22 onwards). Each post rewrite goes on its own ralph/<ticket>-<ts>
# branch + draft PR. Escape hatch: RALPH_BRANCH_MODE=main pushes straight to
# main as the legacy behavior.
RALPH_BRANCH_MODE="${RALPH_BRANCH_MODE:-pr}"
RALPH_BASE_BRANCH="${RALPH_BASE_BRANCH:-main}"

# Create per-run temp directory + persistent log location
RUN_ID="ralph-$(date +%Y%m%d-%H%M%S)"
RUN_DIR=".ralph/runs/$RUN_ID"
LOG_DIR=".ralph/log"
mkdir -p "$RUN_DIR" "$LOG_DIR"

log_file="$RUN_DIR/ralph.log"
current_log="$LOG_DIR/ralph-current.log"
log() {
  local msg="[$(date '+%H:%M:%S')] $*"
  echo "$msg" | tee -a "$log_file" >> "$current_log"
}

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
if [ ! -f ".claude/agents/vibe-opus-scorer.md" ]; then
  log "ERROR: Scorer agent not found at .claude/agents/vibe-opus-scorer.md"
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
# Validate queue file exists and is non-empty
if [ ! -f "$QUEUE" ] || [ ! -r "$QUEUE" ]; then
  log "ERROR: Queue file missing or unreadable: $QUEUE"
  exit 1
fi
mapfile -t POSTS < <(sed '/^[[:space:]]*$/d' "$QUEUE")  # strip blank lines
TOTAL=${#POSTS[@]}
if [ "$TOTAL" -eq 0 ]; then
  log "ERROR: Queue is empty. Nothing to process."
  exit 1
fi
log "Ralph Loop starting. Queue: $TOTAL posts. Limit: $([ "$LIMIT" -gt 0 ] && echo "$LIMIT" || echo "unlimited"). Run: $RUN_ID"

for POST_FILE in "${POSTS[@]}"; do
  # Strip trailing CR/whitespace
  POST_FILE=$(echo "$POST_FILE" | tr -d '\r' | xargs)

  # ==================== QUIET HOURS (weekday 20:00-02:00 TST, skip weekends) ====================
  # Peak hours = Mon-Fri 20:00-02:00 TST only. Weekends are all off-peak → run 24/7.
  CURRENT_HOUR=$(TZ=Asia/Taipei date +%H)
  CURRENT_DOW=$(TZ=Asia/Taipei date +%u)  # 1=Mon ... 7=Sun
  IS_PEAK=false
  if [ "$CURRENT_HOUR" -ge 20 ]; then
    # 20:00-23:59 — peak on Mon-Fri nights (DOW 1-5)
    [ "$CURRENT_DOW" -ge 1 ] && [ "$CURRENT_DOW" -le 5 ] && IS_PEAK=true
  elif [ "$CURRENT_HOUR" -lt 2 ]; then
    # 00:00-01:59 — tail of last night's peak
    # Peak if today is Tue-Sat (last night was Mon-Fri)
    [ "$CURRENT_DOW" -ge 2 ] && [ "$CURRENT_DOW" -le 6 ] && IS_PEAK=true
  fi
  if [ "$IS_PEAK" = true ]; then
    NOW_EPOCH=$(date +%s)
    if [ "$CURRENT_HOUR" -ge 20 ]; then
      RESUME_AT=$(TZ=Asia/Taipei date -d "tomorrow 02:00" +%s)
    else
      RESUME_AT=$(TZ=Asia/Taipei date -d "today 02:00" +%s)
    fi
    SLEEP_SECS=$((RESUME_AT - NOW_EPOCH))
    SLEEP_HRS=$(( (SLEEP_SECS + 59) / 3600 ))
    log "💤 Peak hours (weekday 20:00-02:00 TST). Sleeping ${SLEEP_SECS}s (~${SLEEP_HRS}hr) until 02:00..."
    sleep "$SLEEP_SECS"
    log "⏰ Waking up! Resuming loop."
  fi

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

  # PR-mode safety gates
  if [ "$RALPH_BRANCH_MODE" = "pr" ]; then
    # Ensure we start from base branch — prevents cross-branch pollution if a
    # previous iteration didn't clean up properly.
    CURRENT_B=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$CURRENT_B" != "$RALPH_BASE_BRANCH" ]; then
      log "  WARN: On $CURRENT_B, expected $RALPH_BASE_BRANCH. Switching back first."
      git checkout "$RALPH_BASE_BRANCH" 2>/dev/null || {
        log "  ❌ Cannot switch to $RALPH_BASE_BRANCH (dirty tree?). Skipping post."
        continue
      }
    fi

    # Skip if there's already an open PR for this ticket — prevents duplicate
    # rewrite attempts while a prior PR is still awaiting review/merge.
    if command -v gh >/dev/null 2>&1; then
      existing_pr=$(gh pr list --state open --search "ralph $TICKET_ID in:title" \
        --json number --jq '.[0].number' 2>/dev/null || echo "")
      if [ -n "$existing_pr" ]; then
        log "  Open PR #$existing_pr exists for $TICKET_ID — skipping (merge that first to retry)"
        continue
      fi
    fi
  fi

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
    if bash scripts/vibe-scorer.sh "$POST_FILE" "$SCORE_FILE" \
        > "$POST_DIR/scorer-stdout-${ATTEMPT}.txt" \
        2> "$POST_DIR/scorer-stderr-${ATTEMPT}.txt"; then
      read_scores "$SCORE_FILE"
      log "  Scores: P=$SCORE_P C=$SCORE_C V=$SCORE_V"

      # Check if passed
      if [ "$SCORE_P" -ge 8 ] && [ "$SCORE_C" -ge 8 ] && [ "$SCORE_V" -ge 8 ]; then
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

      # Snapshot current post state BEFORE writer runs. On build failure we
      # restore from this snapshot instead of `git checkout -- POST_PATH`,
      # which would wipe out successful prior-attempt rewrites that haven't
      # been committed yet. Without this, a writer error in attempt N throws
      # away a valid rewrite from attempt N-1.
      cp -f "$POST_PATH" "$POST_DIR/post-pre-attempt-${ATTEMPT}.mdx"
      [ -f "$EN_PATH" ] && cp -f "$EN_PATH" "$POST_DIR/en-post-pre-attempt-${ATTEMPT}.mdx" || true

      # Build error feedback from previous attempt (if any)
      BUILD_FEEDBACK=""
      if [ -n "$LAST_BUILD_ERROR" ]; then
        BUILD_FEEDBACK="
## Previous Build Error (FIX THIS)
Your last rewrite caused a build error:
$LAST_BUILD_ERROR
Fix the syntax issue this time.

## MDX Syntax Traps (avoid these — they cause build errors)
- JSX attributes: NO space before \`=\`. Write \`<Tag attr=\"v\">\` NOT \`<Tag attr =\"v\">\` or \`<Tag =\"v\">\`
- Component self-close: \`<ClawdNote>...content...</ClawdNote>\` or \`<ClawdNote/>\` (never leave unclosed)
- Literal \`<\` or \`>\` in prose: escape as \`&lt;\` / \`&gt;\` OR wrap in backticks
- Curly braces \`{...}\` in prose = JSX expression; escape with backslash or wrap in backticks
- Imports must be at the top of file, immediately after frontmatter closing \`---\`"
      fi

      # Writer agent — reads scorer feedback and scoring standard
      # Timeout: 15 minutes per rewrite (complex rewrites can take 5-10min)
      if timeout 900 claude -p \
        --model claude-opus-4-6 \
        --permission-mode bypassPermissions \
        --max-turns 20 \
        "You are a rewriter for gu-log blog posts. Your job is to improve a post that failed quality review.

## References (read ALL before rewriting)
1. Read scripts/vibe-scoring-standard.md — THE scoring rubric with calibration examples
2. Read WRITING_GUIDELINES.md — LHY persona and style rules
3. Read CONTRIBUTING.md — frontmatter schema, ClawdNote format
4. Read the reviewer's feedback: cat $SCORE_FILE
$BUILD_FEEDBACK
## Task
Rewrite src/content/posts/$POST_FILE to fix EVERY issue the reviewer flagged.
Also create/rewrite the English version at $EN_PATH with lang: en and same ticketId.

## Rules
- Keep ALL existing frontmatter fields intact (ticketId, source, sourceUrl, title, summary, tags, lang, dates)
- Do NOT touch translatedBy — shell handles that automatically
- ALL notes must be ClawdNote (convert any CodexNote/GeminiNote/ClaudeCodeNote)
- Import ONLY ClawdNote from components (remove unused imports)
- Apply full LHY persona — professor teaching with life analogies, not news article
- ClawdNote density: ~1 per 25 lines of prose, each with personality and opinion
- No bullet-dump endings, no motivational closings, no 「各位觀眾好」openings
- Kaomoji: MANDATORY — pre-commit hook rejects posts without at least one kaomoji. Sprinkle naturally in prose, avoid markdown special chars (backticks, asterisks)" \
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
        log "  Reverting to pre-attempt-${ATTEMPT} snapshot (keeps prior valid rewrite)..."
        # Restore from attempt-N snapshot instead of HEAD — preserves successful
        # prior-attempt rewrites that haven't been committed.
        cp -f "$POST_DIR/post-pre-attempt-${ATTEMPT}.mdx" "$POST_PATH"
        if [ -f "$POST_DIR/en-post-pre-attempt-${ATTEMPT}.mdx" ]; then
          cp -f "$POST_DIR/en-post-pre-attempt-${ATTEMPT}.mdx" "$EN_PATH"
        elif ! git ls-files --error-unmatch "$EN_PATH" &>/dev/null; then
          # No snapshot and not tracked → writer created it broken, remove
          rm -f "$EN_PATH"
        fi
        FAILURE_TYPE="BUILD_ERROR"
        continue
      fi
      LAST_BUILD_ERROR=""
      log "  Build passed."

      # Ensure kaomoji present (pre-commit hook requires it)
      node scripts/add-kaomoji.mjs --write "$POST_FILE" 2>/dev/null || true
      [ -f "$EN_PATH" ] && node scripts/add-kaomoji.mjs --write "en-$POST_FILE" 2>/dev/null || true

      # Stamp Ralph pipeline signature (shell-level, not LLM tokens)
      stamp_ralph_signature "$POST_PATH"
      [ -f "$EN_PATH" ] && stamp_ralph_signature "$EN_PATH"

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

  # PR mode: if the post has content change, branch off before committing.
  # Empty-diff cases (PASS on first score, no rewrite) stay on base and just
  # push a progress-only commit.
  POST_BRANCH=""
  if [ "$RALPH_BRANCH_MODE" = "pr" ]; then
    if ! git diff --quiet -- "$POST_PATH" "$EN_PATH" 2>/dev/null; then
      POST_BRANCH="ralph/$TICKET_ID-$(date +%Y%m%d-%H%M%S)"
      log "  Creating branch $POST_BRANCH from $RALPH_BASE_BRANCH"
      if ! git checkout -b "$POST_BRANCH" 2>/dev/null; then
        log "  ❌ Branch creation failed — falling back to main-mode commit"
        POST_BRANCH=""
      fi
    fi
  fi

  git add -- "$POST_PATH" 2>/dev/null || true
  [ -f "$EN_PATH" ] && git add -- "$EN_PATH" 2>/dev/null || true

  COMMITTED=false
  if git diff --cached --quiet; then
    log "  Nothing to commit (post unchanged or PASS on first score)"
  else
    if git commit --no-verify -m "ralph: $TICKET_ID — $RESULT_STATUS (P:$SCORE_P C:$SCORE_C V:$SCORE_V)"; then
      COMMITTED=true
    else
      log "  ❌ Git commit failed! Marking as GIT_ERROR."
      RESULT_STATUS="GIT_ERROR"
      # Unstage AND restore working tree to prevent dirty-tree cascade
      git checkout -- "$POST_PATH" 2>/dev/null || true
      git checkout -- "$EN_PATH" 2>/dev/null || true
      if ! git ls-files --error-unmatch "$EN_PATH" &>/dev/null 2>&1; then
        rm -f "$EN_PATH"
      fi
    fi
  fi

  # NOW update progress (after successful commit or on PASS-without-changes)
  # CRITICAL: assign into .posts[$f] keeping root context intact
  jq --arg f "$POST_FILE" \
     --arg t "$TICKET_ID" \
     --arg s "$RESULT_STATUS" \
     --argjson p "$SCORE_P" \
     --argjson c "$SCORE_C" \
     --argjson v "$SCORE_V" \
     --argjson a "$ATTEMPT" \
     --arg ts "$(date -Iseconds)" \
     '.posts[$f] = ((.posts[$f] // {}) + {
        ticketId: $t,
        status: $s,
        scores: { persona: $p, clawdNote: $c, vibe: $v },
        attempts: $a,
        timestamp: $ts
      }) | .lastUpdated = $ts' \
     "$PROGRESS" > "${PROGRESS}.tmp" && mv "${PROGRESS}.tmp" "$PROGRESS"

  # Recompute stats from posts (idempotent)
  recompute_stats "$PROGRESS"

  # Commit progress update (ONLY progress file — clear any leftover staged content)
  git reset HEAD -- . 2>/dev/null || true
  git add -- "$PROGRESS"
  git commit -m "ralph: update progress — $TICKET_ID $RESULT_STATUS" --no-verify 2>/dev/null || true

  # Push — branch mode opens a draft PR, main mode is the legacy behavior
  if [ -n "$POST_BRANCH" ]; then
    if git push -u origin "$POST_BRANCH" 2>/dev/null; then
      log "  Branch $POST_BRANCH pushed to origin"
      if command -v gh >/dev/null 2>&1; then
        PR_BODY="Auto-generated by ralph-loop on $(date -Iseconds).

- **Ticket**: \`$TICKET_ID\`
- **Status**: \`$RESULT_STATUS\`
- **Scores**: persona=$SCORE_P · clawdNote=$SCORE_C · vibe=$SCORE_V
- **Attempts**: $ATTEMPT / $MAX_ATTEMPTS
- **Run log**: \`$log_file\`

Draft — review the scorer verdict + rewrite diff, then mark ready + merge.
Progress file update (\`scripts/ralph-progress.json\`) ships on merge."
        PR_URL=$(gh pr create --draft \
          --base "$RALPH_BASE_BRANCH" \
          --head "$POST_BRANCH" \
          --title "ralph: $TICKET_ID — $RESULT_STATUS (P:$SCORE_P C:$SCORE_C V:$SCORE_V)" \
          --body "$PR_BODY" 2>&1 | grep -Eo 'https://github\.com[^ ]+' | head -1) || PR_URL=""
        if [ -n "$PR_URL" ]; then
          log "  📝 Draft PR: $PR_URL"
        else
          log "  ⚠️  PR creation failed — branch pushed, open PR manually"
        fi
      else
        log "  ⚠️  gh CLI not available — branch pushed, open PR manually"
      fi
    else
      log "  ❌ Branch push failed for $POST_BRANCH — local commits retained"
    fi
    # Return to base branch before next iteration (both success and failure paths)
    git checkout "$RALPH_BASE_BRANCH" 2>/dev/null || true
  else
    # Main-mode push (legacy behavior, or empty-diff progress-only commit)
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
