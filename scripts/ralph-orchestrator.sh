#!/usr/bin/env bash
# ralph-orchestrator.sh — Fan-out Gemini+Codex in parallel, fan-in Opus
# Usage: ./scripts/ralph-orchestrator.sh [LIMIT_PER_JUDGE]
# LIMIT_PER_JUDGE defaults to 5 (how many posts each judge scores per run)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LIMIT="${1:-5}"
LOG_DIR="$ROOT_DIR/.score-loop/logs"
mkdir -p "$LOG_DIR"

ORCHESTRATOR_LOG="$LOG_DIR/orchestrator-$(TZ=Asia/Taipei date +%Y%m%d).log"

log() {
  local msg="[$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z')] [orchestrator] $*"
  echo "$msg" | tee -a "$ORCHESTRATOR_LOG"
}

# ─── Lock: only one orchestrator at a time ───
LOCK_FILE="/tmp/ralph-orchestrator.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Another orchestrator is already running. Exiting."
  exit 0
fi

# ─── Pre-flight: real quota check ───
source "$ROOT_DIR/scripts/score-helpers.sh"
source "$ROOT_DIR/scripts/quota-bridge.sh"

gemini_status="$(gemini_real_quota_check)"
codex_status="$(codex_real_quota_check)"
claude_status="$(claude_real_quota_check)"

log "Quota pre-flight: Gemini=$gemini_status, Codex=$codex_status, Claude=$claude_status"

# "ok" or "sleep:N" means the judge can run (engine handles sleep internally)
# Only "exhausted" means truly unavailable
can_run() { [ "$1" = "ok" ] || [[ "$1" == sleep:* ]]; }

if ! can_run "$gemini_status" && ! can_run "$codex_status"; then
  log "Both Gemini and Codex unavailable (exhausted). Nothing to do."
  exit 0
fi

# ─── Phase 1: Fan-out Gemini + Codex in parallel ───
GEMINI_PID=""
CODEX_PID=""
GEMINI_EXIT=0
CODEX_EXIT=0

if can_run "$gemini_status"; then
  log "Starting Gemini judge (limit=$LIMIT, status=$gemini_status)..."
  bash "$ROOT_DIR/scripts/score-loop-engine.sh" gemini "$LIMIT" >> "$ORCHESTRATOR_LOG" 2>&1 &
  GEMINI_PID=$!
  log "Gemini PID=$GEMINI_PID"
else
  log "Skipping Gemini ($gemini_status)"
fi

if can_run "$codex_status"; then
  log "Starting Codex judge (limit=$LIMIT, status=$codex_status)..."
  bash "$ROOT_DIR/scripts/score-loop-engine.sh" codex "$LIMIT" >> "$ORCHESTRATOR_LOG" 2>&1 &
  CODEX_PID=$!
  log "Codex PID=$CODEX_PID"
else
  log "Skipping Codex ($codex_status)"
fi

# Wait for both to finish
if [ -n "$GEMINI_PID" ]; then
  wait "$GEMINI_PID" || GEMINI_EXIT=$?
  log "Gemini finished (exit=$GEMINI_EXIT)"
fi

if [ -n "$CODEX_PID" ]; then
  wait "$CODEX_PID" || CODEX_EXIT=$?
  log "Codex finished (exit=$CODEX_EXIT)"
fi

# ─── Phase 2: Fan-in — Opus scores posts that have both Gemini + Codex ───
# Re-check Claude quota (may have changed during Phase 1)
quota_invalidate_cache
claude_status="$(claude_real_quota_check)"
log "Claude quota for Opus phase: $claude_status"

if can_run "$claude_status"; then
  # Check if there are posts ready for Opus (have both Gemini + Codex but no Opus)
  source "$ROOT_DIR/scripts/judges/opus.sh"
  mapfile -t OPUS_QUEUE < <(judge_build_queue)
  OPUS_READY="${#OPUS_QUEUE[@]}"

  if [ "$OPUS_READY" -gt 0 ]; then
    OPUS_LIMIT="$LIMIT"
    [ "$OPUS_READY" -lt "$OPUS_LIMIT" ] && OPUS_LIMIT="$OPUS_READY"
    log "Starting Opus judge ($OPUS_READY posts ready, limit=$OPUS_LIMIT)..."
    bash "$ROOT_DIR/scripts/score-loop-engine.sh" opus "$OPUS_LIMIT" >> "$ORCHESTRATOR_LOG" 2>&1
    OPUS_EXIT=$?
    log "Opus finished (exit=$OPUS_EXIT)"
  else
    log "No posts ready for Opus (need both Gemini + Codex scores first)"
  fi
else
  log "Skipping Opus ($claude_status)"
fi

# ─── Summary ───
log "Orchestrator complete. Check individual judge logs for details."

# Count scores added this run
TODAY_STAMP="$(TZ=Asia/Taipei date +%Y%m%d)"
GEMINI_COUNT="$(grep -c "Recorded.*=> score" "$LOG_DIR/gemini-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
CODEX_COUNT="$(grep -c "Recorded.*=> score" "$LOG_DIR/codex-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
OPUS_COUNT="$(grep -c "Recorded.*=> score" "$LOG_DIR/opus-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"

log "Today's totals: Gemini=$GEMINI_COUNT, Codex=$CODEX_COUNT, Opus=$OPUS_COUNT"
