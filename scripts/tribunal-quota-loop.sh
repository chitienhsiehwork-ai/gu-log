#!/usr/bin/env bash
# tribunal-quota-loop.sh — Quota-aware continuous tribunal loop
#
# Requires bash 4+ (associative arrays for worker pool). macOS ships bash
# 3.2 at /bin/bash, so the shebang picks up whichever bash is on PATH
# (typically Homebrew bash on Mac, system bash 5.x on Linux).
#
# Checks Claude API quota via usage-monitor.sh and adapts processing speed.
# Never burns below QUOTA_FLOOR% (human personal use reserve).
#
# Strategy: closed-loop feedback controller.
#   For each quota window (5hr / 7day), compute ideal consumption rate:
#     rate = (remaining - floor) / time_until_refresh
#   Convert to cooldown = ARTICLE_COST_PCT / rate.
#   Take the more conservative (longer) cooldown of the two windows.
#   Self-calibrate ARTICLE_COST_PCT from history via EMA.
#
# Usage:
#   bash scripts/tribunal-quota-loop.sh                   # run continuously, 1 worker
#   bash scripts/tribunal-quota-loop.sh --workers 2       # 2 parallel workers
#   bash scripts/tribunal-quota-loop.sh --dry-run         # list what would be processed
#   bash scripts/tribunal-quota-loop.sh --legacy-quota    # bypass controller, use old GO/STOP

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
DRY_RUN=false
WORKERS=1   # Phase 2 supervisor: set to >1 for parallel workers
LEGACY_QUOTA=false

# ─── Closed-loop controller constants ────────────────────────────────────────
MIN_COOLDOWN=10        # seconds — floor for inter-article wait
MAX_COOLDOWN=1800      # seconds (30 min) — ceiling / hard stop
ARTICLE_COST_PCT=1.0   # % per article (cold start; EMA calibrates after ~5 articles)
AVG_ARTICLE_TIME=1800  # seconds (~30 min average per article, for worker count estimation)
EMA_ALPHA=0.3          # calibration smoothing factor
EXTRA_USAGE_LIMIT=1.0  # disabled — let 5hr/7day curves control pacing
QUOTA_HISTORY_FILE="$ROOT_DIR/.score-loop/state/quota-history.jsonl"
QUOTA_CONTROLLER_STATE="$ROOT_DIR/.score-loop/state/quota-controller.json"

mkdir -p "$LOG_DIR" "$ROOT_DIR/.score-loop/state"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --legacy-quota) LEGACY_QUOTA=true; shift ;;
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

# ─── Auto scale-down / up ────────────────────────────────────────────────────
# Memory-aware worker throttling. Runs only when WORKERS > 1.
#
# Decision ladder each loop iteration:
#   1. Recent oom-kill in journal        → hard-cap limit at AUTOSCALE_OOM_CAP
#   2. memory pct ≥ SCALE_DOWN_PCT       → step limit down by 1 (floor: 1)
#   3. memory pct < SCALE_UP_PCT for N   → step limit up by 1 (ceiling: $WORKERS)
#      consecutive samples
#   4. between those thresholds          → no-op (hysteresis band)
#
# Plus a spawn pre-check: when the supervisor is about to fork a new worker,
# it estimates current + PER_WORKER_MB and refuses to fork if that would
# cross SCALE_DOWN_PCT. Protects against fork-time memory bursts that a
# 30s sampling cadence can't catch in time.
#
# Operator overrides: writing an integer to .score-loop/control/worker-limit
# pins the limit regardless of memory (e.g., for planned burn runs). The
# autoscaler respects any value <= $WORKERS and ignores out-of-range garbage.
#
# Local dev: set AUTOSCALE_MOCK_MEMORY_CURRENT / AUTOSCALE_MOCK_MEMORY_MAX /
# AUTOSCALE_MOCK_OOM to simulate production conditions on Mac (no systemd).
AUTOSCALE_SCALE_DOWN_PCT=85
AUTOSCALE_SCALE_UP_PCT=50
AUTOSCALE_UP_SAMPLES=5
AUTOSCALE_OOM_COOLDOWN_SEC=600
AUTOSCALE_OOM_CAP=2
AUTOSCALE_PER_WORKER_MB=400
AUTOSCALE_CONTROL_FILE="$ROOT_DIR/.score-loop/control/worker-limit"
AUTOSCALE_STATE_FILE="$ROOT_DIR/.score-loop/state/autoscale.json"
AUTOSCALE_LOW_MEM_STREAK=0

autoscale_memory_current() {
  if [ -n "${AUTOSCALE_MOCK_MEMORY_CURRENT:-}" ]; then
    echo "$AUTOSCALE_MOCK_MEMORY_CURRENT"
    return
  fi
  systemctl --user show tribunal-loop -p MemoryCurrent --value 2>/dev/null \
    | grep -E '^[0-9]+$' | head -1
}

autoscale_memory_max() {
  if [ -n "${AUTOSCALE_MOCK_MEMORY_MAX:-}" ]; then
    echo "$AUTOSCALE_MOCK_MEMORY_MAX"
    return
  fi
  systemctl --user show tribunal-loop -p MemoryMax --value 2>/dev/null \
    | grep -E '^[0-9]+$' | head -1
}

# Returns 0 if an oom-kill event exists within AUTOSCALE_OOM_COOLDOWN_SEC
# of now. Best-effort on non-systemd platforms (silent false).
autoscale_recent_oom() {
  if [ -n "${AUTOSCALE_MOCK_OOM:-}" ]; then
    [ "$AUTOSCALE_MOCK_OOM" = "1" ]
    return
  fi
  command -v journalctl >/dev/null 2>&1 || return 1
  journalctl --user -u tribunal-loop \
    --since "${AUTOSCALE_OOM_COOLDOWN_SEC} sec ago" \
    --no-pager 2>/dev/null | grep -q 'oom-kill'
}

autoscale_read_limit() {
  if [ -f "$AUTOSCALE_CONTROL_FILE" ]; then
    local n
    n=$(tr -d '[:space:]' < "$AUTOSCALE_CONTROL_FILE")
    if [[ "$n" =~ ^[1-9][0-9]*$ ]] && (( n <= WORKERS )); then
      echo "$n"
      return
    fi
  fi
  echo "$WORKERS"
}

autoscale_write_limit() {
  local n="$1" reason="$2"
  mkdir -p "$(dirname "$AUTOSCALE_CONTROL_FILE")"
  echo "$n" > "$AUTOSCALE_CONTROL_FILE"
  tlog "AUTOSCALE: worker-limit=$n ($reason)"
  autoscale_write_state "$n" "$reason"
}

autoscale_write_state() {
  local limit="$1" reason="$2"
  mkdir -p "$(dirname "$AUTOSCALE_STATE_FILE")"
  local ts mc mx pct
  ts=$(date -Iseconds 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
  mc=$(autoscale_memory_current)
  mx=$(autoscale_memory_max)
  if [[ "$mc" =~ ^[0-9]+$ ]] && [[ "$mx" =~ ^[0-9]+$ ]] && (( mx > 0 )); then
    pct=$(( mc * 100 / mx ))
  else
    pct=-1
    mc=0; mx=0
  fi
  local tmp
  tmp=$(mktemp "$(dirname "$AUTOSCALE_STATE_FILE")/.autoscale.XXXXXX") || return
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --argjson limit "$limit" \
      --argjson workers_max "$WORKERS" \
      --argjson low_streak "$AUTOSCALE_LOW_MEM_STREAK" \
      --argjson memory_current "$mc" \
      --argjson memory_max "$mx" \
      --argjson memory_pct "$pct" \
      --arg reason "$reason" \
      --arg ts "$ts" \
      '{effective_workers: $limit, configured_workers: $workers_max, low_mem_streak: $low_streak, memory_current_bytes: $memory_current, memory_max_bytes: $memory_max, memory_pct: $memory_pct, last_reason: $reason, updatedAt: $ts}' \
      > "$tmp"
  else
    printf '{"effective_workers":%d,"configured_workers":%d,"memory_pct":%d,"last_reason":"%s","updatedAt":"%s"}\n' \
      "$limit" "$WORKERS" "$pct" "$reason" "$ts" > "$tmp"
  fi
  mv "$tmp" "$AUTOSCALE_STATE_FILE"
}

autoscale_check() {
  (( WORKERS <= 1 )) && return 0

  local mc mx pct current_limit
  mc=$(autoscale_memory_current)
  mx=$(autoscale_memory_max)

  if ! [[ "$mc" =~ ^[0-9]+$ ]] || ! [[ "$mx" =~ ^[0-9]+$ ]] || (( mx == 0 )); then
    return 0   # no systemd / no cgroup memory — can't autoscale, bail silently
  fi

  pct=$(( mc * 100 / mx ))
  current_limit=$(autoscale_read_limit)

  # 1. OOM hard-cap
  if autoscale_recent_oom; then
    if (( current_limit > AUTOSCALE_OOM_CAP )); then
      autoscale_write_limit "$AUTOSCALE_OOM_CAP" \
        "oom-kill within ${AUTOSCALE_OOM_COOLDOWN_SEC}s (memory=${pct}%)"
    fi
    AUTOSCALE_LOW_MEM_STREAK=0
    return 0
  fi

  # 2. High memory → step down
  if (( pct >= AUTOSCALE_SCALE_DOWN_PCT )); then
    if (( current_limit > 1 )); then
      autoscale_write_limit $(( current_limit - 1 )) \
        "memory ${pct}% ≥ ${AUTOSCALE_SCALE_DOWN_PCT}%"
    fi
    AUTOSCALE_LOW_MEM_STREAK=0
    return 0
  fi

  # 3. Low memory (stable) → step up
  if (( pct < AUTOSCALE_SCALE_UP_PCT )); then
    AUTOSCALE_LOW_MEM_STREAK=$(( AUTOSCALE_LOW_MEM_STREAK + 1 ))
    if (( AUTOSCALE_LOW_MEM_STREAK >= AUTOSCALE_UP_SAMPLES )); then
      if (( current_limit < WORKERS )); then
        autoscale_write_limit $(( current_limit + 1 )) \
          "memory ${pct}% stable < ${AUTOSCALE_SCALE_UP_PCT}% for ${AUTOSCALE_UP_SAMPLES} samples"
      fi
      AUTOSCALE_LOW_MEM_STREAK=0
    fi
    return 0
  fi

  # 4. Middle zone — hysteresis: do nothing, reset streak
  AUTOSCALE_LOW_MEM_STREAK=0
}

# Returns 0 if forking another worker won't push memory past the scale-down
# threshold. Estimated via current + AUTOSCALE_PER_WORKER_MB. Returns 0 if
# memory can't be read (no blocker on non-systemd platforms).
autoscale_can_spawn() {
  (( WORKERS <= 1 )) && return 0
  local mc mx projected projected_pct
  mc=$(autoscale_memory_current)
  mx=$(autoscale_memory_max)
  if ! [[ "$mc" =~ ^[0-9]+$ ]] || ! [[ "$mx" =~ ^[0-9]+$ ]] || (( mx == 0 )); then
    return 0
  fi
  projected=$(( mc + AUTOSCALE_PER_WORKER_MB * 1024 * 1024 ))
  projected_pct=$(( projected * 100 / mx ))
  if (( projected_pct > AUTOSCALE_SCALE_DOWN_PCT )); then
    return 1
  fi
  return 0
}

# ─── Quota: Legacy GO/STOP (kept for --legacy-quota fallback) ────────────────
# Returns integer effective remaining pct (min of 5hr and weekly).
# Returns -1 on error (usage-monitor unavailable or no claude entry).
legacy_get_effective_remaining() {
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

legacy_compute_sleep() {
  local pct="$1"
  if (( pct > QUOTA_FLOOR )); then echo 0
  else echo -1
  fi
}

legacy_compute_tier_name() {
  local pct="$1"
  if (( pct > QUOTA_FLOOR )); then echo "GO"
  else echo "STOP"
  fi
}

# ─── Quota: Closed-loop controller ───────────────────────────────────────────
# Parses usage-monitor.sh --json output into dual-window quota readings.
# Outputs a single line of pipe-separated values:
#   five_hr_pct|five_hr_resets_sec|seven_day_pct|seven_day_resets_sec|extra_used|extra_limit|extra_enabled
# Returns exit code 1 on error.
get_dual_quota_readings() {
  if [ ! -x "$USAGE_MONITOR" ]; then
    return 1
  fi
  local json
  json=$(bash "$USAGE_MONITOR" --json 2>/dev/null) || return 1
  python3 -c "
import json, sys, re

def parse_reset_to_sec(s):
    \"\"\"Convert human-readable reset string to seconds.
    Formats: 'N 分鐘', 'N.N 小時', 'N.N 天', ISO timestamp, or empty.
    Returns -1 if inactive (null/empty/unparseable).\"\"\"
    if not s:
        return -1
    s = s.strip()
    # Try '45 分鐘' format
    m = re.match(r'^([\d.]+)\s*分鐘$', s)
    if m:
        return max(0, int(float(m.group(1)) * 60))
    # Try '2.3 小時' format
    m = re.match(r'^([\d.]+)\s*小時$', s)
    if m:
        return max(0, int(float(m.group(1)) * 3600))
    # Try '1.5 天' format
    m = re.match(r'^([\d.]+)\s*天$', s)
    if m:
        return max(0, int(float(m.group(1)) * 86400))
    # Try ISO timestamp (in case usage-monitor adds raw timestamps later)
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(s)
        delta = (dt - datetime.now(timezone.utc)).total_seconds()
        return max(0, int(delta))
    except Exception:
        pass
    return -1

try:
    data = json.loads(sys.argv[1])
    for p in data:
        if p.get('provider') == 'claude' and p.get('status') == 'ok':
            five_pct = p.get('five_hr_remaining_pct', 0)
            five_reset_sec = parse_reset_to_sec(p.get('five_hr_reset', ''))
            seven_pct = p.get('weekly_remaining_pct', 0)
            seven_reset_sec = parse_reset_to_sec(p.get('weekly_reset', ''))
            extra_used = p.get('extra_used', 0)
            extra_limit = p.get('extra_limit', 0)
            extra_enabled = 1 if p.get('extra_usage_enabled', False) else 0
            print(f'{five_pct}|{five_reset_sec}|{seven_pct}|{seven_reset_sec}|{extra_used}|{extra_limit}|{extra_enabled}')
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" "$json" 2>/dev/null
}

# Main controller tick. Called before each dispatch cycle.
# Usage: controller_tick <active_workers>
# Outputs: cooldown_sec|recommended_workers|binding_constraint|mode
# On error: outputs fallback values.
controller_tick() {
  local active_workers="${1:-0}"

  # Read dual quota
  local readings
  if ! readings=$(get_dual_quota_readings); then
    echo "600|1|none|fallback"
    return
  fi

  # Parse readings
  local five_pct five_reset_sec seven_pct seven_reset_sec extra_used extra_limit extra_enabled
  IFS='|' read -r five_pct five_reset_sec seven_pct seven_reset_sec extra_used extra_limit extra_enabled <<< "$readings"

  # Compute and output via python for floating-point precision
  python3 -c "
import sys

five_pct = float('$five_pct')
five_reset_sec = float('$five_reset_sec')
seven_pct = float('$seven_pct')
seven_reset_sec = float('$seven_reset_sec')
extra_used = float('$extra_used')
extra_limit = float('$extra_limit')
extra_enabled = int('$extra_enabled')
active_workers = int('$active_workers')
floor = float('$QUOTA_FLOOR')
article_cost = float('$ARTICLE_COST_PCT')
min_cd = float('$MIN_COOLDOWN')
max_cd = float('$MAX_COOLDOWN')
extra_threshold = float('$EXTRA_USAGE_LIMIT')

# Extra usage safety valve
if extra_enabled and extra_limit > 0 and (extra_used / extra_limit) > extra_threshold:
    print(f'{int(max_cd)}|0|extra_limit|extra_limit')
    sys.exit(0)

# Feedforward compensation: subtract in-flight workers' estimated cost
inflight_cost = active_workers * article_cost

def compute_window(remaining_pct, reset_sec, inflight_cost):
    \"\"\"Return (cooldown_sec, is_active).
    reset_sec < 0 means inactive window → MIN_COOLDOWN (no constraint).\"\"\"
    if reset_sec < 0:
        return (min_cd, False)
    effective = remaining_pct - inflight_cost
    usable = effective - floor
    if usable <= 0:
        return (max_cd, True)
    if reset_sec <= 0:
        return (min_cd, True)
    rate = usable / reset_sec  # %/sec
    if rate <= 0:
        return (max_cd, True)
    cd = article_cost / rate
    cd = max(min_cd, min(max_cd, cd))
    return (cd, True)

cd_5hr, active_5hr = compute_window(five_pct, five_reset_sec, inflight_cost)
cd_7day, active_7day = compute_window(seven_pct, seven_reset_sec, inflight_cost)

# Take the more conservative (longer) cooldown
if cd_5hr >= cd_7day:
    cooldown = cd_5hr
    binding = 'five_hour' if active_5hr else 'none'
else:
    cooldown = cd_7day
    binding = 'seven_day' if active_7day else 'none'

# If both inactive, go full speed
if not active_5hr and not active_7day:
    cooldown = min_cd
    binding = 'none'

cooldown = int(max(min_cd, min(max_cd, cooldown)))

# Check if actually at floor (not just slow pacing)
five_at_floor = (five_pct - inflight_cost) <= floor if active_5hr else False
seven_at_floor = (seven_pct - inflight_cost) <= floor if active_7day else False
at_floor = five_at_floor or seven_at_floor

if at_floor:
    workers = 0
    mode = 'floor_stop'
else:
    # Worker count: how many can stay busy given cooldown vs avg article time
    avg_time = float('$AVG_ARTICLE_TIME')
    if cooldown > 0 and avg_time > 0:
        workers = max(1, int(avg_time / cooldown))
    else:
        workers = 1
    mode = 'pacing'

print(f'{cooldown}|{workers}|{binding}|{mode}')
" 2>/dev/null || echo "600|1|none|fallback"
}

# Append a JSONL entry to quota-history.jsonl.
# Usage: quota_history_append <event> <five_pct> <five_reset> <seven_pct> <seven_reset> \
#          <extra_used> <extra_limit> <cooldown> <workers> <binding> <article_cost> <mode>
quota_history_append() {
  [ "$LEGACY_QUOTA" = true ] && return 0
  local event="$1" five_pct="$2" five_reset="$3" seven_pct="$4" seven_reset="$5"
  local extra_used="$6" extra_limit="$7" cooldown="$8" workers="$9"
  shift 9
  local binding="$1" article_cost="$2" mode="$3"
  python3 -c "
import json, datetime
entry = {
    'ts': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'event': '$event',
    'five_hr_pct': float('$five_pct'),
    'five_hr_resets_sec': float('$five_reset'),
    'seven_day_pct': float('$seven_pct'),
    'seven_day_resets_sec': float('$seven_reset'),
    'extra_used_usd': float('$extra_used'),
    'extra_limit_usd': float('$extra_limit'),
    'cooldown_sec': int('$cooldown'),
    'recommended_workers': int('$workers'),
    'binding_constraint': '$binding',
    'article_cost_pct': float('$article_cost'),
    'mode': '$mode',
}
print(json.dumps(entry))
" >> "$QUOTA_HISTORY_FILE" 2>/dev/null || true
}

# Overwrite quota-controller.json with current controller state.
# Usage: quota_controller_write_state <mode> <five_pct> <seven_pct> <cooldown> <workers> <binding> <article_cost>
quota_controller_write_state() {
  [ "$LEGACY_QUOTA" = true ] && return 0
  local mode="$1" five_pct="$2" seven_pct="$3" cooldown="$4" workers="$5" binding="$6" article_cost="$7"
  local tmp
  tmp=$(mktemp "$ROOT_DIR/.score-loop/state/.quota-controller.XXXXXX") || return 1
  python3 -c "
import json, datetime
state = {
    'mode': '$mode',
    'five_hr_pct': float('$five_pct'),
    'seven_day_pct': float('$seven_pct'),
    'cooldown_sec': int('$cooldown'),
    'recommended_workers': int('$workers'),
    'binding_constraint': '$binding',
    'article_cost_pct': float('$article_cost'),
    'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
print(json.dumps(state, indent=2))
" > "$tmp" 2>/dev/null && mv "$tmp" "$QUOTA_CONTROLLER_STATE" || rm -f "$tmp"
}

# ─── Auto-calibration ────────────────────────────────────────────────────────
# Calibrate ARTICLE_COST_PCT from quota-history.jsonl using EMA.
# Only calibrates from single-worker mode entries (multi-worker deltas are noisy).
# Updates the global ARTICLE_COST_PCT variable.
calibrate_article_cost() {
  [ "$LEGACY_QUOTA" = true ] && return 0
  [ ! -f "$QUOTA_HISTORY_FILE" ] && return 0
  local new_cost
  new_cost=$(python3 -c "
import json, sys

alpha = float('$EMA_ALPHA')
default_cost = float('$ARTICLE_COST_PCT')

# Read all dispatch/complete pairs from history
lines = []
try:
    with open('$QUOTA_HISTORY_FILE', 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                lines.append(json.loads(line))
            except:
                continue
except:
    print(f'{default_cost}')
    sys.exit(0)

# Find dispatch→complete pairs (in single-worker mode only)
# Look for consecutive dispatch/complete events
deltas = []
prev_dispatch = None
for entry in lines:
    event = entry.get('event', '')
    workers = entry.get('recommended_workers', 1)
    if event == 'dispatch':
        prev_dispatch = entry
    elif event == 'complete' and prev_dispatch is not None:
        # Only use single-worker deltas
        if prev_dispatch.get('recommended_workers', 1) <= 1 and workers <= 1:
            pre_pct = min(prev_dispatch.get('five_hr_pct', 100), prev_dispatch.get('seven_day_pct', 100))
            post_pct = min(entry.get('five_hr_pct', 100), entry.get('seven_day_pct', 100))
            delta = pre_pct - post_pct
            if delta > 0:  # only positive deltas make sense
                deltas.append(delta)
        prev_dispatch = None

# Cold start: not enough data
if len(deltas) < 5:
    print(f'{default_cost}')
    sys.exit(0)

# EMA over deltas
ema = deltas[0]
for d in deltas[1:]:
    ema = alpha * d + (1 - alpha) * ema

# Clamp to reasonable range (0.5 - 20.0)
ema = max(0.5, min(20.0, ema))
print(f'{ema:.2f}')
" 2>/dev/null) || return 0

  if [ -n "$new_cost" ] && [ "$new_cost" != "$ARTICLE_COST_PCT" ]; then
    tlog "CALIBRATE: ARTICLE_COST_PCT $ARTICLE_COST_PCT → $new_cost"
    ARTICLE_COST_PCT="$new_cost"
  fi
}

# Rotate quota-history.jsonl at startup: remove entries older than 7 days.
quota_history_rotate() {
  [ "$LEGACY_QUOTA" = true ] && return 0
  [ ! -f "$QUOTA_HISTORY_FILE" ] && return 0
  local tmp
  tmp=$(mktemp "$ROOT_DIR/.score-loop/state/.quota-history-rotate.XXXXXX") || return 1
  python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta

cutoff = datetime.now(timezone.utc) - timedelta(days=7)
kept = 0
with open('$QUOTA_HISTORY_FILE', 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            ts = datetime.fromisoformat(entry['ts'])
            if ts >= cutoff:
                print(line)
                kept += 1
        except:
            print(line)
            kept += 1
print(f'# rotated: kept {kept} entries', file=sys.stderr)
" > "$tmp" 2>/dev/null && mv "$tmp" "$QUOTA_HISTORY_FILE" || rm -f "$tmp"
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

  # List zh-tw articles (not en-, not demo), sorted newest-first by
  # frontmatter translatedDate (the date we first shipped this post).
  # Earlier we sorted by filename (sort -V), which grouped by prefix
  # (all sp-* before all sd-* before all cp-*) and stranded slug-only
  # files (no YYYYMMDD in filename) at the end. translatedDate lives in
  # frontmatter for every post (Zod-required, see config.ts), so this is
  # a uniform key across all series and naming conventions.
  local all_zh_articles
  all_zh_articles=$(
    for f in "$POSTS_DIR"/*.mdx; do
      base=$(basename "$f")
      case "$base" in en-*|demo*) continue ;; esac
      # Extract translatedDate from the first frontmatter block.
      td=$(awk '/^---$/{c++; if(c==2) exit; next} c==1 && /^translatedDate:/ {gsub(/[" ]/,"",$2); print $2; exit}' "$f")
      [ -z "$td" ] && continue
      printf '%s|%s\n' "$td" "$base"
    done | sort -r | cut -d'|' -f2-
  )

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
  if [ "$LEGACY_QUOTA" = true ]; then
    remaining=$(legacy_get_effective_remaining)
    if (( remaining >= 0 )); then
      tier=$(legacy_compute_tier_name "$remaining")
      tlog "Current quota (legacy): ${remaining}% remaining — Tier: ${tier}"
    else
      tlog "Could not read quota (usage-monitor.sh unavailable or returned error)"
    fi
  else
    tick_result=$(controller_tick 0)
    IFS='|' read -r cd wk bind mode <<< "$tick_result"
    tlog "Controller: cooldown=${cd}s workers=${wk} binding=${bind} mode=${mode}"
    tlog "ARTICLE_COST_PCT=${ARTICLE_COST_PCT}"
  fi
  exit 0
fi

# ─── Main Loop ────────────────────────────────────────────────────────────────
tlog "=== Tribunal Quota-Aware Loop started ==="
if [ "$LEGACY_QUOTA" = true ]; then
  tlog "  Mode: LEGACY (binary GO/STOP)"
  tlog "  Workers: ${WORKERS}  Quota floor: ${QUOTA_FLOOR}%"
else
  tlog "  Mode: CLOSED-LOOP CONTROLLER"
  tlog "  Workers: ${WORKERS}  Floor: ${QUOTA_FLOOR}%  ArticleCost: ${ARTICLE_COST_PCT}%"
  tlog "  MinCooldown: ${MIN_COOLDOWN}s  MaxCooldown: ${MAX_COOLDOWN}s"
fi
tlog "  Usage monitor: ${USAGE_MONITOR}"
ensure_worktrees
rc_gc_stale_claims
rc_write_state "running" "startup"
# Seed autoscale state so operators see a baseline before the first scaling
# event. Limit starts at $WORKERS (no throttle yet).
if (( WORKERS > 1 )); then
  autoscale_write_state "$WORKERS" "startup"
fi
# Rotate old history entries at startup
quota_history_rotate
# Run initial calibration from existing history
calibrate_article_cost

while true; do
  # ── Stop boundary: top of iteration ──────────────────────────────────────
  if rc_check_stop_requested; then
    if (( ${#WORKER_PID[@]} > 0 )); then
      drain_and_exit
    else
      rc_exit_stopped
    fi
  fi

  # ── Autoscale: read memory + OOM history, adjust worker-limit ───────────
  autoscale_check
  EFFECTIVE_WORKERS=$(autoscale_read_limit)

  # ── Git pull in main repo (workers do their own in their worktrees) ──────
  git pull --rebase --autostash origin main >> "$LOG_FILE" 2>&1 \
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
    if (( EFFECTIVE_WORKERS < WORKERS )); then
      tlog "$TOTAL unscored articles remaining. in-flight=$IN_FLIGHT workers=$EFFECTIVE_WORKERS/$WORKERS (throttled)"
    else
      tlog "$TOTAL unscored articles remaining. in-flight=$IN_FLIGHT workers=$WORKERS"
    fi
  fi

  # ── Check quota ────────────────────────────────────────────────────────────
  if [ "$LEGACY_QUOTA" = true ]; then
    # ── Legacy binary GO/STOP path ──────────────────────────────────────────
    remaining=$(legacy_get_effective_remaining)

    if (( remaining < 0 )); then
      if (( IN_FLIGHT == 0 )); then
        tlog "Cannot read quota + no workers in-flight. Sleeping 10min (interruptible)."
        rc_write_state "idle_wait" "quota_unreadable"
        rc_interruptible_sleep 600 || true
        continue
      fi
      tlog "Cannot read quota; waiting for a worker to finish before re-checking."
      wait_any_worker
      continue
    fi

    sleep_sec=$(legacy_compute_sleep "$remaining")
    tier=$(legacy_compute_tier_name "$remaining")

    if (( sleep_sec == -1 )); then
      if (( IN_FLIGHT > 0 )); then
        tlog "Quota below floor; waiting for in-flight workers before entering quota wait."
        wait_any_worker
        continue
      fi
      tlog "STOP: ${remaining}% remaining (floor=${QUOTA_FLOOR}%). Waiting (legacy, interruptible)."
      rc_write_state "stopped_by_quota" "remaining=${remaining}%"
      rc_interruptible_sleep 1800 || true
      continue
    fi

    tlog "Tier ${tier}: ${remaining}% remaining"
    CONTROLLER_COOLDOWN=10
    CONTROLLER_WORKERS=$EFFECTIVE_WORKERS
  else
    # ── Closed-loop controller path ──────────────────────────────────────────
    tick_result=$(controller_tick "$IN_FLIGHT")
    IFS='|' read -r CONTROLLER_COOLDOWN CONTROLLER_WORKERS CONTROLLER_BINDING CONTROLLER_MODE <<< "$tick_result"

    # Grab raw readings for history/state
    readings_raw=$(get_dual_quota_readings 2>/dev/null) || readings_raw="0|-1|0|-1|0|0|0"
    IFS='|' read -r five_pct_raw five_reset_raw seven_pct_raw seven_reset_raw extra_u_raw extra_l_raw extra_e_raw <<< "$readings_raw"

    tlog "CONTROLLER: cooldown=${CONTROLLER_COOLDOWN}s workers=${CONTROLLER_WORKERS} binding=${CONTROLLER_BINDING} mode=${CONTROLLER_MODE} 5hr=${five_pct_raw}% 7day=${seven_pct_raw}% cost=${ARTICLE_COST_PCT}%"

    quota_history_append "tick" "$five_pct_raw" "$five_reset_raw" "$seven_pct_raw" "$seven_reset_raw" \
      "$extra_u_raw" "$extra_l_raw" "$CONTROLLER_COOLDOWN" "$CONTROLLER_WORKERS" \
      "$CONTROLLER_BINDING" "$ARTICLE_COST_PCT" "$CONTROLLER_MODE"
    quota_controller_write_state "$CONTROLLER_MODE" "$five_pct_raw" "$seven_pct_raw" \
      "$CONTROLLER_COOLDOWN" "$CONTROLLER_WORKERS" "$CONTROLLER_BINDING" "$ARTICLE_COST_PCT"

    # Handle floor stop / extra limit
    if [ "$CONTROLLER_MODE" = "floor_stop" ] || [ "$CONTROLLER_MODE" = "extra_limit" ]; then
      if (( IN_FLIGHT > 0 )); then
        tlog "Controller mode=$CONTROLLER_MODE; waiting for in-flight workers."
        wait_any_worker
        continue
      fi
      tlog "Controller mode=$CONTROLLER_MODE; sleeping ${CONTROLLER_COOLDOWN}s (interruptible)."
      rc_write_state "stopped_by_quota" "mode=${CONTROLLER_MODE} cooldown=${CONTROLLER_COOLDOWN}s"
      rc_interruptible_sleep "$CONTROLLER_COOLDOWN" || true
      continue
    fi

    # Handle fallback (usage-monitor error)
    if [ "$CONTROLLER_MODE" = "fallback" ]; then
      if (( IN_FLIGHT == 0 )); then
        tlog "Controller fallback mode; sleeping ${CONTROLLER_COOLDOWN}s (interruptible)."
        rc_write_state "fallback" "cooldown=${CONTROLLER_COOLDOWN}s"
        rc_interruptible_sleep "$CONTROLLER_COOLDOWN" || true
        continue
      fi
      tlog "Controller fallback; waiting for a worker to finish before re-checking."
      wait_any_worker
      continue
    fi

    # Apply min(controller_workers, autoscale effective_workers)
    if (( CONTROLLER_WORKERS < EFFECTIVE_WORKERS )); then
      EFFECTIVE_WORKERS=$CONTROLLER_WORKERS
    fi

    rc_write_state "pacing" "cooldown=${CONTROLLER_COOLDOWN}s workers=${EFFECTIVE_WORKERS} binding=${CONTROLLER_BINDING}"
  fi

  # ── Dispatch: fill worker pool up to $EFFECTIVE_WORKERS ─────────────────
  # Skip dispatch if stop requested — drain instead on next iteration.
  if rc_check_stop_requested; then
    continue
  fi

  # Try to fill every free slot up to EFFECTIVE_WORKERS (autoscale-throttled).
  dispatched_this_iter=0
  while (( ${#WORKER_PID[@]} < EFFECTIVE_WORKERS )) && [ "$TOTAL" -gt 0 ]; do
    # Find a free worker id.
    free_id=""
    for id in "${WORKER_IDS[@]:-main}"; do
      if [ -z "${WORKER_PID[$id]:-}" ]; then
        free_id="$id"
        break
      fi
    done
    [ -z "$free_id" ] && break

    # Spawn pre-check: would adding another worker blow the memory budget?
    # Only holds the dispatch off for this iteration — next iteration's
    # autoscale_check will re-evaluate.
    if ! autoscale_can_spawn; then
      tlog "AUTOSCALE: holding spawn of worker-$free_id — projected memory would exceed ${AUTOSCALE_SCALE_DOWN_PCT}%"
      break
    fi

    # Claim + dispatch.
    if article=$(try_claim_next_article "worker-$free_id"); then
      rc_write_state "pacing" "dispatching worker-$free_id article=$article"
      # Log dispatch event for calibration
      if [ "$LEGACY_QUOTA" != true ]; then
        d_readings=$(get_dual_quota_readings 2>/dev/null) || d_readings="0|-1|0|-1|0|0|0"
        IFS='|' read -r d5 dr5 d7 dr7 deu del dee <<< "$d_readings"
        quota_history_append "dispatch" "$d5" "$dr5" "$d7" "$dr7" "$deu" "$del" \
          "${CONTROLLER_COOLDOWN:-10}" "${CONTROLLER_WORKERS:-1}" "${CONTROLLER_BINDING:-none}" \
          "$ARTICLE_COST_PCT" "${CONTROLLER_MODE:-pacing}"
      fi
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

  # Log completion event for calibration (after worker finishes)
  if [ "$LEGACY_QUOTA" != true ]; then
    c_readings=$(get_dual_quota_readings 2>/dev/null) || c_readings="0|-1|0|-1|0|0|0"
    IFS='|' read -r c5 cr5 c7 cr7 ceu cel cee <<< "$c_readings"
    quota_history_append "complete" "$c5" "$cr5" "$c7" "$cr7" "$ceu" "$cel" \
      "${CONTROLLER_COOLDOWN:-10}" "${CONTROLLER_WORKERS:-1}" "${CONTROLLER_BINDING:-none}" \
      "$ARTICLE_COST_PCT" "${CONTROLLER_MODE:-pacing}"
    # Re-calibrate after each completion
    calibrate_article_cost
  fi

  # Re-compute cooldown with fresh quota after worker completion
  if [ "$LEGACY_QUOTA" != true ]; then
    IN_FLIGHT=${#WORKER_PID[@]}
    fresh_tick=$(controller_tick "$IN_FLIGHT") || fresh_tick=""
    if [ -n "$fresh_tick" ]; then
      IFS='|' read -r CONTROLLER_COOLDOWN CONTROLLER_WORKERS CONTROLLER_BINDING CONTROLLER_MODE <<< "$fresh_tick"
    fi
  fi
  CONTROLLER_COOLDOWN="${CONTROLLER_COOLDOWN:-10}"
  tlog "Cooldown: ${CONTROLLER_COOLDOWN}s before next dispatch cycle."
  rc_interruptible_sleep "${CONTROLLER_COOLDOWN}" || true
done
