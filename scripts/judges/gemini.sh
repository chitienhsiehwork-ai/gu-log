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
  local prompt_file context_file output_file validator
  prompt_file="$SCORE_ROOT/scripts/prompts/crossref-verifier.md"
  context_file="$(mktemp)"
  output_file="/tmp/gemini-score-output-$$.json"
  validator="$SCORE_ROOT/scripts/validate-judge-output.sh"

  local debug_dir="$SCORE_ROOT/.score-loop/raw"
  mkdir -p "$debug_dir"

  # Build context file for Gemini to read
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
  } > "$context_file"

  # Build the prompt: read context file, write JSON to output file, must pass validation
  local task_prompt
  task_prompt="$(cat "$prompt_file")

## YOUR TASK
1. Read the context file: $context_file
2. Analyze the post according to the scoring rubric above
3. Write your JSON output to: $output_file
4. Run the validator: bash $validator gemini $output_file
5. If the validator says ERROR, fix your JSON and try again until it says OK
6. The validator checks: valid JSON, score 0-10, reasoning present, unlinked_terms is array

IMPORTANT: Do NOT print the JSON to stdout. Write it to the file path above."

  local attempt max_attempts=2 raw_file validation_result
  for (( attempt=1; attempt<=max_attempts; attempt++ )); do
    rm -f "$output_file"

    raw_file="$(mktemp)"
    if ! GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 \
      gemini --model gemini-3.1-pro-preview --yolo \
      --prompt "$task_prompt" \
      < /dev/null > "$raw_file" 2>&1; then
      cp "$raw_file" "$debug_dir/gemini-$(basename "$post_path" .mdx)-attempt${attempt}-stderr.txt"
      rm -f "$raw_file"
      # Don't fail yet — Gemini CLI sometimes exits non-zero but still writes the file
    fi

    # Save raw CLI output for debugging
    cp "$raw_file" "$debug_dir/gemini-$(basename "$post_path" .mdx)-attempt${attempt}.txt" 2>/dev/null || true
    rm -f "$raw_file"

    # Check if output file exists and validate
    if [ -f "$output_file" ]; then
      validation_result="$(bash "$validator" gemini "$output_file" 2>&1)"
      if [ "$validation_result" = "OK" ]; then
        break  # Success!
      fi
      cp "$output_file" "$debug_dir/gemini-$(basename "$post_path" .mdx)-attempt${attempt}-invalid.json" 2>/dev/null || true
    else
      validation_result="Gemini did not write output file"
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      rm -f "$context_file" "$output_file"
      echo "Validation failed after $max_attempts attempts: $validation_result" >&2
      return 1
    fi

    # Retry with error feedback
    task_prompt="Your previous attempt failed validation: $validation_result

Please try again. Write valid JSON to: $output_file
Then run: bash $validator gemini $output_file
Expected format: {\"score\": N, \"reasoning\": \"...\", \"unlinked_terms\": [\"term1\", ...]}"
    sleep 3
  done

  # Read validated output and normalize to our format
  local score reasoning unlinked_terms
  score="$(jq -r '.score' "$output_file")"
  reasoning="$(jq -r '.reasoning // empty' "$output_file")"
  [ -n "$reasoning" ] || reasoning="Gemini returned score without reasoning"
  unlinked_terms="$(jq -c '.unlinked_terms // []' "$output_file")"

  jq -cn \
    --argjson score "$score" \
    --arg reasoning "$reasoning" \
    --argjson unlinked_terms "$unlinked_terms" \
    --arg model "gemini-3.1-pro-preview" \
    --argjson iteration 1 \
    '{score: $score, details: {reasoning: $reasoning, unlinked_terms: $unlinked_terms}, model: $model, iteration: $iteration}'

  rm -f "$context_file" "$output_file"
}

judge_sleep_duration() {
  echo "${GEMINI_SLEEP_SECONDS:-5}"
}
