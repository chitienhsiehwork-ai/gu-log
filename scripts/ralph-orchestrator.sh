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

# "ok" = good to go, "sleep:N" = wait N seconds
# can_run: only if ok OR sleep is short (< 10 min, e.g. rate limit cooldown)
# Longer sleeps should be handled by daemon-level smart sleep, not by engine
CAN_RUN_THRESHOLD=600  # 10 minutes — anything longer, don't start the engine

can_run() {
  local s="$1"
  [ "$s" = "ok" ] && return 0
  if [[ "$s" == sleep:* ]]; then
    local secs="${s#sleep:}"
    [ "$secs" -le "$CAN_RUN_THRESHOLD" ] && return 0
  fi
  return 1
}

# Extract seconds from "sleep:N" status, 0 for "ok"
_parse_sleep() {
  local s="$1"
  if [[ "$s" == sleep:* ]]; then
    echo "${s#sleep:}"
  else
    echo "0"  # "ok" = no wait needed
  fi
}

# Find earliest reset time from multiple statuses
_earliest_reset() {
  local min=86400  # default 24hr (safety cap)
  for status in "$@"; do
    local secs
    secs="$(_parse_sleep "$status")"
    if [ "$secs" -gt 0 ] && [ "$secs" -lt "$min" ]; then
      min="$secs"
    fi
  done
  # Add 60s buffer so we check right after reset, not right before
  echo "$(( min + 60 ))"
}

# Human-readable duration
human_duration() {
  local secs="$1"
  if [ "$secs" -lt 3600 ]; then
    echo "$(( secs / 60 ))min"
  else
    local hrs=$(( secs / 3600 ))
    local mins=$(( (secs % 3600) / 60 ))
    if [ "$mins" -gt 0 ]; then
      echo "${hrs}hr ${mins}min"
    else
      echo "${hrs}hr"
    fi
  fi
}

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

  # ─── All exhausted? Calculate smart sleep ───
  if ! can_run "$gemini_status" && ! can_run "$codex_status"; then
    # Find earliest reset across all providers
    local earliest_sleep
    earliest_sleep="$(_earliest_reset "$gemini_status" "$codex_status")"
    log "Both Gemini and Codex unavailable. Next reset in ${earliest_sleep}s ($(human_duration "$earliest_sleep"))"
    # Write sleep duration to temp file for daemon to read (can't use stdout)
    echo "$earliest_sleep" > /tmp/ralph-orchestrator-sleep
    return 2  # exit code 2 = all exhausted
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

  # ─── Phase 3: Tribunal Gate — rewrite posts that fail all-judge threshold ───
  quota_invalidate_cache
  claude_status="$(claude_real_quota_check)"

  if can_run "$claude_status"; then
    # Find posts that have all 3 scores but don't meet thresholds
    mapfile -t TRIBUNAL_QUEUE < <(
      source "$ROOT_DIR/scripts/score-helpers.sh"
      while IFS= read -r pf; do
        [ -n "$pf" ] || continue
        tid="$(get_ticket_id "$ROOT_DIR/src/content/posts/$pf")"
        [ -n "$tid" ] || continue
        [ -n "$(get_score gemini "$tid")" ] || continue
        [ -n "$(get_score codex "$tid")" ] || continue
        [ -n "$(get_score opus "$tid")" ] || continue
        # Check if it fails threshold (any score below min)
        gscore="$(jq -r '.score // 0' <<< "$(get_score gemini "$tid")")"
        cscore="$(jq -r '.score // 0' <<< "$(get_score codex "$tid")")"
        opus_e="$(get_score opus "$tid")"
        op="$(jq -r '.details.persona // 0' <<< "$opus_e")"
        oc_n="$(jq -r '.details.clawdNote // 0' <<< "$opus_e")"
        ov="$(jq -r '.details.vibe // 0' <<< "$opus_e")"
        if [ "$gscore" -lt 9 ] || [ "$cscore" -lt 9 ] \
          || [ "$op" -lt 8 ] || [ "$oc_n" -lt 8 ] || [ "$ov" -lt 8 ]; then
          echo "$pf"
        fi
      done < <(list_all_posts)
    )
    local TRIBUNAL_READY="${#TRIBUNAL_QUEUE[@]}"

    if [ "$TRIBUNAL_READY" -gt 0 ]; then
      local TRIBUNAL_LIMIT="$LIMIT"
      [ "$TRIBUNAL_READY" -lt "$TRIBUNAL_LIMIT" ] && TRIBUNAL_LIMIT="$TRIBUNAL_READY"
      log "Tribunal Gate: $TRIBUNAL_READY posts need rewrite (limit=$TRIBUNAL_LIMIT)..."
      bash "$ROOT_DIR/scripts/tribunal-gate.sh" "$TRIBUNAL_LIMIT" >> "$round_log" 2>&1
      log "Tribunal Gate done (exit=$?)"
    else
      log "Tribunal Gate: no posts below threshold"
    fi
  else
    log "Skipping Tribunal Gate ($claude_status)"
  fi

  # ─── Round summary ───
  local TODAY_STAMP
  TODAY_STAMP="$(TZ=Asia/Taipei date +%Y%m%d)"
  local gc cc oc
  gc="$(grep -c "Recorded.*=> score" "$LOG_DIR/gemini-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
  cc="$(grep -c "Recorded.*=> score" "$LOG_DIR/codex-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
  oc="$(grep -c "Recorded.*=> score" "$LOG_DIR/opus-${TODAY_STAMP}.log" 2>/dev/null || echo 0)"
  log "Round complete. Today: Gemini=$gc, Codex=$cc, Opus=$oc"

  return 0  # exit code 0 = normal round completed
}

# ─── Main ───
if [ "$DAEMON" -eq 0 ]; then
  # Single round
  run_one_round
  exit 0
fi

# ─── Daemon mode: loop forever ───
COOLDOWN_OK=120       # seconds between scoring rounds

log "Daemon mode started (limit=$LIMIT per round, cooldown=${COOLDOWN_OK}s between rounds)"

while :; do
  set +e
  run_one_round
  round_exit=$?
  set -e

  if [ "$round_exit" -eq 2 ]; then
    # Read smart sleep duration from temp file (written by run_one_round)
    local_sleep="$(cat /tmp/ralph-orchestrator-sleep 2>/dev/null || echo 1800)"
    rm -f /tmp/ralph-orchestrator-sleep
    # Cap at 12hr, floor at 5min
    [ "$local_sleep" -lt 300 ] && local_sleep=300
    [ "$local_sleep" -gt 43200 ] && local_sleep=43200
    log "Sleeping until next quota reset: $(human_duration "$local_sleep")"
    sleep "$local_sleep"
  else
    log "Cooling down ${COOLDOWN_OK}s before next round..."
    sleep "$COOLDOWN_OK"
  fi
done
