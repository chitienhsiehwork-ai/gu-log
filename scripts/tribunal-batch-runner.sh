#!/bin/bash
# tribunal-batch-runner.sh — Bounded one-shot tribunal runner
#
# Processes unscored articles (newest → oldest), one at a time, until it
# either runs out, hits --max, or drops below the quota floor. Exits
# normally when done.
#
# NOT a daemon. For the continuous 24/7 runtime, use
# tribunal-quota-loop.sh (the SSOT per tribunal-run-control spec).
# This script is for cron, manual bounded runs, and recovery work.
#
# Usage:
#   bash scripts/tribunal-batch-runner.sh              # run until quota floor
#   bash scripts/tribunal-batch-runner.sh --max 5      # run at most 5 articles
#   bash scripts/tribunal-batch-runner.sh --dry-run    # list articles to process, don't run

set -euo pipefail
export TZ=Asia/Taipei

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

POSTS_DIR="$ROOT_DIR/src/content/posts"
PROGRESS_FILE="$ROOT_DIR/scores/tribunal-progress.json"
LOG_DIR="$ROOT_DIR/.score-loop/logs"
LOG_FILE="$LOG_DIR/tribunal-batch-$(date +%Y%m%d-%H%M%S).log"
QUOTA_FLOOR_PCT="${QUOTA_FLOOR_PCT:-3}"
MAX_ARTICLES="${MAX_ARTICLES:-999}"
DRY_RUN=false

mkdir -p "$LOG_DIR"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --max) MAX_ARTICLES="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --floor) QUOTA_FLOOR_PCT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

tlog() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S %z')] [batch] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Quota Check ──────────────────────────────────────────────────────────────
# Check remaining quota via usage-monitor.sh --json. Returns 0 if above floor, 1 if below.
USAGE_MONITOR="$HOME/clawd/scripts/usage-monitor.sh"

check_quota_above_floor() {
  if [ ! -x "$USAGE_MONITOR" ]; then
    tlog "  usage-monitor.sh not found. Continuing optimistically."
    return 0
  fi

  local json remaining
  json=$(bash "$USAGE_MONITOR" --json 2>/dev/null) || {
    tlog "  Cannot read quota (usage-monitor error). Continuing optimistically."
    return 0
  }

  remaining=$(python3 -c "
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
" "$json" 2>/dev/null) || remaining=-1

  if [ "$remaining" = "-1" ]; then
    tlog "  Cannot determine quota percentage. Continuing optimistically."
    return 0
  fi

  local used=$((100 - remaining))
  tlog "  Quota: ~${used}% used, ${remaining}% remaining (floor: ${QUOTA_FLOOR_PCT}%)"

  if [ "$remaining" -le "$QUOTA_FLOOR_PCT" ]; then
    tlog "  STOP: Quota at or below ${QUOTA_FLOOR_PCT}% floor."
    return 1
  fi
  return 0
}

# ─── Build Unscored Article List (newest → oldest) ───────────────────────────
# Articles that haven't passed all 4 tribunal stages.
get_unscored_articles() {
  # Ensure progress file exists
  if [ ! -f "$PROGRESS_FILE" ] || ! jq empty "$PROGRESS_FILE" 2>/dev/null; then
    echo '{}' > "$PROGRESS_FILE"
  fi

  # List zh-tw articles (not en-, not deprecated), sorted newest-first by
  # frontmatter translatedDate. Keep in sync with
  # tribunal-quota-loop.sh:get_unscored_articles — this replaces the old
  # filename `sort -V` which grouped by series prefix.
  local all_zh_articles
  all_zh_articles=$(
    for f in "$POSTS_DIR"/*.mdx; do
      base=$(basename "$f")
      case "$base" in en-*|demo*) continue ;; esac
      td=$(awk '/^---$/{c++; if(c==2) exit; next} c==1 && /^translatedDate:/ {gsub(/[" ]/,"",$2); print $2; exit}' "$f")
      [ -z "$td" ] && continue
      printf '%s|%s\n' "$td" "$base"
    done | sort -r | cut -d'|' -f2-
  )

  for article in $all_zh_articles; do
    # Skip deprecated
    local full_path="$POSTS_DIR/$article"
    if grep -q '^status: "deprecated"' "$full_path" 2>/dev/null; then
      continue
    fi

    # Check if already PASS in progress
    local status
    status=$(jq -r --arg a "$article" '.[$a].status // "pending"' "$PROGRESS_FILE" 2>/dev/null || echo "pending")
    if [ "$status" = "PASS" ]; then
      continue
    fi

    echo "$article"
  done
}

# ─── Main ─────────────────────────────────────────────────────────────────────
tlog "=== Tribunal Batch Runner started ==="
tlog "  Floor: ${QUOTA_FLOOR_PCT}%, Max: ${MAX_ARTICLES}, Dry-run: ${DRY_RUN}"

# Pull latest
tlog "Pulling latest from origin..."
git pull --rebase origin main >> "$LOG_FILE" 2>&1 || tlog "WARN: git pull failed"

# Get unscored articles
mapfile -t ARTICLES < <(get_unscored_articles)
TOTAL=${#ARTICLES[@]}
tlog "Found $TOTAL unscored articles to process."

if [ "$TOTAL" -eq 0 ]; then
  tlog "Nothing to do. All articles scored or no articles found."
  exit 0
fi

if [ "$DRY_RUN" = true ]; then
  tlog "Dry-run mode. Articles that would be processed:"
  for i in "${!ARTICLES[@]}"; do
    tlog "  $((i+1)). ${ARTICLES[$i]}"
  done
  exit 0
fi

PROCESSED=0
PASSED=0
FAILED=0
SKIPPED=0

# Exit-code convention (tribunal-all-claude.sh):
#   0=passed  1=failed  2=EXHAUSTED  75=skipped(already_running)
#   77=stopped_by_request
for article in "${ARTICLES[@]}"; do
  if [ "$PROCESSED" -ge "$MAX_ARTICLES" ]; then
    tlog "Reached max articles ($MAX_ARTICLES). Stopping."
    break
  fi

  # Check quota before each article
  if ! check_quota_above_floor; then
    tlog "Quota floor reached. Stopping."
    break
  fi

  PROCESSED=$((PROCESSED + 1))
  tlog ""
  tlog "━━━ [$PROCESSED/$TOTAL] Processing: $article ━━━"

  # Run tribunal
  rc=0
  bash "$SCRIPT_DIR/tribunal-all-claude.sh" "$article" >> "$LOG_FILE" 2>&1 || rc=$?

  case "$rc" in
    0)
      PASSED=$((PASSED + 1))
      tlog "  ✓ $article — ALL STAGES PASSED"
      ;;
    75)
      SKIPPED=$((SKIPPED + 1))
      tlog "  ○ $article — skipped (already running elsewhere)"
      ;;
    77)
      tlog "  ⏸ $article — stopped_by_request propagated; batch runner exiting."
      break
      ;;
    *)
      FAILED=$((FAILED + 1))
      tlog "  ✗ $article — FAILED (exit code $rc)"
      ;;
  esac

  # Brief cooldown between articles (avoid hammering API)
  sleep 10
done

tlog ""
tlog "=== Tribunal Batch Runner finished (bounded completion) ==="
tlog "  Processed: $PROCESSED / $TOTAL"
tlog "  Passed:  $PASSED"
tlog "  Skipped: $SKIPPED"
tlog "  Failed:  $FAILED"
tlog "  Remaining: $((TOTAL - PROCESSED))"

# Cleanup old batch logs (keep last 20)
ls -t "$LOG_DIR"/tribunal-batch-*.log 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null
