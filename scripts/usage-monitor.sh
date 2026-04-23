#!/usr/bin/env bash
# usage-monitor.sh - Check AI subscription usage across providers
# Reads local auth tokens, hits usage APIs, outputs summary
#
# Supported: OpenAI (Codex), Google (Gemini), Anthropic (Claude - needs user:profile scope)
# Usage: ./usage-monitor.sh [--json]
#
# VENDORED FROM: clawd-vm:~/clawd/scripts/usage-monitor.sh
# VENDORED ON:   2026-04-23
# VENDOR NOTE:
#   This file is a vendored copy so the tribunal daemon can boot on a new
#   machine without the VM-side ~/clawd/ tree. The canonical copy is still
#   the VM version — `tribunal-quota-loop.sh` prefers that when available.
#   See openspec/changes/add-tribunal-v2-daemon/design.md §Decisions / §Risks
#   ("Quota vendor 漂移") for the resolution + drift-mitigation policy.
#   When the VM version ships a new feature, re-vendor via
#     scp clawd-vm:clawd/scripts/usage-monitor.sh scripts/usage-monitor.sh
#   and bump VENDORED ON.

set -euo pipefail

AUTH_FILE="$HOME/.openclaw/agents/main/agent/auth-profiles.json"
CODEX_AUTH_FILE="$HOME/.codex/auth.json"
JSON_MODE="${1:-}"

# ─── Shared file cache (cross-process, 2min TTL) ─────────
# Prevents multiple callers (/q, daemon, cron) from all hitting APIs independently
_USAGE_CACHE_DIR="/tmp/usage-monitor-cache"
_USAGE_CACHE_TTL=120  # seconds
mkdir -p "$_USAGE_CACHE_DIR" 2>/dev/null || true

_check_cache() {
    local provider="$1"
    local cache_file="$_USAGE_CACHE_DIR/${provider}.json"
    if [ -f "$cache_file" ]; then
        local age
        age=$(( $(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || echo 0) ))
        if [ "$age" -lt "$_USAGE_CACHE_TTL" ]; then
            cat "$cache_file"
            return 0
        fi
    fi
    return 1
}

_write_cache() {
    local provider="$1"
    local data="$2"
    echo "$data" > "$_USAGE_CACHE_DIR/${provider}.json"
}

# ─── OpenAI ───────────────────────────────────────────────
get_openai_usage() {
    local codex_token openclaw_token token
    local codex_state="missing"
    local openclaw_state="missing"

    codex_token=$(python3 -c "
import json
try:
    d = json.load(open('$CODEX_AUTH_FILE'))
    print(d.get('tokens', {}).get('access_token', ''))
except:
    print('')
" 2>/dev/null)

    openclaw_token=$(python3 -c "
import json
try:
    d = json.load(open('$AUTH_FILE'))
    print(d['profiles']['openai-codex:default'].get('access', ''))
except:
    print('')
" 2>/dev/null)

    token_jwt_state() {
        local t="$1"
        python3 - "$t" <<'PY'
import base64
import json
import sys
import time

token = sys.argv[1] if len(sys.argv) > 1 else ""
if not token:
    print("missing")
    sys.exit(0)

parts = token.split(".")
if len(parts) < 2:
    print("unknown")
    sys.exit(0)

payload = parts[1]
padding = "=" * ((4 - len(payload) % 4) % 4)
try:
    decoded = base64.urlsafe_b64decode(payload + padding).decode("utf-8")
    exp = json.loads(decoded).get("exp")
    if exp is None:
        print("unknown")
    elif int(exp) <= int(time.time()):
        print("expired")
    else:
        print("valid")
except Exception:
    print("unknown")
PY
    }

    codex_state=$(token_jwt_state "$codex_token")
    openclaw_state=$(token_jwt_state "$openclaw_token")

    if [[ -n "$codex_token" && "$codex_state" != "expired" ]]; then
        token="$codex_token"
    elif [[ -n "$openclaw_token" && "$openclaw_state" != "expired" ]]; then
        token="$openclaw_token"
    else
        token=""
    fi

    # If both sources are expired, ask Codex CLI to refresh and retry codex auth.
    if [[ -z "$token" && "$codex_state" == "expired" && "$openclaw_state" == "expired" ]]; then
        codex login status >/dev/null 2>&1 || true
        codex_token=$(python3 -c "
import json
try:
    d = json.load(open('$CODEX_AUTH_FILE'))
    print(d.get('tokens', {}).get('access_token', ''))
except:
    print('')
" 2>/dev/null)
        codex_state=$(token_jwt_state "$codex_token")
        if [[ -n "$codex_token" && "$codex_state" != "expired" ]]; then
            token="$codex_token"
        fi
    fi

    if [[ -z "$token" ]]; then
        if [[ -n "$codex_token" || -n "$openclaw_token" ]]; then
            if [[ "$codex_state" == "expired" || "$openclaw_state" == "expired" ]]; then
                echo '{"provider":"openai","status":"token_expired"}'
                return
            fi
        fi
        echo '{"provider":"openai","status":"no_token"}'
        return
    fi

    local result
    result=$(curl -sf --max-time 8 "https://chatgpt.com/backend-api/wham/usage" \
        -H "Authorization: Bearer $token" 2>/dev/null) || {
        echo '{"provider":"openai","status":"api_error"}'
        return
    }

    python3 -c "
import json, sys
d = json.loads('''$result''')
rl = d.get('rate_limit', {})
pw = rl.get('primary_window', {})
sw = rl.get('secondary_window', {})
out = {
    'provider': 'openai',
    'status': 'ok',
    'plan': d.get('plan_type', 'unknown'),
    'session_remaining_pct': 100 - pw.get('used_percent', 0),
    'session_reset_min': round(pw.get('reset_after_seconds', 0) / 60),
    'weekly_remaining_pct': 100 - sw.get('used_percent', 0),
    'weekly_reset_hr': round(sw.get('reset_after_seconds', 0) / 3600, 1),
    'limit_reached': rl.get('limit_reached', False),
}
print(json.dumps(out))
" 2>/dev/null || echo '{"provider":"openai","status":"parse_error"}'
}

# ─── Gemini ───────────────────────────────────────────────
get_gemini_usage() {
    local refresh project client_id client_secret
    refresh=$(python3 -c "
import json
d = json.load(open('$AUTH_FILE'))
print(d['profiles']['google-gemini-cli:chitienhsieh.work@gmail.com'].get('refresh', ''))
" 2>/dev/null)

    project=$(python3 -c "
import json
d = json.load(open('$AUTH_FILE'))
print(d['profiles']['google-gemini-cli:chitienhsieh.work@gmail.com'].get('projectId', ''))
" 2>/dev/null)

    if [[ -z "$refresh" ]]; then
        echo '{"provider":"gemini","status":"no_token"}'
        return
    fi

    # Gemini CLI OAuth client credentials.
    # VENDOR NOTE (gu-log): the upstream `~/clawd/scripts/usage-monitor.sh`
    # hardcodes Gemini's CLI OAuth client_id / client_secret here. GitHub push
    # protection rejects any commit containing them, so this vendored copy
    # reads them from env vars instead. Set GEMINI_CLI_CLIENT_ID /
    # GEMINI_CLI_CLIENT_SECRET if you want Gemini quota reporting on this
    # machine; leave them unset and the Gemini path gracefully skips.
    # The canonical VM copy still has the literals — that file is NOT in git.
    client_id="${GEMINI_CLI_CLIENT_ID:-}"
    client_secret="${GEMINI_CLI_CLIENT_SECRET:-}"

    if [[ -z "$client_id" || -z "$client_secret" ]]; then
        echo '{"provider":"gemini","status":"no_oauth_client"}'
        return
    fi

    # Refresh access token
    local token_result access_token
    token_result=$(curl -sf --max-time 8 "https://oauth2.googleapis.com/token" \
        -d "client_id=$client_id" \
        -d "client_secret=$client_secret" \
        -d "refresh_token=$refresh" \
        -d "grant_type=refresh_token" 2>/dev/null) || {
        echo '{"provider":"gemini","status":"refresh_error"}'
        return
    }

    access_token=$(echo "$token_result" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) || {
        echo '{"provider":"gemini","status":"refresh_parse_error"}'
        return
    }

    # Get quota
    local result
    result=$(curl -sf --max-time 8 "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota" \
        -H "Authorization: Bearer $access_token" \
        -H "Content-Type: application/json" \
        -d "{\"project\": \"$project\"}" 2>/dev/null) || {
        echo '{"provider":"gemini","status":"api_error"}'
        return
    }

    python3 -c "
import json
d = json.loads('''$result''')
buckets = d.get('buckets', [])
# Collect all non-vertex models
models = {}
for b in buckets:
    mid = b.get('modelId', '')
    if '_vertex' in mid:
        continue
    frac = b.get('remainingFraction', 1.0)
    reset = b.get('resetTime', '')
    if mid not in models or frac < models[mid]['remaining']:
        models[mid] = {'remaining': frac, 'reset': reset}

out = {
    'provider': 'gemini',
    'status': 'ok',
    'models': {m: {'remaining_pct': round(v['remaining']*100, 1), 'reset': v['reset']} for m, v in models.items()}
}
print(json.dumps(out))
" 2>/dev/null || echo '{"provider":"gemini","status":"parse_error"}'
}

# ─── Claude ───────────────────────────────────────────────
get_claude_usage() {
    local token
    local CREDS_FILE="$HOME/.claude/.credentials.json"
    local TOKEN_ENDPOINT="https://platform.claude.com/v1/oauth/token"
    local CLIENT_ID="9d1c250a-e61b-44d9-88ed-5944d1962f5e"

    # Try Claude Code OAuth token first (~/.claude/.credentials.json)
    # Auto-refresh if expired using curl (urllib gets 403 from Cloudflare)
    token=$(python3 -c "
import json, time, subprocess, sys

CREDS_FILE = '$CREDS_FILE'
TOKEN_ENDPOINT = '$TOKEN_ENDPOINT'
CLIENT_ID = '$CLIENT_ID'

try:
    d = json.load(open(CREDS_FILE))
    oauth = d.get('claudeAiOauth', {})
    token = oauth.get('accessToken', '')
    expires_at = oauth.get('expiresAt', 0)
    refresh = oauth.get('refreshToken', '')

    # Check if expired (with 5 min buffer)
    if token and expires_at > (time.time() * 1000 + 300000):
        print(token)
    elif refresh:
        # Refresh via curl (must be x-www-form-urlencoded, NOT JSON)
        # Ref: CodexBar ClaudeOAuthCredentialsStore.refreshAccessTokenCore
        from urllib.parse import urlencode
        payload = urlencode({
            'grant_type': 'refresh_token',
            'refresh_token': refresh,
            'client_id': CLIENT_ID,
        })
        r = subprocess.run(
            ['curl', '-s', '--max-time', '8', '-X', 'POST', TOKEN_ENDPOINT,
             '-H', 'Content-Type: application/x-www-form-urlencoded',
             '-H', 'Accept: application/json',
             '-d', payload],
            capture_output=True, text=True, timeout=15
        )
        curl_failed = r.returncode != 0 or not r.stdout.strip()
        curl_error = False
        if not curl_failed:
            result = json.loads(r.stdout)
            curl_error = 'error' in result

        if curl_failed or curl_error:
            # Fallback: run Claude CLI without CLAUDE_CODE_OAUTH_TOKEN env var
            # CLI reads credentials.json refresh_token and auto-refreshes
            import os
            cli_env = {k: v for k, v in os.environ.items()
                       if k not in ('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN')}
            cli_env.update({'TERM': 'dumb', 'NO_COLOR': '1'})
            cli_r = subprocess.run(
                ['claude', '--print', 'reply with just the word pong'],
                capture_output=True, text=True, timeout=20, env=cli_env
            )
            # Re-read credentials.json (CLI should have refreshed it)
            try:
                d2 = json.load(open(CREDS_FILE))
                oauth2 = d2.get('claudeAiOauth', {})
                new_token2 = oauth2.get('accessToken', '')
                new_expires2 = oauth2.get('expiresAt', 0)
                if new_token2 and new_expires2 > (time.time() * 1000 + 60000):
                    print(new_token2)
                else:
                    print('REFRESH_EXPIRED')
            except:
                print('REFRESH_EXPIRED')
        else:
                new_token = result['access_token']
                new_expires = int(time.time() * 1000) + result.get('expires_in', 28800) * 1000
                new_refresh = result.get('refresh_token', refresh)

                # Save back atomically (refresh tokens are single-use!)
                oauth['accessToken'] = new_token
                oauth['expiresAt'] = new_expires
                oauth['refreshToken'] = new_refresh
                d['claudeAiOauth'] = oauth
                with open(CREDS_FILE, 'w') as f:
                    json.dump(d, f)

                print(new_token)
    else:
        print(token or 'NO_OAUTH')
except Exception as e:
    print('', file=sys.stderr)
    print('')
" 2>/dev/null)

    # Handle refresh token expiry
    if [[ "$token" == "REFRESH_EXPIRED" ]]; then
        echo '{"provider":"claude","status":"refresh_expired"}'
        return
    fi

    if [[ "$token" == "NO_OAUTH" ]]; then
        token=""
    fi

    # Fallback to OpenClaw auth-profiles
    if [[ -z "$token" ]]; then
        token=$(python3 -c "
import json
d = json.load(open('$AUTH_FILE'))
p = d['profiles'].get('anthropic:cth.work', {})
print(p.get('token', p.get('access', '')))
" 2>/dev/null)
    fi

    if [[ -z "$token" ]]; then
        echo '{"provider":"claude","status":"no_token"}'
        return
    fi

    local result http_code
    local tmpfile
    tmpfile=$(mktemp)
    http_code=$(curl -s --max-time 8 -o "$tmpfile" -w "%{http_code}" \
        "https://api.anthropic.com/api/oauth/usage" \
        -H "Authorization: Bearer $token" \
        -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null) || {
        rm -f "$tmpfile"
        echo '{"provider":"claude","status":"api_error","detail":"curl failed"}'
        return
    }
    result=$(cat "$tmpfile")
    rm -f "$tmpfile"

    if [[ "$http_code" != "200" ]]; then
        # Try to extract error type/message from response body
        local err_detail
        err_detail=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    e = d.get('error', {})
    t = e.get('type', 'unknown')
    m = e.get('message', '')
    print(json.dumps({'provider':'claude','status':t,'detail':m,'http_code':int(sys.argv[2])}))
except:
    print(json.dumps({'provider':'claude','status':'api_error','detail':f'HTTP {sys.argv[2]}','http_code':int(sys.argv[2])}))
" "$result" "$http_code" 2>/dev/null)
        echo "$err_detail"
        return
    fi

    python3 -c "
import json
d = json.loads('''$result''')
five = d.get('five_hour', {})
seven = d.get('seven_day', {})
extra = d.get('extra_usage', {})
from datetime import datetime, timezone
def parse_reset(s):
    if not s: return ''
    try:
        dt = datetime.fromisoformat(s)
        delta = dt - datetime.now(timezone.utc)
        mins = delta.total_seconds() / 60
        if mins < 60: return f'{int(mins)} 分鐘'
        hrs = mins / 60
        if hrs < 24: return f'{hrs:.1f} 小時'
        return f'{hrs/24:.1f} 天'
    except: return s

out = {
    'provider': 'claude',
    'status': 'ok',
    'plan': d.get('subscriptionType', 'max'),
    'five_hr_used_pct': five.get('utilization', 0),
    'five_hr_remaining_pct': 100 - five.get('utilization', 0),
    'five_hr_reset': parse_reset(five.get('resets_at')),
    'weekly_used_pct': seven.get('utilization', 0),
    'weekly_remaining_pct': 100 - seven.get('utilization', 0),
    'weekly_reset': parse_reset(seven.get('resets_at')),
    'extra_usage_enabled': extra.get('is_enabled', False),
    'extra_used': extra.get('used_credits', 0),
    'extra_limit': extra.get('monthly_limit', 0),
}
print(json.dumps(out))
" 2>/dev/null || echo '{"provider":"claude","status":"parse_error"}'

}

# ─── Cached wrapper: check file cache → call API → write cache on success ───
_get_cached() {
    local provider="$1"
    local fn="$2"
    local cached_result
    if cached_result=$(_check_cache "$provider"); then
        echo "$cached_result"
        return
    fi
    local result
    result=$($fn)
    # Cache if API returned ok status (don't cache errors/429s)
    local status
    status=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    if [ "$status" = "ok" ]; then
        _write_cache "$provider" "$result"
    fi
    echo "$result"
}

# ─── Main ─────────────────────────────────────────────────
openai=$(_get_cached openai get_openai_usage)
gemini=$(_get_cached gemini get_gemini_usage)
claude=$(_get_cached claude get_claude_usage)

if [[ "$JSON_MODE" == "--json" ]]; then
    echo "[$openai,$gemini,$claude]"
    exit 0
fi

# Pretty print
KAOMOJI=(
  '(◍ᴗ◍)' '(˃ᴗ˂)' '(◍•ᴗ•◍)' '(๑˃ᴗ˂๑)' '(≧ᗜ≦)' '(・ω・)' '(^ω^)'
  '(◍˃̶ᗜ˂̶◍)' '(๑ᗜ๑)' '(✿◠ᴗ◠)' '(◕ᴗ◕)' '(≧▽≦)' '(´▽`)' '(๑>◡<๑)'
  '(◍•ω•◍)' '(๑•ᴗ•๑)' '(◍ᵔᴗᵔ◍)' '(๑◕ᴗ◕๑)' '(੭˙ᗜ˙)੭' '(っᗜ)っ'
  '(๑˃̵ᴗ˂̵)و' '(◍•ᴗ•◍)ゝ' '(´▽`)ﾉ' '(◕ᴗ◕✿)' '(◡ᴗ◡✿)' '(o^▽^o)'
  '(๑•́ᴗ•̀)' '(๑ᵕᴗᵕ๑)' '(´꒳`)' '(・∀・)' '(・∇・)' '(´ω`)'
  '(˃̶͈̀ᗜ˂̶͈́)' '(つ◕ᴗ◕)つ' '(๑◕ᗜ◕๑)' '(◍◉ᴗ◉◍)' '(◍´ω`◍)'
  '(o^∀^o)' '(´∀`)' '(￣▽￣)' '(◍•﹏•◍)' '(╥﹏╥)' '(◍•㉦•◍)'
  '( ˊᵕˋ )' '( ˘ᴗ˘ )' '(ᵔᴗᵔ)' '(ㅎᴗㅎ)' '(ᴗ̤ᴗ̤)' '(ノ◕ᴗ◕)ノ'
  '(ꈍᴗꈍ)' '(˶ᵔᴗᵔ˶)' '(ㆁᴗㆁ)' '(ᵕ̈ᴗᵕ̈)' '(ᗒᗨᗕ)' '(ᗒᴗᗕ)'
  '(ˊo̴̶̷̤ᴗo̴̶̷̤ˋ)' '( ˶ˆᗜˆ˵ )' '(ᐢᗜᐢ)' '(ᵔ◡ᵔ)' '(⑅˃◡˂⑅)'
  '(˃ᗜ˂)' '(ᗜ˰ᗜ)' '(ᗒᗣᗕ)' '(ᵕᴗᵕ)' '(✧ᴗ✧)' '( ᵔᴗᵔ)b'
  '(ᴗ͈ˬᴗ͈)' '(◍ᴗ◍)♡' '(๑˃ᴗ˂)ﻭ' '(˃̵ᴗ˂̵)' '(ꈍωꈍ)' '(◕ω◕)'
  '(˶ᵔ ᵕ ᵔ˶)' '(ᐢ..ᐢ)' '(ᵒ̤̑ᴗᵒ̤̑)' '(˃̵͈̑ᴗ˂̵͈̑)' '(ᗜᴗᗜ)'
  '( ᐛ )' '(ᗒᗕ)' '(˶ˆ꒳ˆ˶)' '(ᗒᗩᗕ)' '(⊃ᴗ⊂)' '(˃ᗝ˂)'
  '(˃̶ᴗ˂̶)' '(ᵔ̤̮ᴗᵔ̤̮)' '(◕‿◕)' '(ꈍᴗꈍ)♡' '(╹ᴗ╹)' '(˶•ᴗ•˶)'
  '(ᐡᴗᐡ)' '(◠ᴗ◠)' '(ꕤᴗꕤ)' '(ᐢᴗᐢ)♡' '(˃ᴗ˂)و' '(ᗒᴗᗕ)♪'
  '(ᵔᗜᵔ)' '(˶ᵔᵕᵔ˶)' '(◍ᗜ◍)' '(ᗜ˰ᗜ)♪' '(⊙ᴗ⊙)' '(◕ᴗ◕)ノ'
  '(˶ˊᗜˋ˵)' '(ᵔ˰ᵔ)' '(ᐢᵕᐢ)'
)
FACE="${KAOMOJI[$((RANDOM % ${#KAOMOJI[@]}))]}"
echo "📊 AI 額度 $FACE"
echo "──────────"

# OpenAI
echo ""
echo "🟢 OpenAI ($( echo "$openai" | python3 -c "import json,sys; print(json.load(sys.stdin).get('plan','?'))" 2>/dev/null ))"
python3 -c "
import json
d = json.loads('''$openai''')
if d['status'] != 'ok':
    print(f'⚠️ {d[\"status\"]}')
else:
    def fmt(minutes):
        if minutes < 60: return f'{minutes}min'
        h = minutes / 60
        if h < 24: return f'{h:.1f}hr'
        return f'{h/24:.1f}天'
    sm = d['session_reset_min']
    wm = round(d['weekly_reset_hr'] * 60)
    print(f'5hr  {d[\"session_remaining_pct\"]}% ⏳{fmt(sm)}')
    print(f'Week {d[\"weekly_remaining_pct\"]}% ⏳{fmt(wm)}')
    if d['limit_reached']:
        print('🚨 已達上限！')
" 2>/dev/null

# Gemini
echo ""
echo "🔵 Gemini"
python3 -c "
import json
from datetime import datetime, timezone
d = json.loads('''$gemini''')
if d['status'] != 'ok':
    print(f'⚠️ {d[\"status\"]}')
else:
    def fmt(s):
        if not s: return ''
        try:
            dt = datetime.fromisoformat(s.replace('Z','+00:00'))
            m = (dt - datetime.now(timezone.utc)).total_seconds() / 60
            if m < 60: return f'{int(m)}min'
            h = m / 60
            if h < 24: return f'{h:.1f}hr'
            return f'{h/24:.1f}天'
        except: return s
    tiers = {'lite': [], 'flash': [], 'pro': []}
    for model, info in d['models'].items():
        if 'lite' in model: tiers['lite'].append(info)
        elif 'flash' in model: tiers['flash'].append(info)
        elif 'pro' in model: tiers['pro'].append(info)
    for key, label in [('lite','Lite'),('flash','Flash'),('pro','Pro')]:
        items = tiers[key]
        if not items: continue
        w = min(items, key=lambda x: x['remaining_pct'])
        print(f'{label} {w[\"remaining_pct\"]}% ⏳{fmt(w.get(\"reset\",\"\"))}')
" 2>/dev/null

# Claude
echo ""
echo "🟠 Claude"
python3 -c "
import json
d = json.loads('''$claude''')
if d['status'] == 'refresh_expired':
    print('⚠️ OAuth token 過期')
    print('→ Mac 跑 claude login')
elif d['status'] == 'rate_limit_error':
    print('⚠️ rate limited (429)')
    print('→ 稍後再試')
elif d['status'] != 'ok':
    detail = d.get('detail', '')
    http_code = d.get('http_code', '')
    msg = d['status']
    if detail:
        msg += f' — {detail}'
    if http_code:
        msg += f' (HTTP {http_code})'
    print(f'⚠️ {msg}')
else:
    print(f'5hr  {d[\"five_hr_remaining_pct\"]}% ⏳{d[\"five_hr_reset\"]}')
    print(f'Week {d[\"weekly_remaining_pct\"]}% ⏳{d[\"weekly_reset\"]}')
    if d.get('extra_usage_enabled'):
        s = d['extra_used'] / 100
        l = d['extra_limit'] / 100
        print(f'Extra \${s:.2f}/\${l:.0f}')
" 2>/dev/null

echo ""
echo "──────────"
TZ=Asia/Taipei date +"⏰ %Y-%m-%d %H:%M UTC+8"
