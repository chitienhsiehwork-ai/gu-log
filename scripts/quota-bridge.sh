#!/usr/bin/env bash
# quota-bridge.sh — Bridge between usage-monitor.sh (real-time quota) and score-loop judges
# Sources into judge scripts. Provides real quota check functions.
#
# Requires: usage-monitor.sh --json accessible at USAGE_MONITOR_PATH
set -euo pipefail

USAGE_MONITOR_PATH="${USAGE_MONITOR_PATH:-$HOME/clawd/scripts/usage-monitor.sh}"

# Cache quota JSON for 120s to avoid hammering APIs (and getting 429'd)
_QUOTA_CACHE=""
_QUOTA_CACHE_TS=0
_QUOTA_CACHE_TTL=120

# Per-provider last-known-good cache (survives 429 errors)
# Written to /tmp so it persists across source-loads within the same daemon
_QUOTA_LKG_DIR="/tmp/quota-bridge-lkg"
mkdir -p "$_QUOTA_LKG_DIR" 2>/dev/null || true

# Per-provider pacing lock: when a provider says "sleep N seconds",
# write the resume-after timestamp. Don't re-check until then.
_QUOTA_PACING_DIR="/tmp/quota-bridge-pacing"
mkdir -p "$_QUOTA_PACING_DIR" 2>/dev/null || true

# Write a pacing lock: don't check this provider again until $2 seconds from now
_set_pacing_lock() {
  local provider="$1" seconds="$2"
  local resume_at=$(( $(date +%s) + seconds ))
  echo "$resume_at" > "$_QUOTA_PACING_DIR/${provider}.lock"
}

# Check if a pacing lock is active. Returns the cached status if locked.
# Returns 1 if no lock or lock expired (caller should do a real check).
_check_pacing_lock() {
  local provider="$1"
  local lock_file="$_QUOTA_PACING_DIR/${provider}.lock"
  [ -f "$lock_file" ] || return 1
  local resume_at now remaining
  resume_at=$(cat "$lock_file")
  now=$(date +%s)
  if [ "$now" -lt "$resume_at" ]; then
    remaining=$(( resume_at - now ))
    local h=$(( remaining / 3600 ))
    local m=$(( (remaining % 3600) / 60 ))
    local human
    if [ "$h" -gt 0 ]; then
      human="${h}h${m}m"
    else
      human="${m}m"
    fi
    echo "pacing:${remaining}(${human})"
    return 0
  fi
  # Lock expired — remove and let caller re-check
  rm -f "$lock_file"
  return 1
}

_fetch_quota_json() {
  local now
  now="$(date +%s)"
  if [ -n "$_QUOTA_CACHE" ] && [ $(( now - _QUOTA_CACHE_TS )) -lt "$_QUOTA_CACHE_TTL" ]; then
    echo "$_QUOTA_CACHE"
    return 0
  fi

  if [ ! -f "$USAGE_MONITOR_PATH" ]; then
    echo '[]'
    return 0  # degrade gracefully — callers treat empty array as "no data"
  fi

  _QUOTA_CACHE="$(bash "$USAGE_MONITOR_PATH" --json 2>/dev/null || echo '[]')"
  _QUOTA_CACHE_TS="$now"
  echo "$_QUOTA_CACHE"
}

# Invalidate cache (call after a run to get fresh data next time)
quota_invalidate_cache() {
  _QUOTA_CACHE=""
  _QUOTA_CACHE_TS=0
}

# ─── OpenAI (Codex) ──────────────────────────────
# Returns: ok | sleep:<seconds> | exhausted
codex_real_quota_check() {
  local _locked
  if _locked=$(_check_pacing_lock codex); then
    echo "$_locked"
    return 0
  fi

  local json provider_json status remaining_5h remaining_7d reset_min reset_hr
  json="$(_fetch_quota_json)"

  provider_json="$(echo "$json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for d in data:
    if d.get('provider') == 'openai':
        json.dump(d, sys.stdout)
        sys.exit(0)
print('{}')
" 2>/dev/null)"

  status="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null)"
  if [ "$status" = "ok" ]; then
    echo "$provider_json" > "$_QUOTA_LKG_DIR/codex.json"
  else
    if [ -f "$_QUOTA_LKG_DIR/codex.json" ]; then
      provider_json="$(cat "$_QUOTA_LKG_DIR/codex.json")"
    else
      echo "sleep:3600"
      return 0
    fi
  fi

  remaining_5h="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_remaining_pct',0))" 2>/dev/null)"
  remaining_7d="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('weekly_remaining_pct',0))" 2>/dev/null)"
  reset_min="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_reset_min',0))" 2>/dev/null)"
  reset_hr="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('weekly_reset_hr',0))" 2>/dev/null)"
  limit_reached="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('limit_reached',False))" 2>/dev/null)"

  if [ "$limit_reached" = "True" ]; then
    echo "exhausted"
    return 0
  fi

  # Budget pacing: spread remaining runs evenly across remaining time
  local _codex_result
  _codex_result=$(python3 -c "
import json, os, time

remaining_5h = $remaining_5h
remaining_7d = $remaining_7d
reset_min = $reset_min
reset_hr = $reset_hr

FLOOR = 10  # hard floor: stop when critically low

if remaining_7d < FLOOR:
    wait = max(300, int(reset_hr * 3600))
    print(f'sleep:{wait}')
elif remaining_5h < FLOOR:
    wait = max(300, int(reset_min * 60))
    print(f'sleep:{wait}')
else:
    # Estimate cost_per_run from local usage history
    usage_file = '/tmp/score-loop-codex-usage.json'
    cost_per_run = 0.4  # default: ~0.4% per run (observed baseline)

    try:
        state = json.load(open(usage_file))
        runs = sorted(int(x) for x in state.get('runs', []))
        now = int(time.time())
        window = 168 * 3600  # 7 days
        recent = [r for r in runs if r >= now - window]
        if len(recent) >= 3:
            # used% / run_count = cost per run
            used_pct = 100 - remaining_7d
            cost_per_run = max(0.1, used_pct / len(recent))
    except Exception:
        pass

    # How many more runs can we afford?
    runs_remaining = remaining_7d / cost_per_run
    remaining_seconds = reset_hr * 3600

    if runs_remaining < 1:
        # Can't even afford 1 more run — sleep until reset
        print(f'sleep:{max(300, int(remaining_seconds))}')
    else:
        # Ideal interval between runs to spread evenly
        interval = remaining_seconds / runs_remaining

        # If interval > 300s (5min), we need to sleep.
        # But we JUST ran one, so sleep until next slot.
        # Minimum 120s (orchestrator cooldown), cap at 7200s (2hr).
        if interval <= 120:
            print('running')
        else:
            wait = min(7200, max(120, int(interval)))
            h = f'{wait//3600}h{(wait%3600)//60}m' if wait >= 3600 else f'{wait//60}m'
            print(f'pacing:{wait}({h})')
" 2>/dev/null)

  if [[ "$_codex_result" == pacing:* ]]; then
    local _secs="${_codex_result%%(*}"
    _secs="${_secs#pacing:}"
    _set_pacing_lock codex "$_secs"
  elif [[ "$_codex_result" == sleep:* ]]; then
    local _secs="${_codex_result#sleep:}"
    _set_pacing_lock codex "$_secs"
  fi
  echo "$_codex_result"
}

# ─── Gemini ──────────────────────────────────────
# Checks Pro tier quota (shared across 2.5-pro, 3-pro, 3.1-pro)
gemini_real_quota_check() {
  local _locked
  if _locked=$(_check_pacing_lock gemini); then
    echo "$_locked"
    return 0
  fi

  local json provider_json status
  json="$(_fetch_quota_json)"

  provider_json="$(echo "$json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for d in data:
    if d.get('provider') == 'gemini':
        json.dump(d, sys.stdout)
        sys.exit(0)
print('{}')
" 2>/dev/null)"

  status="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null)"
  if [ "$status" = "ok" ]; then
    echo "$provider_json" > "$_QUOTA_LKG_DIR/gemini.json"
  else
    if [ -f "$_QUOTA_LKG_DIR/gemini.json" ]; then
      provider_json="$(cat "$_QUOTA_LKG_DIR/gemini.json")"
    else
      echo "sleep:3600"
      return 0
    fi
  fi

  local _gemini_result
  _gemini_result=$(python3 -c "
import json, sys
from datetime import datetime, timezone

data = json.loads('''$provider_json''')
models = data.get('models', {})

# Find Pro tier (shared bucket)
pro_remaining = 100
pro_reset = ''
for model, info in models.items():
    if 'pro' in model and 'preview' in model:
        if info['remaining_pct'] < pro_remaining:
            pro_remaining = info['remaining_pct']
            pro_reset = info.get('reset', '')

# Gemini resets daily, not weekly — compute time until reset
reset_seconds = 86400  # default 24hr
if pro_reset:
    try:
        dt = datetime.fromisoformat(pro_reset.replace('Z', '+00:00'))
        reset_seconds = max(300, int((dt - datetime.now(timezone.utc)).total_seconds()))
    except:
        pass

# Budget pacing: spread usage linearly across the day
DAY = 86400
FLOOR = 10
BURST = 5

elapsed = DAY - reset_seconds
used_pct = 100 - pro_remaining
ideal_used = (elapsed / DAY) * 100 if DAY > 0 else 0

if pro_remaining < FLOOR:
    wait = max(300, reset_seconds)
    h = f'{wait//3600}h{(wait%3600)//60}m' if wait >= 3600 else f'{wait//60}m'
    print(f'pacing:{wait}({h})')
elif used_pct > ideal_used + BURST:
    # Over budget — sleep until linear pace catches up
    sleep_needed = int((used_pct / 100) * DAY - elapsed)
    sleep_needed = max(300, min(sleep_needed, reset_seconds))
    h = f'{sleep_needed//3600}h{(sleep_needed%3600)//60}m' if sleep_needed >= 3600 else f'{sleep_needed//60}m'
    print(f'pacing:{sleep_needed}({h})')
else:
    print('running')
" 2>/dev/null)

  if [[ "$_gemini_result" == pacing:* ]]; then
    local _secs="${_gemini_result%%(*}"
    _secs="${_secs#pacing:}"
    _set_pacing_lock gemini "$_secs"
  elif [[ "$_gemini_result" == sleep:* ]]; then
    local _secs="${_gemini_result#sleep:}"
    _set_pacing_lock gemini "$_secs"
  fi
  echo "$_gemini_result"
}

# ─── Claude (Opus) ──────────────────────────────
claude_real_quota_check() {
  # If we already know Claude is pacing, don't bother checking API
  local _locked
  if _locked=$(_check_pacing_lock claude); then
    echo "$_locked"
    return 0
  fi

  local json provider_json status
  json="$(_fetch_quota_json)"

  provider_json="$(echo "$json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for d in data:
    if d.get('provider') == 'claude':
        json.dump(d, sys.stdout)
        sys.exit(0)
print('{}')
" 2>/dev/null)"

  status="$(echo "$provider_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null)"
  if [ "$status" = "ok" ]; then
    # Save last-known-good data
    echo "$provider_json" > "$_QUOTA_LKG_DIR/claude.json"
  else
    # API error (429, etc.) — try last-known-good, otherwise sleep 1hr
    if [ -f "$_QUOTA_LKG_DIR/claude.json" ]; then
      provider_json="$(cat "$_QUOTA_LKG_DIR/claude.json")"
      # Fall through to budget pacing with stale data (still better than 5min loop)
    else
      echo "sleep:3600"
      return 0
    fi
  fi

  local _claude_result
  _claude_result=$(python3 -c "
import json

data = json.loads('''$provider_json''')

remaining_5h = data.get('five_hr_remaining_pct', 0)
remaining_7d = data.get('weekly_remaining_pct', 0)

def parse_reset(s):
    '''Parse Chinese reset strings like '5.0 天' or '2.0 小時' to seconds.'''
    try:
        if '天' in s:
            return int(float(s.replace(' 天', '')) * 86400)
        elif '小時' in s:
            return int(float(s.replace(' 小時', '')) * 3600)
        elif '分鐘' in s:
            return int(float(s.replace(' 分鐘', '')) * 60)
    except:
        pass
    return 0

WEEK = 7 * 86400
FLOOR = 10       # hard floor: never go below 10% weekly
BURST = 5        # allow 5% burst over ideal linear pace

weekly_reset_s = parse_reset(data.get('weekly_reset', '')) or (5 * 86400)
elapsed = WEEK - weekly_reset_s
used_pct = 100 - remaining_7d
ideal_used = (elapsed / WEEK) * 100 if WEEK > 0 else 0

if remaining_7d < FLOOR:
    # Critically low — sleep until weekly reset
    wait = max(300, weekly_reset_s)
    h = f'{wait//3600}h{(wait%3600)//60}m' if wait >= 3600 else f'{wait//60}m'
    print(f'pacing:{wait}({h})')
elif used_pct > ideal_used + BURST:
    # Over budget — sleep until ideal pace catches up to actual usage
    # Solve: (elapsed + t) / WEEK * 100 = used_pct
    sleep_needed = int((used_pct / 100) * WEEK - elapsed)
    sleep_needed = max(300, min(sleep_needed, weekly_reset_s))
    h = f'{sleep_needed//3600}h{(sleep_needed%3600)//60}m' if sleep_needed >= 3600 else f'{sleep_needed//60}m'
    print(f'pacing:{sleep_needed}({h})')
elif remaining_5h < 20:
    # 5hr session limit — short sleep until session resets
    wait_5h = parse_reset(data.get('five_hr_reset', '')) or 3600
    wait_5h = max(300, wait_5h)
    h = f'{wait_5h//3600}h{(wait_5h%3600)//60}m' if wait_5h >= 3600 else f'{wait_5h//60}m'
    print(f'pacing:{wait_5h}({h})')
else:
    print('running')
" 2>/dev/null)

  # Write pacing lock so we don't re-check until the sleep expires
  if [[ "$_claude_result" == pacing:* ]]; then
    local _secs="${_claude_result%%(*}"
    _secs="${_secs#pacing:}"
    _set_pacing_lock claude "$_secs"
  elif [[ "$_claude_result" == sleep:* ]]; then
    local _secs="${_claude_result#sleep:}"
    _set_pacing_lock claude "$_secs"
  fi
  echo "$_claude_result"
}
