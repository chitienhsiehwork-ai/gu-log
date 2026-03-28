#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

JUDGE="${1:-}"
LIMIT="${2:-0}"
DRY_RUN="${DRY_RUN:-0}"

if [ -z "$JUDGE" ]; then
  echo "Usage: ./scripts/score-loop-engine.sh <gemini|codex|opus> [LIMIT]" >&2
  exit 1
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: LIMIT must be a non-negative integer, got: $LIMIT" >&2
  exit 1
fi

# shellcheck source=scripts/score-helpers.sh
source "$ROOT_DIR/scripts/score-helpers.sh"

JUDGE_SCRIPT="$ROOT_DIR/scripts/judges/${JUDGE}.sh"
if [ ! -f "$JUDGE_SCRIPT" ]; then
  echo "ERROR: Unknown judge '$JUDGE' (expected scripts/judges/${JUDGE}.sh)" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$JUDGE_SCRIPT"

ensure_score_dirs
ensure_manifest_file "$JUDGE"

RUN_DATE="$(log_date_stamp)"
LOG_FILE="$ROOT_DIR/.score-loop/logs/${JUDGE}-${RUN_DATE}.log"
mkdir -p "$(dirname "$LOG_FILE")"

timestamp() {
  TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z'
}

log() {
  local msg="[$(timestamp)] [$JUDGE] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

LOCK_FILE="/tmp/score-loop-${JUDGE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Another ${JUDGE} score loop is already running. Exiting."
  exit 0
fi

for cmd in jq git flock; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "ERROR: Required command missing: $cmd"
    exit 1
  fi
done

if declare -F judge_required_tools >/dev/null 2>&1; then
  for cmd in $(judge_required_tools); do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      log "ERROR: Judge '${JUDGE}' requires missing command: $cmd"
      exit 1
    fi
  done
fi

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  log "ERROR: Git repository is mid-rebase. Resolve manually first."
  exit 1
fi

mapfile -t QUEUE < <(judge_build_queue)
TOTAL_QUEUE="${#QUEUE[@]}"

if [ "$LIMIT" -gt 0 ] && [ "$LIMIT" -lt "$TOTAL_QUEUE" ]; then
  QUEUE=("${QUEUE[@]:0:$LIMIT}")
fi

log "Queue built: ${TOTAL_QUEUE} candidate posts. Limit: $LIMIT. Dry run: $DRY_RUN"

if [ "${#QUEUE[@]}" -eq 0 ]; then
  log "Nothing to do."
  exit 0
fi

if [ "$DRY_RUN" = "1" ] && [ "$LIMIT" -eq 0 ]; then
  log "DRY_RUN queue-only mode. First 10 queued posts:"
  preview_max=10
  for ((i = 0; i < ${#QUEUE[@]} && i < preview_max; i++)); do
    log "  would process ${QUEUE[$i]}"
  done
  if [ "${#QUEUE[@]}" -gt "$preview_max" ]; then
    log "  ... plus $(( ${#QUEUE[@]} - preview_max )) more"
  fi
  exit 0
fi

stage_post_changes_if_any() {
  local post_rel="$1"
  local en_rel
  en_rel="$(dirname "$post_rel")/en-$(basename "$post_rel")"

  if [ -f "$post_rel" ] || git ls-files --error-unmatch "$post_rel" >/dev/null 2>&1; then
    git add -- "$post_rel" 2>/dev/null || true
  fi

  if [ -f "$en_rel" ] || git ls-files --error-unmatch "$en_rel" >/dev/null 2>&1; then
    git add -- "$en_rel" 2>/dev/null || true
  fi
}

git_commit_and_push() {
  local post_rel="$1"
  local ticket_id="$2"
  local score_value="$3"
  local manifest
  manifest="scores/${JUDGE}-scores.json"

  git add -- "$manifest"
  stage_post_changes_if_any "$post_rel"

  if git diff --cached --quiet; then
    log "No git changes to commit for $ticket_id."
    return 0
  fi

  if ! git commit -m "score(${JUDGE}): ${ticket_id} = ${score_value}" --no-verify >> "$LOG_FILE" 2>&1; then
    log "ERROR: git commit failed for $ticket_id"
    return 1
  fi

  if git push --no-verify >> "$LOG_FILE" 2>&1; then
    return 0
  fi

  log "git push failed for $ticket_id, attempting pull --rebase recovery"
  if git pull --rebase >> "$LOG_FILE" 2>&1 && git push --no-verify >> "$LOG_FILE" 2>&1; then
    log "Recovered push after pull --rebase"
    return 0
  fi

  git rebase --abort >/dev/null 2>&1 || true
  log "ERROR: push recovery failed for $ticket_id"
  return 1
}

PROCESSED=0
for post_file in "${QUEUE[@]}"; do
  post_file="$(echo "$post_file" | tr -d '\r')"
  [ -n "$post_file" ] || continue

  post_rel="src/content/posts/$post_file"
  post_path="$ROOT_DIR/$post_rel"
  if [ ! -f "$post_path" ]; then
    log "WARN: Skipping missing post file: $post_file"
    continue
  fi

  ticket_id="$(get_ticket_id "$post_path")"
  if [ -z "$ticket_id" ]; then
    log "WARN: Skipping $post_file because ticketId is missing"
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    quota_status="$(judge_check_quota)"
    log "[dry-run] would score $ticket_id ($post_file) with quota status: $quota_status"
    PROCESSED=$((PROCESSED + 1))
    continue
  fi

  while :; do
    quota_status="$(judge_check_quota)"
    case "$quota_status" in
      ok|running)
        break
        ;;
      sleep:*)
        sleep_seconds="${quota_status#sleep:}"
        log "Quota says sleep ${sleep_seconds}s before processing $ticket_id"
        sleep "$sleep_seconds"
        ;;
      pacing:*)
        # pacing:3600(1h0m) — extract seconds before the parenthesis
        pacing_seconds="${quota_status#pacing:}"
        pacing_seconds="${pacing_seconds%%(*}"
        if [ "$pacing_seconds" -le 600 ]; then
          log "Quota pacing ${pacing_seconds}s before processing $ticket_id"
          sleep "$pacing_seconds"
        else
          log "Quota pacing too long (${pacing_seconds}s) for judge $JUDGE. Exiting cleanly."
          exit 0
        fi
        ;;
      exhausted)
        log "Quota exhausted for judge $JUDGE. Exiting cleanly; cron can resume later."
        exit 0
        ;;
      *)
        log "WARN: Unknown quota status '$quota_status' from judge $JUDGE — treating as ok"
        break
        ;;
    esac
  done

  score_tmp="$(mktemp)"
  score_stderr="$(mktemp)"
  final_tmp="$(mktemp)"

  log "Scoring $ticket_id ($post_file)"
  if ! judge_score_post "$post_path" > "$score_tmp" 2> "$score_stderr"; then
    if looks_rate_limited "$score_stderr" || looks_rate_limited "$score_tmp"; then
      record_usage_rate_limited "$JUDGE"
      log "Rate limited while scoring $ticket_id. Usage state updated; exiting for later retry."
      rm -f "$score_tmp" "$score_stderr" "$final_tmp"
      exit 0
    fi

    log "ERROR: judge_score_post failed for $ticket_id"
    if [ -s "$score_stderr" ]; then
      sed 's/^/  stderr: /' "$score_stderr" | tee -a "$LOG_FILE" >/dev/null
    fi
    rm -f "$score_tmp" "$score_stderr" "$final_tmp"
    continue
  fi

  if ! validate_judge_score_json "$JUDGE" "$score_tmp"; then
    log "ERROR: Invalid score JSON for $ticket_id"
    if [ -s "$score_tmp" ]; then
      sed 's/^/  raw: /' "$score_tmp" | tee -a "$LOG_FILE" >/dev/null
    fi
    rm -f "$score_tmp" "$score_stderr" "$final_tmp"
    continue
  fi

  score_json="$(cat "$score_tmp")"
  if declare -F judge_fix_post >/dev/null 2>&1; then
    maybe_fixed="$(judge_fix_post "$post_path" "$score_json")"
    printf '%s\n' "$maybe_fixed" > "$final_tmp"
    if ! validate_judge_score_json "$JUDGE" "$final_tmp"; then
      log "ERROR: judge_fix_post returned invalid JSON for $ticket_id"
      rm -f "$score_tmp" "$score_stderr" "$final_tmp"
      continue
    fi
    score_json="$(cat "$final_tmp")"
  fi

  manifest_entry="$(jq -cn \
    --arg file "$post_file" \
    --arg ts "$(iso_now)" \
    --argjson payload "$score_json" \
    '$payload + {file: $file, ts: $ts}')"

  write_score "$JUDGE" "$ticket_id" "$manifest_entry"
  record_usage_success "$JUDGE"

  score_value="$(jq -r '.score' <<< "$manifest_entry")"
  log "Recorded $ticket_id => score $score_value"

  if ! git_commit_and_push "$post_rel" "$ticket_id" "$score_value"; then
    rm -f "$score_tmp" "$score_stderr" "$final_tmp"
    exit 1
  fi

  sleep_seconds="$(judge_sleep_duration)"
  log "Sleeping ${sleep_seconds}s before next post"
  sleep "$sleep_seconds"

  PROCESSED=$((PROCESSED + 1))
  rm -f "$score_tmp" "$score_stderr" "$final_tmp"
done

log "Done. Processed ${PROCESSED} posts this run. Log: $LOG_FILE"
