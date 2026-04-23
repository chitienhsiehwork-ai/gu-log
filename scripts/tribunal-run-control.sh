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

# ─── Article claiming (Phase 2: multi-worker dispatch) ───────────────────────
# Each article is guarded by a claim directory that mkdir-atomically ensures
# only one worker can take it at a time. Supervisor calls rc_try_claim before
# dispatching to tribunal-all-claude.sh; worker releases on finish/fail/stop.
# The per-article /tmp flock in tribunal-all-claude.sh remains as
# defense-in-depth.
: "${RC_CLAIMS_DIR:=$RC_ROOT_DIR/.score-loop/claims}"
: "${RC_CLAIM_STALE_SEC:=21600}"   # 6 hours — beyond longest article run
: "${RC_PROGRESS_LOCK:=$RC_ROOT_DIR/.score-loop/progress.lock}"
: "${RC_PUSH_LOCK:=$RC_ROOT_DIR/.score-loop/push.lock}"
mkdir -p "$RC_CLAIMS_DIR"
# Ensure lock files exist so flock doesn't race on file creation.
: >>"$RC_PROGRESS_LOCK"
: >>"$RC_PUSH_LOCK"

# Usage: rc_try_claim <slug> [worker_id]
# Returns 0 if claim acquired, 1 if already held (by another worker).
# On success, writes meta file with pid + worker_id + started timestamp.
rc_try_claim() {
  local slug="$1"
  local worker="${2:-$$}"
  local claim_dir="$RC_CLAIMS_DIR/${slug}.claim"

  if mkdir "$claim_dir" 2>/dev/null; then
    # Got the claim. Write meta atomically.
    local ts
    ts=$(date -Iseconds 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
    local tmp
    tmp=$(mktemp "$claim_dir/.meta.XXXXXX") || {
      rmdir "$claim_dir" 2>/dev/null || true
      return 1
    }
    printf 'pid=%d\nworker=%s\nstarted=%s\n' "$$" "$worker" "$ts" > "$tmp"
    mv "$tmp" "$claim_dir/meta"
    return 0
  fi

  # mkdir failed — either already claimed, or it's stale from a crashed worker.
  if rc_claim_is_stale "$slug"; then
    rc_release_claim "$slug"
    # One more attempt after GC.
    if mkdir "$claim_dir" 2>/dev/null; then
      local ts tmp
      ts=$(date -Iseconds 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
      tmp=$(mktemp "$claim_dir/.meta.XXXXXX") || {
        rmdir "$claim_dir" 2>/dev/null || true
        return 1
      }
      printf 'pid=%d\nworker=%s\nstarted=%s\nrecovered_stale=1\n' \
        "$$" "$worker" "$ts" > "$tmp"
      mv "$tmp" "$claim_dir/meta"
      return 0
    fi
  fi
  return 1
}

# Usage: rc_release_claim <slug>
# Idempotent — OK to call even if claim wasn't held.
rc_release_claim() {
  local slug="$1"
  local claim_dir="$RC_CLAIMS_DIR/${slug}.claim"
  rm -f "$claim_dir/meta" "$claim_dir/.meta."* 2>/dev/null
  rmdir "$claim_dir" 2>/dev/null || true
}

# Usage: rc_claim_is_stale <slug>
# Returns 0 if claim is stale (process dead OR too old), 1 if fresh.
# "Stale" means we should reclaim rather than respect the lock.
rc_claim_is_stale() {
  local slug="$1"
  local claim_dir="$RC_CLAIMS_DIR/${slug}.claim"
  local meta="$claim_dir/meta"

  [ -d "$claim_dir" ] || return 1   # no claim = not stale

  if [ ! -f "$meta" ]; then
    # Claim dir exists but no meta. Could be mid-creation or corrupt.
    # Age-check the dir itself.
    local age
    age=$(( $(date +%s) - $(stat -c %Y "$claim_dir" 2>/dev/null \
           || stat -f %m "$claim_dir" 2>/dev/null || echo 0) ))
    (( age > RC_CLAIM_STALE_SEC ))
    return $?
  fi

  local pid worker started age
  pid=$(awk -F= '/^pid=/{print $2}' "$meta" 2>/dev/null)
  started=$(awk -F= '/^started=/{print $2}' "$meta" 2>/dev/null)

  # Process liveness check (platform-agnostic: kill -0 works on Linux+macOS).
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    return 0   # pid no longer alive → stale
  fi

  # Age check (belt + suspenders for cases where pid got recycled).
  if [ -n "$started" ]; then
    local started_epoch
    started_epoch=$(date -d "$started" +%s 2>/dev/null \
                    || date -jf "%Y-%m-%dT%H:%M:%S%z" "$started" +%s 2>/dev/null \
                    || echo 0)
    if [ "$started_epoch" -gt 0 ]; then
      age=$(( $(date +%s) - started_epoch ))
      (( age > RC_CLAIM_STALE_SEC )) && return 0
    fi
  fi

  return 1
}

# Usage: rc_gc_stale_claims
# Walks all claims and releases stale ones. Supervisor should call this
# at loop top to recover from crashed workers without restart.
rc_gc_stale_claims() {
  local claim_dir slug
  for claim_dir in "$RC_CLAIMS_DIR"/*.claim; do
    [ -d "$claim_dir" ] || continue
    slug=$(basename "$claim_dir" .claim)
    if rc_claim_is_stale "$slug"; then
      if declare -f tlog >/dev/null 2>&1; then
        tlog "Releasing stale claim: $slug"
      fi
      rc_release_claim "$slug"
    fi
  done
}
