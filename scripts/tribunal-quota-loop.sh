#!/usr/bin/env bash
# tribunal-quota-loop.sh — Quota-aware continuous tribunal loop
#
# Requires bash 4+ (associative arrays for worker pool). macOS ships bash
# 3.2 at /bin/bash, so the shebang picks up whichever bash is on PATH
# (typically Homebrew bash on Mac, system bash 5.x on Linux).
#
# Checks Claude API quota via usage-monitor.sh and adapts processing speed.
# Never burns below 3% floor (CEO personal use reserve).
#
# Strategy: burn tokens above floor, unused quota that refreshes = real waste.
#   GO   (>3%)  : process immediately, 10s cooldown between articles
#   STOP (≤3%)  : halt, check every 30min, resume at >10% (hysteresis)
#
# Usage:
#   bash scripts/tribunal-quota-loop.sh               # run continuously, 1 worker
#   bash scripts/tribunal-quota-loop.sh --workers 2   # 2 parallel workers
#   bash scripts/tribunal-quota-loop.sh --dry-run     # list what would be processed

set -o pipefail   # no -e: loop handles errors individually
                  # no -u: bash assoc arrays interact badly with unbound var
                  # checks (empty associative arrays trigger "unbound" errors
                  # on element-count access in some bash versions)
trap '' HUP       # ignore SIGHUP (systemd/nohup)
export TZ=Asia/Taipei

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

POSTS_DIR="$ROOT_DIR/src/content/posts"
PROGRESS_FILE="$ROOT_DIR/scores/tribunal-progress.json"
LOG_DIR="$ROOT_DIR/.score-loop/logs"
LOG_FILE="$LOG_DIR/tribunal-quota-loop-$(date +%Y%m%d-%H%M%S).log"
USAGE_MONITOR="$HOME/clawd/scripts/usage-monitor.sh"
QUOTA_FLOOR=3
RESUME_THRESHOLD=10
DRY_RUN=false
WORKERS=1   # Phase 2 supervisor: set to >1 for parallel workers

mkdir -p "$LOG_DIR"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --workers) WORKERS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if ! [[ "$WORKERS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: --workers must be a positive integer (got: $WORKERS)" >&2
  exit 1
fi

tlog() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S %z')] [quota-loop] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Graceful stop control ───────────────────────────────────────────────────
# Shared helper: signal + file flag channels, slice-based waits, lifecycle
# state output. See scripts/tribunal-run-control.sh for the contract.
# RC_ROOT_DIR must be exported before source so subprocesses agree on paths.
export RC_ROOT_DIR="$ROOT_DIR"
# shellcheck source=scripts/tribunal-run-control.sh
source "$SCRIPT_DIR/tribunal-run-control.sh"
trap 'rc_on_stop_signal TERM' TERM
trap 'rc_on_stop_signal INT' INT

# ─── Quota ────────────────────────────────────────────────────────────────────
# Returns integer effective remaining pct (min of 5hr and weekly).
# Returns -1 on error (usage-monitor unavailable or no claude entry).
get_effective_remaining() {
  if [ ! -x "$USAGE_MONITOR" ]; then
    echo -1
    return
  fi
  local json
  json=$(bash "$USAGE_MONITOR" --json 2>/dev/null) || { echo -1; return; }
  python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
    for p in data:
        if p.get('provider') == 'claude' and p.get('status') == 'ok':
            val = min(p['five_hr_remaining_pct'], p['weekly_remaining_pct'])
            print(int(val))
            sys.exit(0)
    print(-1)
except Exception:
    print(-1)
" "$json" 2>/dev/null || echo -1
}

# Returns sleep seconds for the given effective remaining integer %.
# Returns -1 to signal STOP.
# Philosophy: unused quota that refreshes = real waste. Burn it all above floor.
compute_sleep() {
  local pct="$1"
  if (( pct > QUOTA_FLOOR )); then echo 0   # GO: burn tokens, no sleep
  else echo -1                               # STOP: at floor
  fi
}

compute_tier_name() {
  local pct="$1"
  if (( pct > QUOTA_FLOOR )); then echo "GO"
  else echo "STOP"
  fi
}

# ─── Multi-worker supervisor helpers (Phase 2) ───────────────────────────────
# Worker worktrees live at ~/clawd/projects/gu-log-worker-<id>. The "main"
# repo (this script's ROOT_DIR) hosts the shared progress file, claims,
# locks, and state. When WORKERS=1 we run in ROOT_DIR directly — no worker
# worktrees, no env overrides — matching the pre-Phase-2 behavior.
WORKER_IDS=()
if (( WORKERS > 1 )); then
  # Generate ids: a, b, c, ... (bash built-in letter sequence)
  _ids=({a..z})
  for ((i=0; i<WORKERS; i++)); do
    WORKER_IDS+=("${_ids[$i]}")
  done
fi

# Associative arrays tracking background workers.
declare -A WORKER_PID        # worker_id → pid
declare -A WORKER_ARTICLE    # worker_id → article slug
declare -A PID_TO_WORKER     # pid → worker_id

worker_worktree() {
  local id="$1"
  if (( WORKERS == 1 )); then
    echo "$ROOT_DIR"
  else
    # Parent of the main repo, matching tribunal-worker-bootstrap.sh:
    # on Linux VPS = ~/clawd/projects/, on Mac dev = wherever gu-log sits.
    echo "$(dirname "$ROOT_DIR")/gu-log-worker-$id"
  fi
}

# Ensure worker worktrees exist AND are synced with origin/main. Called once
# at supervisor startup. Without the sync step, worker worktrees keep
# whichever origin/main snapshot they had at `git worktree add` time, so
# tribunal fixes merged to main never reach running workers.
ensure_worktrees() {
  (( WORKERS == 1 )) && return 0
  local id wt
  for id in "${WORKER_IDS[@]}"; do
    wt=$(worker_worktree "$id")
    if [ ! -d "$wt" ]; then
      tlog "Bootstrapping worker worktree: $wt"
      bash "$SCRIPT_DIR/tribunal-worker-bootstrap.sh" create "$id" >> "$LOG_FILE" 2>&1 || {
        tlog "ERROR: bootstrap failed for worker $id — cannot run --workers $WORKERS"
        exit 1
      }
    fi
  done
  # Fast-forward every worker worktree to whatever main currently is.
  tlog "Syncing worker worktrees to origin/main…"
  bash "$SCRIPT_DIR/tribunal-worker-bootstrap.sh" sync >> "$LOG_FILE" 2>&1 || \
    tlog "WARN: worktree sync reported errors (see log)"
}

# Try to claim the next unscored article that isn't already claimed.
# Prints the article filename and returns 0 on success, 1 if none available.
try_claim_next_article() {
  local worker_id="$1" article slug
  for article in "${ARTICLES[@]}"; do
    slug="${article%.mdx}"
    if rc_try_claim "$slug" "$worker_id"; then
      echo "$article"
      return 0
    fi
  done
  return 1
}

# Fork a worker in its own worktree. Echoes the pid.
spawn_worker() {
  local id="$1" article="$2"
  local wt
  wt=$(worker_worktree "$id")
  local slug="${article%.mdx}"

  # Sync worker worktree to origin/main before each dispatch. Per-dispatch
  # cost is one git fetch (~100ms with cached refs) plus a no-op hard reset
  # if nothing changed; supervisor doesn't need a restart for new tribunal
  # fixes to reach the next article's worker.
  if (( WORKERS > 1 )); then
    bash "$SCRIPT_DIR/tribunal-worker-bootstrap.sh" sync "$id" >> "$LOG_FILE" 2>&1 || \
      tlog "  WARN: pre-dispatch sync failed for worker-$id (continuing with current snapshot)"
  fi

  (
    cd "$wt" || exit 1
    # Hand shared coordinates to the subprocess so flock/claims/locks all
    # resolve to the main repo (RC_ROOT_DIR is already exported for the
    # supervisor; make it explicit again here in case the subshell's env
    # differs).
    export RC_ROOT_DIR="$ROOT_DIR"
    export PROGRESS_FILE="$ROOT_DIR/scores/tribunal-progress.json"
    export TRIBUNAL_MAIN_REPO="$ROOT_DIR"
    export TRIBUNAL_WORKER_ID="$id"
    bash "$wt/scripts/tribunal-all-claude.sh" "$article" >> "$LOG_FILE" 2>&1
  ) &
  local pid=$!
  WORKER_PID[$id]=$pid
  WORKER_ARTICLE[$id]=$slug
  PID_TO_WORKER[$pid]=$id
  tlog "  [worker-$id pid=$pid] dispatched: $article"
}

# Wait for ANY worker to finish. Releases its claim, logs outcome, clears
# tracking state. Propagates rc=77 (stopped_by_request) to exit_stopped.
wait_any_worker() {
  # bash: wait -n returns when ANY child exits, sets $? to its status.
  local rc=0
  wait -n || rc=$?
  # Identify which worker finished by scanning for dead pids.
  local id pid finished_id=""
  for id in "${!WORKER_PID[@]}"; do
    pid="${WORKER_PID[$id]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      finished_id="$id"
      break
    fi
  done

  if [ -z "$finished_id" ]; then
    tlog "WARN: wait -n returned but no worker appears finished"
    return 0
  fi

  local article_slug="${WORKER_ARTICLE[$finished_id]}"
  unset "WORKER_PID[$finished_id]"
  unset "WORKER_ARTICLE[$finished_id]"
  unset "PID_TO_WORKER[$pid]"
  rc_release_claim "$article_slug"

  case "$rc" in
    0)  tlog "  [worker-$finished_id] $article_slug — PASSED" ;;
    75) tlog "  [worker-$finished_id] $article_slug — skipped (lock collision)" ;;
    77) tlog "  [worker-$finished_id] $article_slug — stopped_by_request propagated."
        stop_requested=true
        stop_source="${stop_source:-propagated-from-worker}"
        ;;
    *)  tlog "  [worker-$finished_id] $article_slug — failed (rc=$rc)" ;;
  esac
}

# Drain: stop dispatching new articles, wait for all in-flight workers to
# finish their current articles, then exit cleanly.
drain_and_exit() {
  local n=${#WORKER_PID[@]}
  tlog "Drain: stop requested, waiting for $n in-flight worker(s) to finish current article(s)…"
  rc_write_state "draining" "in_flight=$n"
  while (( ${#WORKER_PID[@]} > 0 )); do
    wait_any_worker
  done
  rc_exit_stopped
}

# ─── Build Unscored Article List (newest → oldest) ───────────────────────────
# Copied from tribunal-batch-runner.sh (not a shared helper — keep in sync).
get_unscored_articles() {
  # Ensure progress file exists
  if [ ! -f "$PROGRESS_FILE" ] || ! jq empty "$PROGRESS_FILE" 2>/dev/null; then
    echo '{}' > "$PROGRESS_FILE"
  fi

  # List zh-tw articles (not en-, not demo), sorted newest first by filename date
  local all_zh_articles
  all_zh_articles=$(ls -1 "$POSTS_DIR"/*.mdx 2>/dev/null \
    | xargs -I{} basename {} \
    | grep -v '^en-' \
    | grep -v '^demo' \
    | sort -r)

  local article full_path status
  for article in $all_zh_articles; do
    full_path="$POSTS_DIR/$article"
    # Skip deprecated
    if grep -q '^status: "deprecated"' "$full_path" 2>/dev/null; then
      continue
    fi
    # Skip already passed or permanently exhausted (hit MAX_TOP_ATTEMPTS=5 in
    # tribunal-all-claude.sh — prevents sp-94-style infinite retry loop).
    status=$(jq -r --arg a "$article" '.[$a].status // "pending"' "$PROGRESS_FILE" 2>/dev/null || echo "pending")
    if [ "$status" = "PASS" ] || [ "$status" = "EXHAUSTED" ]; then
      continue
    fi
    echo "$article"
  done
}

# ─── Dry Run ──────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  tlog "=== Dry-run mode ==="
  mapfile -t ARTICLES < <(get_unscored_articles)
  tlog "Found ${#ARTICLES[@]} unscored articles:"
  for i in "${!ARTICLES[@]}"; do
    tlog "  $((i+1)). ${ARTICLES[$i]}"
  done
  remaining=$(get_effective_remaining)
  if (( remaining >= 0 )); then
    tier=$(compute_tier_name "$remaining")
    sleep_sec=$(compute_sleep "$remaining")
    tlog "Current quota: ${remaining}% remaining — Tier: ${tier}, inter-article sleep: ${sleep_sec}s"
  else
    tlog "Could not read quota (usage-monitor.sh unavailable or returned error)"
  fi
  exit 0
fi

# ─── Main Loop ────────────────────────────────────────────────────────────────
tlog "=== Tribunal Quota-Aware Loop started ==="
tlog "  Workers: ${WORKERS}  Quota floor: ${QUOTA_FLOOR}%, Resume threshold: ${RESUME_THRESHOLD}%"
tlog "  Usage monitor: ${USAGE_MONITOR}"
ensure_worktrees
rc_gc_stale_claims
rc_write_state "running" "startup"

while true; do
  # ── Stop boundary: top of iteration ──────────────────────────────────────
  if rc_check_stop_requested; then
    if (( ${#WORKER_PID[@]} > 0 )); then
      drain_and_exit
    else
      rc_exit_stopped
    fi
  fi

  # ── Git pull in main repo (workers do their own in their worktrees) ──────
  git pull --rebase origin main >> "$LOG_FILE" 2>&1 \
    || { git rebase --abort 2>/dev/null; tlog "WARN: git pull failed, continuing"; }

  # ── Find unscored articles ─────────────────────────────────────────────────
  mapfile -t ARTICLES < <(get_unscored_articles)
  TOTAL=${#ARTICLES[@]}
  IN_FLIGHT=${#WORKER_PID[@]}

  if [ "$TOTAL" -eq 0 ] && (( IN_FLIGHT == 0 )); then
    tlog "No unscored articles and no workers in-flight. Sleeping 30min (interruptible)."
    rc_write_state "idle_wait" "no_articles"
    rc_interruptible_sleep 1800 || true
    continue
  fi

  if [ "$TOTAL" -gt 0 ]; then
    tlog "$TOTAL unscored articles remaining. in-flight=$IN_FLIGHT workers=$WORKERS"
  fi

  # ── Check quota ────────────────────────────────────────────────────────────
  remaining=$(get_effective_remaining)

  if (( remaining < 0 )); then
    if (( IN_FLIGHT == 0 )); then
      tlog "Cannot read quota + no workers in-flight. Sleeping 10min (interruptible)."
      rc_write_state "idle_wait" "quota_unreadable"
      rc_interruptible_sleep 600 || true
      continue
    fi
    # Workers running: let them finish before we worry about quota.
    tlog "Cannot read quota; waiting for a worker to finish before re-checking."
    wait_any_worker
    continue
  fi

  sleep_sec=$(compute_sleep "$remaining")
  tier=$(compute_tier_name "$remaining")

  # ── STOP mode: quota below floor, wait for recovery ──────────────────────
  if (( sleep_sec == -1 )); then
    # Drain any in-flight first before entering quota wait.
    if (( IN_FLIGHT > 0 )); then
      tlog "Quota below floor; waiting for in-flight workers before entering quota wait."
      wait_any_worker
      continue
    fi
    tlog "STOP: ${remaining}% remaining (floor=${QUOTA_FLOOR}%). Waiting for >${RESUME_THRESHOLD}% (interruptible)."
    rc_write_state "stopped_by_quota" "remaining=${remaining}%"
    while true; do
      if ! rc_interruptible_sleep 1800; then
        break
      fi
      remaining=$(get_effective_remaining)
      if (( remaining < 0 )); then
        tlog "  Check: quota unreadable, still waiting..."
        continue
      fi
      tlog "  Check: ${remaining}% remaining"
      if (( remaining >= RESUME_THRESHOLD )); then
        tlog "Quota recovered to ${remaining}%. Resuming."
        break
      fi
    done
    continue
  fi

  # Tier BURN: no inter-article sleep (quota is healthy).
  tlog "Tier ${tier}: ${remaining}% remaining"

  # ── Dispatch: fill worker pool up to $WORKERS ────────────────────────────
  # Skip dispatch if stop requested — drain instead on next iteration.
  if rc_check_stop_requested; then
    continue
  fi

  # Try to fill every free slot with a claimable article.
  dispatched_this_iter=0
  while (( ${#WORKER_PID[@]} < WORKERS )) && [ "$TOTAL" -gt 0 ]; do
    # Find a free worker id.
    free_id=""
    for id in "${WORKER_IDS[@]:-main}"; do
      if [ -z "${WORKER_PID[$id]:-}" ]; then
        free_id="$id"
        break
      fi
    done
    [ -z "$free_id" ] && break

    # Claim + dispatch.
    if article=$(try_claim_next_article "worker-$free_id"); then
      rc_write_state "running" "dispatching worker-$free_id article=$article"
      spawn_worker "$free_id" "$article"
      dispatched_this_iter=$((dispatched_this_iter + 1))
    else
      # No claimable article (all already claimed by other workers)
      tlog "No claimable article for worker-$free_id (all in-flight elsewhere)."
      break
    fi
  done

  # If no workers are running AND we couldn't dispatch, sleep a bit.
  if (( ${#WORKER_PID[@]} == 0 )); then
    tlog "No workers running and nothing to dispatch. Short idle wait."
    rc_interruptible_sleep 60 || true
    continue
  fi

  # Wait for at least one worker to finish before re-evaluating.
  wait_any_worker

  # Short cooldown to give file systems / APIs a breath.
  rc_interruptible_sleep 10 || true
done
