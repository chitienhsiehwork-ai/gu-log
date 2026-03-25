#!/usr/bin/env bash
# ralph-orchestrator.sh — Fan-out Gemini+Codex in parallel, fan-in Opus
#
# Modes:
#   ./scripts/ralph-orchestrator.sh [LIMIT]          — single round then exit
#   ./scripts/ralph-orchestrator.sh --daemon [LIMIT]  — loop forever, sleep between rounds
#
# LIMIT = posts per judge per round (default 5)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DAEMON=0
LIMIT=5

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --daemon) DAEMON=1; shift ;;
    *) LIMIT="$1"; shift ;;
  esac
done

LOG_DIR="$ROOT_DIR/.score-loop/logs"
mkdir -p "$LOG_DIR"

orchestrator_log() {
  echo "$LOG_DIR/orchestrator-$(TZ=Asia/Taipei date +%Y%m%d).log"
}

log() {
  local msg="[$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z')] [orchestrator] $*"
  echo "$msg" | tee -a "$(orchestrator_log)"
}

# ─── Lock: only one orchestrator at a time ───
LOCK_FILE="/tmp/ralph-orchestrator.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Another orchestrator is already running. Exiting."
  exit 0
fi

# ─── Helpers ───
source "$ROOT_DIR/scripts/score-helpers.sh"
source "$ROOT_DIR/scripts/quota-bridge.sh"

# "ok" or "sleep:N" means the judge can run (engine handles sleep internally)
# Only "exhausted" means truly unavailable
can_run() { [ "$1" = "ok" ] || [[ "$1" == sleep:* ]]; }

# Extract sleep seconds from status like "sleep:3600"
sleep_from_status() {
  local s="$1"
  if [[ "$s" == sleep:* ]]; then
    echo "${s#sleep:}"
  else
    echo "0"
  fi
}

run_one_round() {
  local round_log
  round_log="$(orchestrator_log)"

  # Pull latest scores from main
  git pull --rebase origin main >> "$round_log" 2>&1 || true

  # Invalidate quota cache for fresh check
  quota_invalidate_cache

  local gemini_status codex_status claude_status
  gemini_status="$(gemini_real_quota_check)"
  codex_status="$(codex_real_quota_check)"
  claude_status="$(claude_real_quota_check)"

  log "Quota: Gemini=$gemini_status, Codex=$codex_status, Claude=$claude_status"

  # ─── All exhausted? Return sleep hint ───
  if ! can_run "$gemini_status" && ! can_run "$codex_status"; then
    log "Both Gemini and Codex exhausted. Sleeping."
    # Return min wait time for daemon loop
    echo "wait"
    return 0
  fi

  # ─── Phase 1: Fan-out Gemini + Codex in parallel ───
  local GEMINI_PID="" CODEX_PID="" GEMINI_EXIT=0 CODEX_EXIT=0

  if can_run "$gemini_status"; then
    log "Starting Gemini judge (limit=$LIMIT)..."
    bash "$ROOT_DIR/scripts/score-loop-engine.sh" gemini "$LIMIT" >> "$round_log" 2>&1 &
    GEMINI_PID=$!
  else
    log "Skipping Gemini ($gemini_status)"
  fi

  if can_run "$codex_status"; then
    log "Starting Codex judge (limit=$LIMIT)..."
    bash "$ROOT_DIR/scripts/score-loop-engine.sh" codex "$LIMIT" >> "$round_log" 2>&1 &
    CODEX_PID=$!
  else
    log "Skipping Codex ($codex_status)"
  fi

  [ -n "$GEMINI_PID" ] && { wait "$GEMINI_PID" || GEMINI_EXIT=$?; log "Gemini done (exit=$GEMINI_EXIT)"; }
  [ -n "$CODEX_PID" ] && { wait "$CODEX_PID" || CODEX_EXIT=$?; log "Codex done (exit=$CODEX_EXIT)"; }

  # ─── Phase 2: Fan-in — Opus ───
  quota_invalidate_cache
  claude_status="$(claude_real_quota_check)"

  if can_run "$claude_status"; then
    source "$ROOT_DIR/scripts/judges/opus.sh"
    mapfile -t OPUS_QUEUE < <(judge_build_queue)
    local OPUS_READY="${#OPUS_QUEUE[@]}"

    if [ "$OPUS_READY" -gt 0 ]; then
      local OPUS_LIMIT="$LIMIT"
      [ "$OPUS_READY" -lt "$OPUS_LIMIT" ] && OPUS_LIMIT="$OPUS_READY"
      log "Starting Opus ($OPUS_READY ready, limit=$OPUS_LIMIT)..."
      bash "$ROOT_DIR/scripts/score-loop-engine.sh" opus "$OPUS_LIMIT" >> "$round_log" 2>&1
      log "Opus done (exit=$?)"
    else
      log "No posts ready for Opus"
    fi
  else
    log "Skipping Opus ($claude_status)"
  fi

  # ─── Round summary ───
  local TODAY_STAMP
  TODAY_STAMP="$(TZ=Asia/Taipei date +%Y%m%d)"
  local gc cc oc
  gc="$(grep -c "Recorded.*=> score" "$LOG_DIR/gemini-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
  cc="$(grep -c "Recorded.*=> score" "$LOG_DIR/codex-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
  oc="$(grep -c "Recorded.*=> score" "$LOG_DIR/opus-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
  log "Round complete. Today: Gemini=$gc, Codex=$cc, Opus=$oc"

  echo "done"
}

# ─── Main ───
if [ "$DAEMON" -eq 0 ]; then
  # Single round
  run_one_round
  exit 0
fi

# ─── Daemon mode: loop forever ───
COOLDOWN_OK=120       # seconds between rounds when quota is fine
COOLDOWN_EXHAUSTED=1800  # seconds when all providers exhausted (30 min)

log "Daemon mode started (limit=$LIMIT per round, cooldown=${COOLDOWN_OK}s / ${COOLDOWN_EXHAUSTED}s)"

while :; do
  result="$(run_one_round)"

  if [ "$result" = "wait" ]; then
    log "All exhausted — sleeping ${COOLDOWN_EXHAUSTED}s"
    sleep "$COOLDOWN_EXHAUSTED"
  else
    log "Cooling down ${COOLDOWN_OK}s before next round..."
    sleep "$COOLDOWN_OK"
  fi
done
