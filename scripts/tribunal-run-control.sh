#!/usr/bin/env bash
# tribunal-run-control.sh — Graceful stop / lifecycle helpers
#
# Shared between tribunal-quota-loop.sh (supervisor) and tribunal-all-claude.sh
# (per-article runner). Implements the contract from OpenSpec change
# `tribunal-graceful-run-control`:
#
#   - stop can be requested via POSIX signal OR file flag
#   - both channels set the same file-based ground truth, so subprocesses can
#     see the stop request even though they don't share the parent's variables
#   - long waits become slice-based so stop is noticed within SLICE_SEC seconds
#   - clean exit removes the flag; operator's job is to NOT touch it again if
#     they want the service to stay up next time
#
# Source this file. Do not execute.

# ─── Paths ────────────────────────────────────────────────────────────────────
# RC_ROOT_DIR must be set by the caller before sourcing. Falls back to git
# toplevel if unset (useful for ad-hoc invocations).
: "${RC_ROOT_DIR:=$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
: "${RC_CONTROL_DIR:=$RC_ROOT_DIR/.score-loop/control}"
: "${RC_STATE_DIR:=$RC_ROOT_DIR/.score-loop/state}"
: "${RC_STOP_FLAG:=$RC_CONTROL_DIR/stop-graceful}"
: "${RC_STATE_FILE:=$RC_STATE_DIR/runtime.json}"
: "${RC_SLICE_SEC:=15}"   # wait slice — operator feels stop within ~15s

mkdir -p "$RC_CONTROL_DIR" "$RC_STATE_DIR"

# Variable the caller's tlog() reads; keep in sync with file flag via trap.
: "${stop_requested:=false}"
: "${stop_source:=}"

# ─── Signal handling ──────────────────────────────────────────────────────────
# Caller should install traps like:
#   trap 'rc_on_stop_signal TERM' TERM
#   trap 'rc_on_stop_signal INT' INT
#
# Handler writes the flag file so child processes can pick it up too, then
# marks the variable. It does NOT exit — main loop must observe the flag at a
# safe boundary and call rc_exit_stopped.
rc_on_stop_signal() {
  local sig="$1"
  # Create flag file for subprocesses (idempotent).
  : >"$RC_STOP_FLAG" 2>/dev/null || true
  if [ "$stop_requested" = false ]; then
    stop_requested=true
    stop_source="signal:$sig"
    if declare -f tlog >/dev/null 2>&1; then
      tlog "STOP requested via signal $sig — entering drain mode after current article."
    fi
  fi
}

# ─── Flag check ───────────────────────────────────────────────────────────────
# Returns 0 if stop requested (via var OR file), 1 otherwise.
# Picks up file flag created by operator, sibling worker, or signal handler.
rc_check_stop_requested() {
  if [ "$stop_requested" = true ]; then
    return 0
  fi
  if [ -f "$RC_STOP_FLAG" ]; then
    stop_requested=true
    stop_source="flag"
    if declare -f tlog >/dev/null 2>&1; then
      tlog "STOP requested via flag file $RC_STOP_FLAG — entering drain mode after current article."
    fi
    return 0
  fi
  return 1
}

# ─── Interruptible sleep ──────────────────────────────────────────────────────
# Usage: rc_interruptible_sleep <total_sec> [slice_sec]
# Returns 0 if slept full duration, 1 if interrupted by stop request.
# Sleeps in slices of SLICE_SEC (default 15s) and checks stop flag each slice.
rc_interruptible_sleep() {
  local total="$1"
  local slice="${2:-$RC_SLICE_SEC}"
  (( slice < 1 )) && slice=1
  local elapsed=0
  while (( elapsed < total )); do
    if rc_check_stop_requested; then
      return 1
    fi
    local remaining=$(( total - elapsed ))
    local chunk=$(( remaining < slice ? remaining : slice ))
    sleep "$chunk"
    elapsed=$(( elapsed + chunk ))
  done
  # Final check so a stop that arrived during the last sleep still wins.
  if rc_check_stop_requested; then
    return 1
  fi
  return 0
}

# ─── Lifecycle state ──────────────────────────────────────────────────────────
# State values (per spec):
#   running | draining | idle_wait | stopped_by_request | stopped_by_quota
#
# Usage: rc_write_state <state> [details...]
# Writes a single JSON object to $RC_STATE_FILE, atomic via tmp + mv.
rc_write_state() {
  local state="$1"; shift
  local details="${*:-}"
  local ts
  ts=$(date -Iseconds 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
  local tmp
  tmp=$(mktemp "$RC_STATE_DIR/.runtime.XXXXXX") || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg state "$state" \
      --arg details "$details" \
      --arg ts "$ts" \
      --arg stop_source "$stop_source" \
      --argjson pid "$$" \
      '{state: $state, details: $details, stop_source: $stop_source, pid: $pid, updatedAt: $ts}' \
      > "$tmp"
  else
    # Fallback without jq — basic JSON string escape
    local esc_details=${details//\\/\\\\}
    esc_details=${esc_details//\"/\\\"}
    printf '{"state":"%s","details":"%s","stop_source":"%s","pid":%d,"updatedAt":"%s"}\n' \
      "$state" "$esc_details" "$stop_source" "$$" "$ts" > "$tmp"
  fi
  mv "$tmp" "$RC_STATE_FILE"
}

# ─── Clean exit ───────────────────────────────────────────────────────────────
# Writes stopped_by_request state, removes the flag so the service can be
# restarted cleanly (otherwise Restart=on-failure would immediately stop
# again), then exits 0 (stop is a clean exit, not a failure).
rc_exit_stopped() {
  rc_write_state "stopped_by_request" "source=${stop_source:-unknown}"
  if declare -f tlog >/dev/null 2>&1; then
    tlog "state=stopped_by_request source=${stop_source:-unknown}"
  fi
  # Remove flag so next run starts clean. Operator has to explicitly
  # re-touch it (or signal) to stop again.
  rm -f "$RC_STOP_FLAG" 2>/dev/null || true
  exit 0
}
