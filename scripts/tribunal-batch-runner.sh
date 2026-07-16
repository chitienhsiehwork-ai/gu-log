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

source "$SCRIPT_DIR/tribunal-helpers.sh"

POSTS_DIR="$ROOT_DIR/src/content/posts"
PROGRESS_FILE="$(tribunal_progress_file_default "$ROOT_DIR")"
TRIBUNAL_VERSION=8
LOG_DIR="$ROOT_DIR/.score-loop/logs"
LOG_FILE="$LOG_DIR/tribunal-batch-$(date +%Y%m%d-%H%M%S).log"
RUNTIME_GIT_STATE_FILE="$(tribunal_runtime_git_state_file "$ROOT_DIR")"
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
# Check remaining quota via usage-monitor.sh --json. The off-repo executable is
# injected explicitly or discovered on PATH; its host path is not a repo fact.
# Returns 0 if above floor, 1 if below, 2 if quota cannot be verified.
USAGE_MONITOR="${USAGE_MONITOR:-$(command -v usage-monitor.sh || true)}"

tribunal_batch_active_providers() {
  local global_provider vibe_provider fallback_provider writer_mode writer_provider provider providers=""

  global_provider=$(tribunal_llm_provider 2>/dev/null) || return 1
  vibe_provider=$(tribunal_judge_provider vibe-opus-scorer 2>/dev/null) || return 1

  fallback_provider=""
  if [ "${GP_JUDGE_ALLOW_CLAUDE:-0}" = "1" ] && tribunal_claude_cmd >/dev/null 2>&1; then
    fallback_provider="claude"
  fi

  writer_mode=$(tribunal_writer_mode 2>/dev/null) || return 1
  writer_provider=""
  case "$writer_mode" in
    none|subagent) ;;
    cli)
      writer_provider=$(tribunal_writer_provider 2>/dev/null) || return 1
      ;;
    codex)
      writer_provider="codex"
      ;;
    *) return 1 ;;
  esac

  for provider in "$global_provider" "$vibe_provider" "$fallback_provider" "$writer_provider"; do
    [ -n "$provider" ] || continue
    case "$provider" in
      codex|claude) ;;
      *) return 1 ;;
    esac
    case "|$providers|" in
      *"|$provider|"*) ;;
      *) providers="${providers}${providers:+|}$provider" ;;
    esac
  done

  [ -n "$providers" ] || return 1
  printf '%s\n' "$providers"
}

check_quota_above_floor() {
  if [ ! -x "$USAGE_MONITOR" ]; then
    tlog "  ERROR: usage-monitor.sh not found; refusing to run without a quota reading."
    return 2
  fi

  local json active_providers quota_result quota_state remaining details
  json=$(bash "$USAGE_MONITOR" --json 2>/dev/null) || {
    tlog "  ERROR: usage-monitor failed; refusing to run without a quota reading."
    return 2
  }

  active_providers=$(tribunal_batch_active_providers) || {
    tlog "  ERROR: cannot resolve active tribunal providers; refusing to run."
    return 2
  }

  if ! quota_result=$(
    python3 - "$json" "$active_providers" "$QUOTA_FLOOR_PCT" 2>&1 <<'PY'
import json
import math
import sys


def percentage(entry, key, provider):
    value = entry.get(key)
    if isinstance(value, bool):
        raise ValueError(f"{provider} {key} is not numeric")
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{provider} {key} is missing or invalid")
    if not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError(f"{provider} {key} is outside 0..100")
    return value


def fmt(value):
    return f"{value:g}"


try:
    data = json.loads(sys.argv[1])
    active = [provider for provider in sys.argv[2].split("|") if provider]
    floor = float(sys.argv[3])
    if not isinstance(data, list) or not active:
        raise ValueError("usage-monitor payload or active provider set is empty")
    if not math.isfinite(floor) or not 0 <= floor <= 100:
        raise ValueError("quota floor is outside 0..100")

    entries = {}
    for entry in data:
        if not isinstance(entry, dict):
            continue
        provider = str(entry.get("provider", "")).lower()
        entries.setdefault(provider, []).append(entry)
    effective_values = []
    details = []

    for runtime_provider in active:
        usage_provider = "openai" if runtime_provider == "codex" else runtime_provider
        candidates = list(entries.get(usage_provider, []))
        if runtime_provider == "codex":
            candidates.extend(entries.get("codex", []))
        if not candidates:
            raise ValueError(f"missing active provider: {runtime_provider}")
        if len(candidates) != 1:
            raise ValueError(f"duplicate active provider telemetry: {runtime_provider}")
        entry = candidates[0]
        if entry.get("status") != "ok":
            raise ValueError(f"active provider is not healthy: {runtime_provider}")

        short_key = "session_remaining_pct" if runtime_provider == "codex" else "five_hr_remaining_pct"
        short = percentage(entry, short_key, runtime_provider)
        weekly = percentage(entry, "weekly_remaining_pct", runtime_provider)
        effective_values.append(min(short, weekly))
        details.append(f"{runtime_provider}:short={fmt(short)},weekly={fmt(weekly)}")

    minimum = min(effective_values)
    state = "low" if minimum <= floor else "ok"
    print(f"{state}|{fmt(minimum)}|{';'.join(details)}")
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)
PY
  ); then
    tlog "  ERROR: invalid quota telemetry for active providers ($active_providers): $quota_result"
    return 2
  fi

  IFS='|' read -r quota_state remaining details <<< "$quota_result"
  tlog "  Quota: active=${active_providers}; ${details}; minimum=${remaining}% (floor: ${QUOTA_FLOOR_PCT}%)"

  if [ "$quota_state" = "low" ]; then
    tlog "  STOP: At least one active provider is at or below the ${QUOTA_FLOOR_PCT}% floor."
    return 1
  fi
  [ "$quota_state" = "ok" ] || return 2
  return 0
}

# ─── Build Unscored Article List (newest → oldest) ───────────────────────────
# Articles that haven't passed all 4 tribunal stages.
get_unscored_articles() {
  # Ensure progress file exists
  ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"

  # List zh-tw articles (not en-, not deprecated), sorted newest-first by
  # frontmatter translatedDate. Keep in sync with
  # tribunal-quota-loop.sh:get_unscored_articles — this replaces the old
  # filename `sort -V` which grouped by series prefix.
  local all_zh_articles
  all_zh_articles=$(
    for f in "$POSTS_DIR"/*.mdx; do
      base=$(basename "$f")
      if [[ "$base" == en-* || "$base" == demo* ]]; then
        continue
      fi
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

    # Check if already PASS in current tribunal version. Older PASS entries
    # should be reprocessed by the v8 judge-boundary gate.
    local status
    status=$(jq -r --arg a "$article" --argjson v "$TRIBUNAL_VERSION" \
      'if ((.[$a].tribunalVersion // 0) >= $v) then (.[$a].status // "pending") else "pending" end' \
      "$PROGRESS_FILE" 2>/dev/null || echo "pending")
    if [ "$status" = "PASS" ]; then
      continue
    fi

    echo "$article"
  done
}

# ─── Main ─────────────────────────────────────────────────────────────────────
tlog "=== Tribunal Batch Runner started ==="
tlog "  Floor: ${QUOTA_FLOOR_PCT}%, Max: ${MAX_ARTICLES}, Dry-run: ${DRY_RUN}"

# Fetch-only drift check
tlog "Fetching origin/main for drift status..."
if ! tribunal_fetch_and_report_origin_main "$ROOT_DIR" "$LOG_FILE" "$RUNTIME_GIT_STATE_FILE" >/dev/null; then
  tlog "WARN: origin/main fetch failed; continuing with current snapshot."
fi
git_state="$(jq -r '.state // "unknown"' "$RUNTIME_GIT_STATE_FILE" 2>/dev/null || printf 'unknown')"
git_ahead="$(jq -r '.ahead // 0' "$RUNTIME_GIT_STATE_FILE" 2>/dev/null || printf '0')"
git_behind="$(jq -r '.behind // 0' "$RUNTIME_GIT_STATE_FILE" 2>/dev/null || printf '0')"
git_dirty="$(jq -r '.trackedDirty // 0' "$RUNTIME_GIT_STATE_FILE" 2>/dev/null || printf '0')"
tlog "Git drift: state=$git_state ahead=$git_ahead behind=$git_behind tracked_dirty=$git_dirty"

# Get unscored articles. Use an indexed-array loop instead of mapfile so the
# bounded runner remains executable with macOS's Bash 3.2.
ARTICLES=()
while IFS= read -r article; do
  ARTICLES[${#ARTICLES[@]}]="$article"
done < <(get_unscored_articles)
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

# Exit-code convention (tribunal.sh):
#   0=passed  1=failed  2=EXHAUSTED  75=skipped(already_running)
#   77=stopped_by_request
for article in "${ARTICLES[@]}"; do
  if [ "$PROCESSED" -ge "$MAX_ARTICLES" ]; then
    tlog "Reached max articles ($MAX_ARTICLES). Stopping."
    break
  fi

  # Check quota before each article. Missing/invalid telemetry is an error,
  # not permission to burn unbounded quota.
  quota_rc=0
  check_quota_above_floor || quota_rc=$?
  case "$quota_rc" in
    0) ;;
    1)
      tlog "Quota floor reached. Stopping."
      break
      ;;
    *)
      tlog "Quota cannot be verified. Aborting batch (fail closed)."
      exit 1
      ;;
  esac

  PROCESSED=$((PROCESSED + 1))
  tlog ""
  tlog "━━━ [$PROCESSED/$TOTAL] Processing: $article ━━━"

  # Run tribunal
  rc=0
  bash "$SCRIPT_DIR/tribunal.sh" "$article" >> "$LOG_FILE" 2>&1 || rc=$?

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
