#!/usr/bin/env bash
set -euo pipefail

JUDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_ROOT="$(cd "$JUDGE_DIR/../.." && pwd)"

# shellcheck source=scripts/score-helpers.sh
source "$SCORE_ROOT/scripts/score-helpers.sh"

judge_name() {
  echo "gemini"
}

judge_required_tools() {
  echo "gemini jq python3 grep sed"
}

judge_build_queue() {
  local post_file ticket_id
  ensure_manifest_file gemini

  while IFS= read -r post_file; do
    [ -n "$post_file" ] || continue
    ticket_id="$(get_ticket_id "$SCORE_ROOT/src/content/posts/$post_file")"
    [ -n "$ticket_id" ] || continue
    if [ -z "$(get_score gemini "$ticket_id")" ]; then
      echo "$post_file"
    fi
  done < <(list_all_posts)
}

judge_check_quota() {
  local backoff_remaining hourly_count hourly_wait last_run_gap

  backoff_remaining="$(rate_limit_backoff_remaining gemini)"
  if [ "$backoff_remaining" -gt 0 ]; then
    echo "sleep:${backoff_remaining}"
    return 0
  fi

  hourly_count="$(usage_count_since gemini 3600)"
  if [ "$hourly_count" -ge "${GEMINI_MAX_RUNS_PER_HOUR:-50}" ]; then
    hourly_wait="$(seconds_until_slot_available gemini 3600 "${GEMINI_MAX_RUNS_PER_HOUR:-50}")"
    if [ "$hourly_wait" -le 0 ]; then
      hourly_wait=30
    fi
    echo "sleep:${hourly_wait}"
    return 0
  fi

  last_run_gap="$(last_run_ago gemini)"
  if [ "$last_run_gap" -lt "${GEMINI_MIN_GAP_SECONDS:-5}" ]; then
    echo "sleep:$(( ${GEMINI_MIN_GAP_SECONDS:-5} - last_run_gap ))"
    return 0
  fi

  echo "ok"
}

judge_score_post() {
  local post_path="$1"
  local prompt_file input_file raw_file normalized_file reasoning score
  prompt_file="$SCORE_ROOT/scripts/prompts/crossref-verifier.md"
  input_file="$(mktemp)"
  raw_file="$(mktemp)"
  normalized_file="$(mktemp)"

  {
    echo "# Repository context"
    echo "File: $(basename "$post_path")"
    echo "Ticket: $(get_ticket_id "$post_path")"
    echo
    echo "# Internal gu-log references detected in this post"
    build_internal_ref_context "$post_path"
    echo
    echo "# Post content"
    cat "$post_path"
  } > "$input_file"

  if ! GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 \
    gemini --model gemini-3.1-pro-preview --yolo --prompt "$(cat "$prompt_file")" \
    < "$input_file" > "$raw_file" 2>&1; then
    cat "$raw_file"
    rm -f "$input_file" "$raw_file" "$normalized_file"
    return 1
  fi

  cp "$raw_file" "$normalized_file"
  normalize_json_file "$normalized_file" || {
    cat "$raw_file"
    rm -f "$input_file" "$raw_file" "$normalized_file"
    return 1
  }

  # Prompt may output {score, reasoning} or {score, note, verdict} — handle both
  score="$(jq -r '.score // empty' "$normalized_file")"
  reasoning="$(jq -r '.reasoning // .note // .details.reasoning // empty' "$normalized_file")"
  [ -n "$reasoning" ] || reasoning="Gemini returned score without reasoning"

  jq -cn \
    --argjson score "$score" \
    --arg reasoning "$reasoning" \
    --arg model "gemini-3.1-pro-preview" \
    --argjson iteration 1 \
    '{score: $score, details: {reasoning: $reasoning}, model: $model, iteration: $iteration}'

  rm -f "$input_file" "$raw_file" "$normalized_file"
}

judge_sleep_duration() {
  echo "${GEMINI_SLEEP_SECONDS:-5}"
}
