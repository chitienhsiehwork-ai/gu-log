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
  local prompt_file output_file validator
  prompt_file="$SCORE_ROOT/scripts/prompts/crossref-verifier.md"
  output_file="/tmp/gemini-score-output-$$.json"
  validator="$SCORE_ROOT/scripts/validate-judge-output.sh"

  local debug_dir="$SCORE_ROOT/.score-loop/raw"
  mkdir -p "$debug_dir"

  local task_file="$(mktemp)"
  cat > "$task_file" << TASK_EOF
$(cat "$prompt_file")

## Execution Instructions
You are running inside Gemini CLI with shell access enabled.

Follow these steps exactly:

1. Read the post context section below in this file.
2. Score the post according to the rubric above.
3. Write ONLY valid JSON to this exact path: $output_file
4. Use a shell command to write the file, for example:
   cat > $output_file <<'EOF'
   {"score": 0, "reasoning": "...", "unlinked_terms": []}
   EOF
5. Run this validator command:
   bash $validator gemini $output_file
6. If the validator output starts with ERROR, read the error carefully, fix the JSON, rewrite $output_file, and run the validator again.
7. Repeat until the validator output is exactly OK.

Requirements:
- Do not print the final JSON to stdout. Write it to $output_file.
- Do not stop after the first attempt if validation fails.
- The JSON must match this schema exactly:
  {"score": N, "reasoning": "Glossary X/3: ... Total: N/10.", "unlinked_terms": ["term1", "term2"]}
- score must be an integer from 0 to 10.
- reasoning must be a non-empty string.
- unlinked_terms must be an array. Use [] if there are none.

## Post Context

### Repository context
File: $(basename "$post_path")
Ticket: $(get_ticket_id "$post_path")

### Blog glossary (canonical terms — check if post links to these)
$(cat "$SCORE_ROOT/src/data/glossary.json")

### Internal gu-log references detected in this post
$(build_internal_ref_context "$post_path")

### Post content
$(cat "$post_path")
TASK_EOF

  local raw_file
  raw_file="$(mktemp)"

  GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 \
    gemini --model gemini-3.1-pro-preview --yolo \
    --prompt "Read $task_file for your instructions. Follow them exactly." \
    < /dev/null > "$raw_file" 2>&1 || true

  # Save raw CLI output for debugging
  cp "$raw_file" "$debug_dir/gemini-$(basename "$post_path" .mdx).txt" 2>/dev/null || true
  rm -f "$raw_file"

  # Gemini should have written + validated the file. Just check it exists.
  if [ ! -f "$output_file" ]; then
    rm -f "$task_file"
    echo "Gemini did not write output file: $output_file" >&2
    return 1
  fi

  # Final safety check (Gemini should have already validated, but trust but verify)
  local validation_result
  validation_result="$(bash "$validator" gemini "$output_file" 2>&1)"
  if [ "$validation_result" != "OK" ]; then
    cp "$output_file" "$debug_dir/gemini-$(basename "$post_path" .mdx)-invalid.json" 2>/dev/null || true
    rm -f "$output_file" "$task_file"
    echo "Final validation failed: $validation_result" >&2
    return 1
  fi

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

  rm -f "$output_file" "$task_file"
}

judge_sleep_duration() {
  echo "${GEMINI_SLEEP_SECONDS:-5}"
}
