#!/bin/bash
# tribunal-quota-loop.sh — Quota-aware continuous tribunal loop
#
# Checks Claude API quota via usage-monitor.sh and adapts processing speed.
# Never burns below 3% floor (CEO personal use reserve).
#
# Strategy: burn tokens above floor, unused quota that refreshes = real waste.
#   GO   (>3%)  : process immediately, 10s cooldown between articles
#   STOP (≤3%)  : halt, check every 30min, resume at >10% (hysteresis)
#
# Usage:
#   bash scripts/tribunal-quota-loop.sh              # run continuously
#   bash scripts/tribunal-quota-loop.sh --dry-run    # list what would be processed

set -uo pipefail  # no -e: loop handles errors individually
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

mkdir -p "$LOG_DIR"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

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
tlog "  Quota floor: ${QUOTA_FLOOR}%, Resume threshold: ${RESUME_THRESHOLD}%"
tlog "  Usage monitor: ${USAGE_MONITOR}"

while true; do
  # ── Stop boundary: top of iteration ──────────────────────────────────────
  # Covers: signal arrived during previous article, or between iterations.
  if rc_check_stop_requested; then
    rc_exit_stopped
  fi

  # ── Git pull (abort rebase on conflict) ───────────────────────────────────
  git pull --rebase origin main >> "$LOG_FILE" 2>&1 \
    || { git rebase --abort 2>/dev/null; tlog "WARN: git pull failed, continuing"; }

  # ── Find unscored articles ─────────────────────────────────────────────────
  mapfile -t ARTICLES < <(get_unscored_articles)
  TOTAL=${#ARTICLES[@]}

  if [ "$TOTAL" -eq 0 ]; then
    tlog "No unscored articles. Sleeping 30min."
    sleep 1800
    continue
  fi

  tlog "$TOTAL unscored articles remaining."

  # ── Check quota ────────────────────────────────────────────────────────────
  remaining=$(get_effective_remaining)

  if (( remaining < 0 )); then
    tlog "Cannot read quota. Sleeping 10min."
    sleep 600
    continue
  fi

  sleep_sec=$(compute_sleep "$remaining")
  tier=$(compute_tier_name "$remaining")

  # ── STOP mode: wait for recovery ──────────────────────────────────────────
  if (( sleep_sec == -1 )); then
    tlog "STOP: ${remaining}% remaining (floor=${QUOTA_FLOOR}%). Waiting for >${RESUME_THRESHOLD}%..."
    while true; do
      sleep 1800
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
    continue  # re-enter main loop (re-pull, re-check articles)
  fi

  # ── Tier sleep ────────────────────────────────────────────────────────────
  if (( sleep_sec > 0 )); then
    tlog "Tier ${tier}: ${remaining}% remaining — sleeping ${sleep_sec}s before next article"
    sleep "$sleep_sec"
    # Re-check quota after sleep (may have changed)
    remaining=$(get_effective_remaining)
    if (( remaining >= 0 )) && (( remaining < QUOTA_FLOOR )); then
      tlog "Quota dropped below floor during sleep. Entering STOP."
      continue
    fi
  else
    tlog "Tier BURN: ${remaining}% remaining — processing immediately"
  fi

  # ── Stop boundary: before dispatching a new article ─────────────────────
  # Covers: signal / flag arrived during quota check or tier sleep.
  if rc_check_stop_requested; then
    rc_exit_stopped
  fi

  # ── Process next article ───────────────────────────────────────────────────
  next_article="${ARTICLES[0]}"
  tlog "Processing: $next_article (${remaining}% remaining, tier ${tier})"

  # || true: set -e must not kill the loop when an article fails
  bash "$SCRIPT_DIR/tribunal-all-claude.sh" "$next_article" >> "$LOG_FILE" 2>&1 \
    || tlog "  Article $next_article failed (non-zero exit). Continuing to next."

  # ── Stop boundary: article finished ──────────────────────────────────────
  # Covers: signal / flag arrived during article run. article is now at
  # its natural boundary, so we exit before dispatching another one.
  if rc_check_stop_requested; then
    rc_exit_stopped
  fi

  # Brief cooldown (same as batch runner)
  sleep 10
done
