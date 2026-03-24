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
  local backoff_remaining

  # 1. Respect rate-limit backoff from previous 429
  backoff_remaining="$(rate_limit_backoff_remaining gemini)"
  if [ "$backoff_remaining" -gt 0 ]; then
    echo "sleep:${backoff_remaining}"
    return 0
  fi

  # 2. Real quota check via usage-monitor.sh → Gemini API
  source "$SCORE_ROOT/scripts/quota-bridge.sh"
  gemini_real_quota_check
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
    echo "# Blog glossary (canonical terms — check if post links to these)"
    cat "$SCORE_ROOT/src/data/glossary.json"
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

  # Prompt may output {score, reasoning, unlinked_terms} — handle variants
  score="$(jq -r '.score // empty' "$normalized_file")"
  reasoning="$(jq -r '.reasoning // .note // .details.reasoning // empty' "$normalized_file")"
  [ -n "$reasoning" ] || reasoning="Gemini returned score without reasoning"
  unlinked_terms="$(jq -c '.unlinked_terms // []' "$normalized_file")"

  jq -cn \
    --argjson score "$score" \
    --arg reasoning "$reasoning" \
    --argjson unlinked_terms "$unlinked_terms" \
    --arg model "gemini-3.1-pro-preview" \
    --argjson iteration 1 \
    '{score: $score, details: {reasoning: $reasoning, unlinked_terms: $unlinked_terms}, model: $model, iteration: $iteration}'

  rm -f "$input_file" "$raw_file" "$normalized_file"
}

judge_sleep_duration() {
  echo "${GEMINI_SLEEP_SECONDS:-5}"
}
