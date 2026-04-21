#!/usr/bin/env bash
set -euo pipefail

SCORE_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_ROOT="$(cd "$SCORE_HELPERS_DIR/.." && pwd)"
export SCORE_ROOT

# shellcheck source=scripts/ralph-helpers.sh
source "$SCORE_ROOT/scripts/ralph-helpers.sh"

ensure_score_dirs() {
  mkdir -p \
    "$SCORE_ROOT/scores" \
    "$SCORE_ROOT/.score-loop/logs" \
    "$SCORE_ROOT/.score-loop/tmp"

  [ -e "$SCORE_ROOT/scores/.gitkeep" ] || : > "$SCORE_ROOT/scores/.gitkeep"
}

score_manifest_path() {
  local judge="$1"
  echo "$SCORE_ROOT/scores/${judge}-scores.json"
}

usage_state_path() {
  local judge="$1"
  echo "/tmp/score-loop-${judge}-usage.json"
}

iso_now() {
  TZ=Asia/Taipei date -Iseconds
}

log_date_stamp() {
  TZ=Asia/Taipei date +%Y%m%d
}

calc_headroom() {
  local remaining_pct="$1"
  local time_remaining_pct="$2"
  awk -v remaining="$remaining_pct" -v time_left="$time_remaining_pct" 'BEGIN { printf "%.4f", (remaining + 0) - (time_left + 0) }'
}

remaining_pct_from_counts() {
  local count="$1"
  local max_runs="$2"
  awk -v count="$count" -v max_runs="$max_runs" 'BEGIN {
    if ((max_runs + 0) <= 0) {
      print "0.0000"
      exit
    }
    remaining = ((max_runs - count) / max_runs) * 100
    if (remaining < 0) remaining = 0
    printf "%.4f", remaining
  }'
}

pct_from_seconds() {
  local seconds="$1"
  local window_seconds="$2"
  awk -v seconds="$seconds" -v window="$window_seconds" 'BEGIN {
    if ((window + 0) <= 0) {
      print "0.0000"
      exit
    }
    pct = (seconds / window) * 100
    if (pct < 0) pct = 0
    if (pct > 100) pct = 100
    printf "%.4f", pct
  }'
}

check_dual_quota() {
  local remaining_5h_pct="$1"
  local time_to_5h_reset_pct="$2"
  local remaining_7d_pct="$3"
  local time_to_7d_reset_pct="$4"

  local headroom_5h headroom_7d
  headroom_5h="$(calc_headroom "$remaining_5h_pct" "$time_to_5h_reset_pct")"
  headroom_7d="$(calc_headroom "$remaining_7d_pct" "$time_to_7d_reset_pct")"

  local weekly_remaining_int five_remaining_int
  weekly_remaining_int="$(awk -v x="$remaining_7d_pct" 'BEGIN { printf "%d", x + 0 }')"
  five_remaining_int="$(awk -v x="$remaining_5h_pct" 'BEGIN { printf "%d", x + 0 }')"

  if awk -v a="$headroom_5h" -v b="$headroom_7d" 'BEGIN { exit !((a > 0) && (b > 0)) }'; then
    echo "ok"
    return 0
  fi

  if [ "$weekly_remaining_int" -le 0 ]; then
    echo "exhausted"
    return 0
  fi

  if [ "$five_remaining_int" -le 0 ]; then
    local wait_5h
    wait_5h="$(awk -v pct="$time_to_5h_reset_pct" 'BEGIN {
      secs = int((pct / 100.0) * 18000)
      if (secs < 300) secs = 300
      print secs
    }')"
    echo "sleep:${wait_5h}"
    return 0
  fi

  local wait_5h wait_7d sleep_secs
  wait_5h="$(awk -v pct="$time_to_5h_reset_pct" 'BEGIN {
    secs = int((pct / 100.0) * 18000)
    if (secs < 300) secs = 300
    print secs
  }')"
  wait_7d="$(awk -v pct="$time_to_7d_reset_pct" 'BEGIN {
    secs = int((pct / 100.0) * 604800)
    if (secs < 300) secs = 300
    print secs
  }')"

  sleep_secs="$(awk -v a="$wait_5h" -v b="$wait_7d" 'BEGIN {
    if ((a + 0) <= 0) print b
    else if ((b + 0) <= 0) print a
    else if (a < b) print a
    else print b
  }')"

  if [ "$sleep_secs" -ge 43200 ]; then
    echo "exhausted"
  else
    echo "sleep:${sleep_secs}"
  fi
}

ensure_manifest_file() {
  local judge="$1"
  local manifest
  manifest="$(score_manifest_path "$judge")"
  ensure_score_dirs

  if [ ! -f "$manifest" ]; then
    printf '{}\n' > "$manifest"
    return 0
  fi

  if ! jq empty "$manifest" >/dev/null 2>&1; then
    printf '{}\n' > "$manifest"
  fi
}

# Find the zh-tw MDX file for a given ticketId (returns full path or empty)
find_post_file_for_ticket() {
  local ticket_id="$1"
  local escaped_id
  escaped_id="$(printf '%s' "$ticket_id" | sed 's/[.*[\^${}|()]/\\&/g')"
  grep -rl "ticketId: \"${escaped_id}\"" "$SCORE_ROOT/src/content/posts/" 2>/dev/null \
    | grep -v '/en-' | head -1
}

# Write score JSON to MDX frontmatter via node helper.
# Also writes to the en-* counterpart if it exists.
write_score_to_frontmatter() {
  local file="$1"
  local judge="$2"
  local score_json="$3"

  node "$SCORE_ROOT/scripts/frontmatter-scores.mjs" write "$file" "$judge" "$score_json"

  # Mirror to en-* counterpart
  local base dir en_file
  base="$(basename "$file")"
  dir="$(dirname "$file")"
  en_file="$dir/en-$base"
  if [ -f "$en_file" ]; then
    node "$SCORE_ROOT/scripts/frontmatter-scores.mjs" write "$en_file" "$judge" "$score_json"
  fi
}

get_score() {
  local judge="$1"
  local ticket_id="$2"
  local post_file
  post_file="$(find_post_file_for_ticket "$ticket_id")"
  [ -n "$post_file" ] || return 0
  node "$SCORE_ROOT/scripts/frontmatter-scores.mjs" get "$post_file" "$judge"
}

write_score() {
  local judge="$1"
  local ticket_id="$2"
  local score_json="$3"
  local post_file
  post_file="$(find_post_file_for_ticket "$ticket_id")"
  if [ -z "$post_file" ]; then
    echo "[write_score] WARNING: no file found for ticketId $ticket_id" >&2
    return 1
  fi
  write_score_to_frontmatter "$post_file" "$judge" "$score_json"
}

list_all_posts() {
  find "$SCORE_ROOT/src/content/posts" -maxdepth 1 -type f -name '*.mdx' ! -name 'en-*' -printf '%f\n' | sort
}

normalize_json_file() {
  local json_file="$1"
  [ -f "$json_file" ] || return 1

  python3 - "$json_file" <<'PY'
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
text = text.strip()
if not text:
    sys.exit(1)

text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
text = re.sub(r'\s*```$', '', text)

decoder = json.JSONDecoder()
for idx, ch in enumerate(text):
    if ch not in '{[':
        continue
    try:
        obj, _ = decoder.raw_decode(text[idx:])
    except Exception:
        continue
    # Schema-normalize common model drift before validation:
    #   scores    → dimensions (Sonnet/Opus sometimes emit this)
    #   composite → score
    #   pass:bool → verdict:"PASS"/"FAIL"
    if isinstance(obj, dict):
        if 'dimensions' not in obj and isinstance(obj.get('scores'), dict):
            obj['dimensions'] = obj.pop('scores')
        if 'score' not in obj and isinstance(obj.get('composite'), (int, float)):
            obj['score'] = int(obj.pop('composite'))
        if 'verdict' not in obj and isinstance(obj.get('pass'), bool):
            obj['verdict'] = 'PASS' if obj['pass'] else 'FAIL'
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    sys.exit(0)

sys.exit(1)
PY
}

validate_judge_score_json() {
  local judge="$1"
  local json_file="$2"

  [ -f "$json_file" ] || return 1
  normalize_json_file "$json_file" || return 1
  jq empty "$json_file" >/dev/null 2>&1 || return 1

  local score
  score="$(jq -r '.score // empty' "$json_file")"

  [[ "$score" =~ ^[0-9]+$ ]] || return 1
  [ "$score" -ge 0 ] && [ "$score" -le 10 ] || return 1

  # Validate dimensions for each tribunal judge (uniform JSON: { judge, dimensions, score, verdict, reasons })
  local _validate_dim
  _validate_dim() {
    local val
    val="$(jq -r ".dimensions.${1} // empty" "$json_file")"
    [[ "$val" =~ ^[0-9]+$ ]] || return 1
    [ "$val" -ge 0 ] && [ "$val" -le 10 ] || return 1
  }

  case "$judge" in
    librarian)
      _validate_dim glossary    || return 1
      _validate_dim crossRef    || return 1
      _validate_dim sourceAlign || return 1
      _validate_dim attribution || return 1
      ;;
    factCheck|fact-checker)
      _validate_dim accuracy    || return 1
      _validate_dim fidelity    || return 1
      _validate_dim consistency || return 1
      ;;
    freshEyes|fresh-eyes)
      _validate_dim readability     || return 1
      _validate_dim firstImpression || return 1
      ;;
    vibe|vibe-opus-scorer)
      _validate_dim persona    || return 1
      _validate_dim clawdNote  || return 1
      _validate_dim vibe       || return 1
      _validate_dim clarity    || return 1
      _validate_dim narrative  || return 1
      ;;
    *)
      return 1
      ;;
  esac
}

looks_rate_limited() {
  local file="$1"
  [ -f "$file" ] || return 1
  grep -Eiq '(^|[^0-9])429([^0-9]|$)|rate limit|too many requests|resource exhausted|quota exceeded|usage limit|try again later' "$file"
}

ensure_usage_state() {
  local judge="$1"
  local usage_file
  usage_file="$(usage_state_path "$judge")"
  if [ ! -f "$usage_file" ]; then
    printf '{"runs":[],"last_run":null,"last_429":null,"backoff_seconds":0}\n' > "$usage_file"
    return 0
  fi
  jq empty "$usage_file" >/dev/null 2>&1 || printf '{"runs":[],"last_run":null,"last_429":null,"backoff_seconds":0}\n' > "$usage_file"
}

default_rate_limit_backoff() {
  case "$1" in
    librarian|sonnet) echo 600 ;;
    factCheck|fact-checker|vibe|vibe-opus-scorer|opus) echo 1200 ;;
    freshEyes|fresh-eyes|haiku) echo 300 ;;
    *) echo 600 ;;
  esac
}

max_rate_limit_backoff() {
  case "$1" in
    gemini) echo 14400 ;;
    codex) echo 21600 ;;
    opus) echo 21600 ;;
    *) echo 21600 ;;
  esac
}

record_usage_success() {
  local judge="$1"
  local usage_file now ts tmp
  usage_file="$(usage_state_path "$judge")"
  ensure_usage_state "$judge"
  now="$(date +%s)"
  ts="$(iso_now)"
  tmp="$(mktemp)"

  python3 - "$usage_file" "$now" "$ts" > "$tmp" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
now = int(sys.argv[2])
ts = sys.argv[3]
state = json.loads(path.read_text(encoding='utf-8'))
runs = [int(x) for x in state.get('runs', []) if isinstance(x, (int, float)) or str(x).isdigit()]
runs = [x for x in runs if x >= now - 604800]
runs.append(now)
state['runs'] = runs
state['last_run'] = ts
state['backoff_seconds'] = 0
print(json.dumps(state, ensure_ascii=False))
PY

  mv "$tmp" "$usage_file"
}

record_usage_rate_limited() {
  local judge="$1"
  local usage_file now ts current default_backoff max_backoff tmp
  usage_file="$(usage_state_path "$judge")"
  ensure_usage_state "$judge"
  now="$(date +%s)"
  ts="$(iso_now)"
  default_backoff="$(default_rate_limit_backoff "$judge")"
  max_backoff="$(max_rate_limit_backoff "$judge")"
  tmp="$(mktemp)"

  python3 - "$usage_file" "$now" "$ts" "$default_backoff" "$max_backoff" > "$tmp" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
now = int(sys.argv[2])
ts = sys.argv[3]
default_backoff = int(sys.argv[4])
max_backoff = int(sys.argv[5])
state = json.loads(path.read_text(encoding='utf-8'))
current = int(state.get('backoff_seconds') or 0)
if current <= 0:
    current = default_backoff
else:
    current = min(current * 2, max_backoff)
state['last_429'] = ts
state['backoff_seconds'] = current
print(json.dumps(state, ensure_ascii=False))
PY

  mv "$tmp" "$usage_file"
}

rate_limit_backoff_remaining() {
  local judge="$1"
  local usage_file
  usage_file="$(usage_state_path "$judge")"
  ensure_usage_state "$judge"

  python3 - "$usage_file" <<'PY'
import json
import sys
from datetime import datetime
from pathlib import Path

path = Path(sys.argv[1])
state = json.loads(path.read_text(encoding='utf-8'))
last_429 = state.get('last_429')
backoff = int(state.get('backoff_seconds') or 0)
if not last_429 or backoff <= 0:
    print(0)
    sys.exit(0)

try:
    started = int(datetime.fromisoformat(last_429).timestamp())
except Exception:
    print(0)
    sys.exit(0)

remaining = started + backoff - int(datetime.now().timestamp())
print(max(0, remaining))
PY
}

usage_count_since() {
  local judge="$1"
  local window_seconds="$2"
  local usage_file
  usage_file="$(usage_state_path "$judge")"
  ensure_usage_state "$judge"

  python3 - "$usage_file" "$window_seconds" <<'PY'
import json
import sys
from datetime import datetime
from pathlib import Path

path = Path(sys.argv[1])
window = int(sys.argv[2])
state = json.loads(path.read_text(encoding='utf-8'))
now = int(datetime.now().timestamp())
runs = [int(x) for x in state.get('runs', []) if isinstance(x, (int, float)) or str(x).isdigit()]
print(sum(1 for x in runs if x >= now - window))
PY
}

seconds_until_slot_available() {
  local judge="$1"
  local window_seconds="$2"
  local max_runs="$3"
  local usage_file
  usage_file="$(usage_state_path "$judge")"
  ensure_usage_state "$judge"

  python3 - "$usage_file" "$window_seconds" "$max_runs" <<'PY'
import json
import sys
from datetime import datetime
from pathlib import Path

path = Path(sys.argv[1])
window = int(sys.argv[2])
max_runs = int(sys.argv[3])
state = json.loads(path.read_text(encoding='utf-8'))
now = int(datetime.now().timestamp())
runs = sorted(int(x) for x in state.get('runs', []) if isinstance(x, (int, float)) or str(x).isdigit())
in_window = [x for x in runs if x >= now - window]
if len(in_window) < max_runs:
    print(0)
    sys.exit(0)
oldest = in_window[0]
wait = oldest + window - now + 5
print(max(0, wait))
PY
}

last_run_ago() {
  local judge="$1"
  local usage_file
  usage_file="$(usage_state_path "$judge")"
  ensure_usage_state "$judge"

  python3 - "$usage_file" <<'PY'
import json
import sys
from datetime import datetime
from pathlib import Path

path = Path(sys.argv[1])
state = json.loads(path.read_text(encoding='utf-8'))
last_run = state.get('last_run')
if not last_run:
    print(999999)
    sys.exit(0)

try:
    last_ts = int(datetime.fromisoformat(last_run).timestamp())
except Exception:
    print(999999)
    sys.exit(0)

print(max(0, int(datetime.now().timestamp()) - last_ts))
PY
}

fair_sleep_seconds() {
  local count="$1"
  local max_runs="$2"
  local window_seconds="$3"
  local min_sleep="$4"
  awk -v count="$count" -v max_runs="$max_runs" -v window="$window_seconds" -v min_sleep="$min_sleep" 'BEGIN {
    remaining = max_runs - count
    if (remaining <= 0) {
      print min_sleep
      exit
    }
    fair = int(window / remaining)
    if (fair < min_sleep) fair = min_sleep
    print fair
  }'
}

extract_internal_post_refs() {
  local post_path="$1"
  python3 - "$post_path" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding='utf-8')
patterns = [
    r'https://gu-log\.vercel\.app/(?:en/)?posts/([^\)\]\"\'#?\s]+)',
    r'/posts/([^\)\]\"\'#?\s]+)',
    r'/en/posts/([^\)\]\"\'#?\s]+)',
]
seen = set()
for pattern in patterns:
    for match in re.findall(pattern, text):
        slug = match.split('#', 1)[0].split('?', 1)[0].strip('/')
        if not slug:
            continue
        if slug in seen:
            continue
        seen.add(slug)
        print(slug)
PY
}

build_internal_ref_context() {
  local post_path="$1"
  local refs=()
  local slug resolved

  while IFS= read -r slug; do
    [ -n "$slug" ] || continue
    refs+=("$slug")
  done < <(extract_internal_post_refs "$post_path")

  if [ "${#refs[@]}" -eq 0 ]; then
    echo "- none detected"
    return 0
  fi

  for slug in "${refs[@]}"; do
    resolved="$SCORE_ROOT/src/content/posts/${slug}.mdx"
    if [ -f "$resolved" ]; then
      echo "- ${slug}: EXISTS"
    else
      echo "- ${slug}: MISSING"
    fi
  done
}
