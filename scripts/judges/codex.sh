#!/usr/bin/env bash
set -euo pipefail

JUDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_ROOT="$(cd "$JUDGE_DIR/../.." && pwd)"

# shellcheck source=scripts/score-helpers.sh
source "$SCORE_ROOT/scripts/score-helpers.sh"

judge_name() {
  echo "codex"
}

judge_required_tools() {
  echo "codex jq python3 sed timeout"
}

judge_build_queue() {
  local post_file ticket_id
  ensure_manifest_file codex

  while IFS= read -r post_file; do
    [ -n "$post_file" ] || continue
    ticket_id="$(get_ticket_id "$SCORE_ROOT/src/content/posts/$post_file")"
    [ -n "$ticket_id" ] || continue
    if [ -z "$(get_score codex "$ticket_id")" ]; then
      echo "$post_file"
    fi
  done < <(list_all_posts)
}

judge_check_quota() {
  local backoff_remaining count_5h count_7d wait_5h wait_7d
  local remaining_5h_pct remaining_7d_pct time_5h_pct time_7d_pct

  backoff_remaining="$(rate_limit_backoff_remaining codex)"
  if [ "$backoff_remaining" -gt 0 ]; then
    echo "sleep:${backoff_remaining}"
    return 0
  fi

  count_5h="$(usage_count_since codex 18000)"
  count_7d="$(usage_count_since codex 604800)"
  wait_5h="$(seconds_until_slot_available codex 18000 "${CODEX_MAX_RUNS_5H:-10}")"
  wait_7d="$(seconds_until_slot_available codex 604800 "${CODEX_MAX_RUNS_7D:-70}")"

  remaining_5h_pct="$(remaining_pct_from_counts "$count_5h" "${CODEX_MAX_RUNS_5H:-10}")"
  remaining_7d_pct="$(remaining_pct_from_counts "$count_7d" "${CODEX_MAX_RUNS_7D:-70}")"
  time_5h_pct="$(pct_from_seconds "$wait_5h" 18000)"
  time_7d_pct="$(pct_from_seconds "$wait_7d" 604800)"

  check_dual_quota "$remaining_5h_pct" "$time_5h_pct" "$remaining_7d_pct" "$time_7d_pct"
}

judge_score_post() {
  local post_path="$1"
  local prompt_file input_file raw_file normalized_file score reasoning
  prompt_file="$SCORE_ROOT/scripts/prompts/fact-checker.md"
  input_file="$(mktemp)"
  raw_file="$(mktemp)"
  normalized_file="$(mktemp)"

  {
    cat "$prompt_file"
    echo
    echo "## Post metadata"
    echo "- File: $(basename "$post_path")"
    echo "- Ticket: $(get_ticket_id "$post_path")"
    echo
    echo "## Post content (first 500 lines)"
    sed -n '1,500p' "$post_path"
    echo
    echo "Remember: output ONLY valid JSON, nothing else."
  } > "$input_file"

  local stderr_file
  stderr_file="$(mktemp)"
  # Codex is slow but thorough — give it 50 minutes per post
  if ! timeout 3000 codex exec --full-auto --color never - < "$input_file" > "$raw_file" 2>"$stderr_file"; then
    # Codex may exit non-zero but still produce valid output; check before bailing
    if [ ! -s "$raw_file" ]; then
      cat "$stderr_file" >&2
      cat "$raw_file"
      rm -f "$input_file" "$raw_file" "$normalized_file" "$stderr_file"
      return 1
    fi
  fi
  rm -f "$stderr_file"

  cp "$raw_file" "$normalized_file"
  normalize_json_file "$normalized_file" || {
    cat "$raw_file"
    rm -f "$input_file" "$raw_file" "$normalized_file"
    return 1
  }

  score="$(jq -r '.score // empty' "$normalized_file")"
  reasoning="$(jq -r '.reasoning // .note // .details.reasoning // empty' "$normalized_file")"
  [ -n "$reasoning" ] || reasoning="Codex returned score without reasoning"

  jq -cn \
    --argjson score "$score" \
    --arg reasoning "$reasoning" \
    --arg model "gpt-5.4" \
    --argjson iteration 1 \
    '{score: $score, details: {reasoning: $reasoning}, model: $model, iteration: $iteration}'

  rm -f "$input_file" "$raw_file" "$normalized_file"
}

judge_sleep_duration() {
  local count_5h count_7d wait_5h wait_7d
  local remaining_5h_pct remaining_7d_pct time_5h_pct time_7d_pct headroom

  count_5h="$(usage_count_since codex 18000)"
  count_7d="$(usage_count_since codex 604800)"
  wait_5h="$(seconds_until_slot_available codex 18000 "${CODEX_MAX_RUNS_5H:-10}")"
  wait_7d="$(seconds_until_slot_available codex 604800 "${CODEX_MAX_RUNS_7D:-70}")"

  remaining_5h_pct="$(remaining_pct_from_counts "$count_5h" "${CODEX_MAX_RUNS_5H:-10}")"
  remaining_7d_pct="$(remaining_pct_from_counts "$count_7d" "${CODEX_MAX_RUNS_7D:-70}")"
  time_5h_pct="$(pct_from_seconds "$wait_5h" 18000)"
  time_7d_pct="$(pct_from_seconds "$wait_7d" 604800)"
  headroom="$(awk -v a="$(calc_headroom "$remaining_5h_pct" "$time_5h_pct")" -v b="$(calc_headroom "$remaining_7d_pct" "$time_7d_pct")" 'BEGIN { if (a < b) print a; else print b }')"

  if awk -v h="$headroom" 'BEGIN { exit !(h >= 60) }'; then
    echo 300
  elif awk -v h="$headroom" 'BEGIN { exit !(h >= 35) }'; then
    echo 600
  elif awk -v h="$headroom" 'BEGIN { exit !(h >= 15) }'; then
    echo 900
  else
    echo 1200
  fi
}
