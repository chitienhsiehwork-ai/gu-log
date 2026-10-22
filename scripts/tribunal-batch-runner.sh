#!/bin/bash
# tribunal-batch-runner.sh — Bounded one-shot tribunal runner
#
# Processes unscored articles (newest → oldest), one at a time, until it
# either runs out, hits --max, or drops below the quota floor. Exits
# normally when done. Quota source and floor are the daemon's: the CodexBar
# Codex probe and QUOTA_FLOOR (see the Quota Check section).
#
# NOT a daemon. For the continuous 24/7 runtime, use
# tribunal-quota-loop.sh (the SSOT per tribunal-run-control spec).
# This script is for cron, manual bounded runs, and recovery work. To judge
# one article, run scripts/tribunal.sh on it directly.
#
# Usage:
#   bash scripts/tribunal-batch-runner.sh              # run until quota floor
#   bash scripts/tribunal-batch-runner.sh --max 5      # run at most 5 articles
#   bash scripts/tribunal-batch-runner.sh --floor 20   # override QUOTA_FLOOR (%)
#   bash scripts/tribunal-batch-runner.sh --dry-run    # list articles to process, don't run

set -euo pipefail
export TZ=Asia/Taipei

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

source "$SCRIPT_DIR/tribunal-helpers.sh"

if ! TRIBUNAL_VERSION="$(node "$SCRIPT_DIR/tribunal-version.mjs" current 2>/dev/null)"; then
  echo "ERROR: invalid Tribunal version: could not read scripts/tribunal-version.mjs" >&2
  exit 78
fi
case "$TRIBUNAL_VERSION" in
  ''|*[!0-9]*)
    echo "ERROR: invalid Tribunal version: ${TRIBUNAL_VERSION:-<empty>}" >&2
    exit 78
    ;;
esac
if [ "$TRIBUNAL_VERSION" -lt 1 ]; then
  echo "ERROR: invalid Tribunal version: $TRIBUNAL_VERSION" >&2
  exit 78
fi

POSTS_DIR="$ROOT_DIR/src/content/posts"
PROGRESS_FILE="$(tribunal_progress_file_default "$ROOT_DIR")"
LOG_DIR="$ROOT_DIR/.score-loop/logs"
LOG_FILE="$LOG_DIR/tribunal-batch-$(date +%Y%m%d-%H%M%S).log"
RUNTIME_GIT_STATE_FILE="$(tribunal_runtime_git_state_file "$ROOT_DIR")"
QUOTA_FLOOR="${QUOTA_FLOOR:-10}"   # same variable and default as tribunal-quota-loop.sh
MAX_ARTICLES="${MAX_ARTICLES:-999}"
DRY_RUN=false

mkdir -p "$LOG_DIR"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --max) MAX_ARTICLES="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --floor) QUOTA_FLOOR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

tlog() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S %z')] [batch] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Quota Check ──────────────────────────────────────────────────────────────
# Same quota reading as the deployed daemon (tribunal-quota-loop.sh): the
# CodexBar Codex probe and its strict parser in tribunal-helpers.sh. There is
# no Claude quota probe; like the daemon, the batch reacts instead: it stops on
# a Claude writer pause and on a QUOTA_SUSPENDED result (see the main loop).
# Returns 0 if above floor, 1 if at/below, 2 if quota cannot be verified.
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
    none) ;;
    claude)
      writer_provider="claude"
      ;;
    # Retired writer modes (see tribunal_writer_mode_problem) and unknown
    # values fail closed: gu-log article rewrites use only the Claude model.
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
  local active_providers json readings session_left weekly_left minimum

  if ! [[ "$QUOTA_FLOOR" =~ ^[0-9]+$ ]] || [ "$QUOTA_FLOOR" -gt 100 ]; then
    tlog "  ERROR: QUOTA_FLOOR must be an integer from 0 to 100 (got: ${QUOTA_FLOOR:-<empty>}); refusing to run."
    return 2
  fi

  active_providers=$(tribunal_batch_active_providers) || {
    tlog "  ERROR: cannot resolve active tribunal providers; refusing to run."
    return 2
  }
  case "|$active_providers|" in
    *"|codex|"*) ;;
    *)
      tlog "  Quota: active=${active_providers}; no Codex judge, so no quota probe (Claude pauses and suspensions still stop the batch)."
      return 0
      ;;
  esac

  if ! json="$(tribunal_quota_codexbar_json 2>/dev/null)" || [ -z "$json" ] ||
     ! readings="$(tribunal_quota_parse_json "$json" 2>/dev/null)"; then
    tlog "  ERROR: CodexBar Codex quota JSON unavailable, timed out, or invalid; refusing to run without a quota reading."
    return 2
  fi
  IFS='|' read -r session_left _ weekly_left _ <<< "$readings"
  # -1 marks an inactive 5-hour window, which the daemon's controller ignores too.
  minimum="$weekly_left"
  if [ "$session_left" -ge 0 ] && [ "$session_left" -lt "$minimum" ]; then
    minimum="$session_left"
  fi
  tlog "  Quota: active=${active_providers}; codex 5h=${session_left}% weekly=${weekly_left}%; minimum=${minimum}% (floor: ${QUOTA_FLOOR}%)"

  if [ "$minimum" -le "$QUOTA_FLOOR" ]; then
    tlog "  STOP: Codex quota is at or below the ${QUOTA_FLOOR}% floor."
    return 1
  fi
  return 0
}

# A worker result after which the bounded batch stops instead of moving to the
# next article (openspec tribunal-24-7-operations): a quota suspension, which
# includes a Claude quota or temporary-error pause, and anything only a person
# can fix (rc 78: Claude login, account, model pin or configuration). Prints
# why and returns the batch exit code; returns 0 when the batch may go on.
tribunal_batch_stop_reason() {
  local rc="$1" article="$2" status reason
  case "$rc" in
    75)
      status="$(jq -r --arg a "$article" '.[$a].status // ""' "$PROGRESS_FILE" 2>/dev/null || true)"
      # Anything else with rc 75 is a per-article lock held elsewhere.
      [ "$status" = QUOTA_SUSPENDED ] || return 0
      reason="$(jq -r --arg a "$article" \
        '.[$a] as $r | ($r.stages[$r.failedStage // ""].error // "")' \
        "$PROGRESS_FILE" 2>/dev/null || true)"
      printf 'quota suspended (%s)\n' "${reason:-no reason recorded}"
      return 75
      ;;
    78)
      printf 'needs operator action (rc=78; see the batch log: run `claude auth login`, or fix the Claude plan, admin settings, model pin or configuration)\n'
      return 78
      ;;
  esac
  return 0
}

# Print why an active Claude writer pause holds the batch; fail when none does.
tribunal_batch_claude_pause() {
  local left reason
  left="$(tribunal_claude_pause_remaining)" || return 1
  reason="$(jq -r '.reason // ""' "$(tribunal_claude_pause_file)" 2>/dev/null || true)"
  printf 'Claude writer pause active for %ss (%s)\n' "$left" "${reason:-no reason recorded}"
}

# ─── Build Unscored Article List (newest → oldest) ───────────────────────────
# A post and its English sidecar (if any) carry a complete current-version
# scorecard: scores.tribunalVersion at or above the current version and all
# four judge blocks, the shape tribunal-assert-pass-artifacts.sh requires
# before a Tribunal PASS commit.
tribunal_batch_has_current_scorecard() {
  local file
  for file in "$POSTS_DIR/$1" "$POSTS_DIR/en-$1"; do
    [ "$file" = "$POSTS_DIR/$1" ] || [ -f "$file" ] || continue
    awk -v want="$TRIBUNAL_VERSION" '
      /^---$/ { c++; if (c == 2) exit; next }
      c != 1 { next }
      /^scores:/ { in_scores = 1; next }
      /^[^ ]/ { in_scores = 0 }
      in_scores && /^  tribunalVersion:/ { v = $2; gsub(/"/, "", v) }
      in_scores && /^  (librarian|factCheck|freshEyes|vibe):[[:space:]]*$/ { sub(/^  /, ""); sub(/:.*/, ""); seen[$0] = 1 }
      END { exit !(v ~ /^[0-9]+$/ && v + 0 >= want + 0 && seen["librarian"] && seen["factCheck"] && seen["freshEyes"] && seen["vibe"]) }
    ' "$file" 2>/dev/null || return 1
  done
}

# Articles that haven't passed all 4 tribunal stages.
get_unscored_articles() {
  # Ensure progress file exists
  ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"

  # List zh-tw articles (not en-, not deprecated/taken-down), sorted newest-first by
  # frontmatter translatedDate. The ledger rules below match
  # tribunal-quota-loop.sh:get_unscored_articles; keep them in sync. The
  # frontmatter fallback is batch-only: the daemon's ledger persists on the VM,
  # while this runner also starts from fresh checkouts with an empty ledger.
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
    local full_path="$POSTS_DIR/$article"
    # Skip deprecated and taken-down posts: Tribunal scope is decided by
    # frontmatter status alone (tribunal_post_outside_scope).
    if tribunal_post_outside_scope "$full_path"; then
      continue
    fi

    # Skip terminal statuses only for the current Tribunal version. Older
    # terminal entries must be reprocessed across the version boundary.
    # With no current-version ledger entry, a complete current-version
    # scorecard in the post means a full run already happened elsewhere.
    local status
    status=$(jq -r --arg a "$article" --argjson v "$TRIBUNAL_VERSION" \
      'if ((.[$a].tribunalVersion // 0) >= $v) then (.[$a].status // "pending") else "no-ledger" end' \
      "$PROGRESS_FILE" 2>/dev/null || echo "pending")
    if [ "$status" = "PASS" ] || [ "$status" = "EXHAUSTED" ]; then
      continue
    fi
    if [ "$status" = "no-ledger" ] && tribunal_batch_has_current_scorecard "$article"; then
      continue
    fi
    if [ "$status" = "FAILED" ] &&
       tribunal_failed_input_unchanged "$PROGRESS_FILE" "$POSTS_DIR" "$article"; then
      continue
    fi

    echo "$article"
  done
}

# ─── Main ─────────────────────────────────────────────────────────────────────
tlog "=== Tribunal Batch Runner started ==="
tlog "  Floor: ${QUOTA_FLOOR}%, Max: ${MAX_ARTICLES}, Dry-run: ${DRY_RUN}"

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
STOP_RC=0

# Exit-code convention (tribunal.sh):
#   0=passed  1=failed  2=EXHAUSTED  75=skipped(already_running) or
#   QUOTA_SUSPENDED  77=stopped_by_request  78=needs operator action
for article in "${ARTICLES[@]}"; do
  if [ "$PROCESSED" -ge "$MAX_ARTICLES" ]; then
    tlog "Reached max articles ($MAX_ARTICLES). Stopping."
    break
  fi

  if pause_note="$(tribunal_batch_claude_pause)"; then
    tlog "$pause_note; stopping the batch."
    STOP_RC=75
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

  stop_rc=0
  stop_note="$(tribunal_batch_stop_reason "$rc" "$article")" || stop_rc=$?
  if [ "$stop_rc" -ne 0 ]; then
    tlog "  ■ $article — $stop_note; stopping the batch."
    STOP_RC="$stop_rc"
    break
  fi

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
exit "$STOP_RC"
