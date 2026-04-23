#!/bin/bash
# tribunal-batch-runner.sh — Run tribunal on all unscored articles (newest → oldest)
#
# Designed for VM cron. Processes one article at a time, checks quota between runs.
# Stops when quota drops below QUOTA_FLOOR_PCT (default 3%).
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
# Check remaining quota via claude CLI. Returns 0 if above floor, 1 if below.
check_quota_above_floor() {
  # Try to get quota info from claude CLI
  local usage_pct
  usage_pct=$(claude --usage 2>/dev/null | grep -oP '\d+(?=%)' | head -1 || echo "")

  if [ -z "$usage_pct" ]; then
    # Can't determine quota — check if we can make a simple call
    # If claude -p works, we have quota. If it rate-limits, we don't.
    tlog "  Cannot determine quota percentage. Continuing optimistically."
    return 0
  fi

  local remaining=$((100 - usage_pct))
  tlog "  Quota: ${usage_pct}% used, ${remaining}% remaining (floor: ${QUOTA_FLOOR_PCT}%)"

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

  # List zh-tw articles (not en-, not deprecated), sorted newest first by filename date
  local all_zh_articles
  all_zh_articles=$(ls -1 "$POSTS_DIR"/*.mdx 2>/dev/null \
    | xargs -I{} basename {} \
    | grep -v '^en-' \
    | grep -v '^demo' \
    | sort -r)

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

  if [ "$rc" -eq 0 ]; then
    PASSED=$((PASSED + 1))
    tlog "  ✓ $article — ALL STAGES PASSED"
  else
    FAILED=$((FAILED + 1))
    tlog "  ✗ $article — FAILED (exit code $rc)"
  fi

  # Brief cooldown between articles (avoid hammering API)
  sleep 10
done

tlog ""
tlog "=== Tribunal Batch Runner finished ==="
tlog "  Processed: $PROCESSED / $TOTAL"
tlog "  Passed: $PASSED"
tlog "  Failed: $FAILED"
tlog "  Remaining: $((TOTAL - PROCESSED))"

# Cleanup old batch logs (keep last 20)
ls -t "$LOG_DIR"/tribunal-batch-*.log 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null
