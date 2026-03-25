#!/usr/bin/env bash
# quota-bridge.sh — Bridge between usage-monitor.sh (real-time quota) and score-loop judges
# Sources into judge scripts. Provides real quota check functions.
#
# Requires: usage-monitor.sh --json accessible at USAGE_MONITOR_PATH
set -euo pipefail

USAGE_MONITOR_PATH="${USAGE_MONITOR_PATH:-$HOME/clawd/scripts/usage-monitor.sh}"

# Cache quota JSON for 60s to avoid hammering APIs
_QUOTA_CACHE=""
_QUOTA_CACHE_TS=0
_QUOTA_CACHE_TTL=60

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
  if [ "$status" != "ok" ]; then
    echo "sleep:300"
    return 0
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

  # Dispatch floor = 20%
  python3 -c "
remaining_5h = $remaining_5h
remaining_7d = $remaining_7d
reset_min = $reset_min
reset_hr = $reset_hr

FLOOR = 20

if remaining_7d < FLOOR:
    wait = max(300, int(reset_hr * 3600))
    print(f'sleep:{wait}')
elif remaining_5h < FLOOR:
    wait = max(300, int(reset_min * 60))
    print(f'sleep:{wait}')
else:
    print('ok')
" 2>/dev/null
}

# ─── Gemini ──────────────────────────────────────
# Checks Pro tier quota (shared across 2.5-pro, 3-pro, 3.1-pro)
gemini_real_quota_check() {
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
  if [ "$status" != "ok" ]; then
    echo "sleep:300"
    return 0
  fi

  python3 -c "
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

FLOOR = 20

if pro_remaining < FLOOR:
    # Calculate wait until reset
    if pro_reset:
        try:
            dt = datetime.fromisoformat(pro_reset.replace('Z', '+00:00'))
            wait = int((dt - datetime.now(timezone.utc)).total_seconds())
            wait = max(300, wait)
            print(f'sleep:{wait}')
        except:
            print('sleep:3600')
    else:
        print('sleep:3600')
else:
    print('ok')
" 2>/dev/null
}

# ─── Claude (Opus) ──────────────────────────────
claude_real_quota_check() {
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
  if [ "$status" != "ok" ]; then
    echo "sleep:300"
    return 0
  fi

  python3 -c "
import json
data = json.loads('''$provider_json''')

remaining_5h = data.get('five_hr_remaining_pct', 0)
remaining_7d = data.get('weekly_remaining_pct', 0)

FLOOR = 20

if remaining_7d < FLOOR:
    # Parse weekly reset time
    reset_str = data.get('weekly_reset', '')
    wait = 43200  # default 12hr
    try:
        if '小時' in reset_str:
            wait = int(float(reset_str.replace(' 小時', '')) * 3600)
        elif '天' in reset_str:
            wait = int(float(reset_str.replace(' 天', '')) * 86400)
    except:
        pass
    wait = max(300, wait)
    print(f'sleep:{wait}')
elif remaining_5h < FLOOR:
    # Parse session reset time
    reset_str = data.get('five_hr_reset', '')
    wait = 3600  # default 1hr
    try:
        if '分鐘' in reset_str:
            wait = int(float(reset_str.replace(' 分鐘', '')) * 60)
        elif '小時' in reset_str:
            wait = int(float(reset_str.replace(' 小時', '')) * 3600)
        elif '天' in reset_str:
            wait = int(float(reset_str.replace(' 天', '')) * 86400)
    except:
        pass
    wait = max(300, wait)
    print(f'sleep:{wait}')
else:
    print('ok')
" 2>/dev/null
}
