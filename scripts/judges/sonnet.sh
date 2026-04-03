#!/usr/bin/env bash
set -euo pipefail

JUDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_ROOT="$(cd "$JUDGE_DIR/../.." && pwd)"

# shellcheck source=scripts/score-helpers.sh
source "$SCORE_ROOT/scripts/score-helpers.sh"

judge_name() {
  echo "sonnet"
}

judge_required_tools() {
  echo "claude jq python3 node git"
}

judge_build_queue() {
  local post_file ticket_id

  while IFS= read -r post_file; do
    [ -n "$post_file" ] || continue
    ticket_id="$(get_ticket_id "$SCORE_ROOT/src/content/posts/$post_file")"
    [ -n "$ticket_id" ] || continue
    if [ -z "$(get_score sonnet "$ticket_id")" ]; then
      echo "$post_file"
    fi
  done < <(list_all_posts)
}

judge_check_quota() {
  local backoff_remaining

  # 1. Respect rate-limit backoff from previous 429
  backoff_remaining="$(rate_limit_backoff_remaining sonnet)"
  if [ "$backoff_remaining" -gt 0 ]; then
    echo "sleep:${backoff_remaining}"
    return 0
  fi

  # 2. Real quota check via usage-monitor.sh → Anthropic API
  # Sonnet shares Anthropic quota with Opus, but is much cheaper per call.
  # We use the same Claude quota check — if Opus can run, Sonnet definitely can.
  source "$SCORE_ROOT/scripts/quota-bridge.sh"
  claude_real_quota_check
}

judge_score_post() {
  local post_path="$1"
  local prompt_file input_file raw_file normalized_file
  prompt_file="$SCORE_ROOT/scripts/prompts/readability-reviewer.md"
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
    echo "## Blog glossary (check if post links to these)"
    cat "$SCORE_ROOT/src/data/glossary.json"
    echo
    echo "## Post content"
    cat "$post_path"
    echo
    echo "Remember: output ONLY valid JSON, nothing else."
  } > "$input_file"

  # Use Sonnet — zero context, fresh eyes reviewer
  if ! timeout 300 claude -p \
    --model claude-sonnet-4-20250514 \
    --permission-mode bypassPermissions \
    --max-turns 1 \
    "$(cat "$input_file")" > "$raw_file" 2>/dev/null; then
    if [ ! -s "$raw_file" ]; then
      rm -f "$input_file" "$raw_file" "$normalized_file"
      return 1
    fi
  fi

  cp "$raw_file" "$normalized_file"
  normalize_json_file "$normalized_file" || {
    cat "$raw_file" >&2
    rm -f "$input_file" "$raw_file" "$normalized_file"
    return 1
  }

  # Extract and normalize scores
  local readability glossary composite
  readability="$(jq -r '.scores.readability.score // empty' "$normalized_file")"
  glossary="$(jq -r '.scores.glossary.score // empty' "$normalized_file")"

  if [ -z "$readability" ] || [ -z "$glossary" ]; then
    echo "Missing readability or glossary score" >&2
    rm -f "$input_file" "$raw_file" "$normalized_file"
    return 1
  fi

  composite="$(awk -v r="$readability" -v g="$glossary" 'BEGIN { printf "%d", (r + g) / 2 }')"

  local readability_note glossary_note confusion_points missing_terms unlinked_terms
  readability_note="$(jq -r '.scores.readability.note // ""' "$normalized_file")"
  glossary_note="$(jq -r '.scores.glossary.note // ""' "$normalized_file")"
  confusion_points="$(jq -c '.confusionPoints // []' "$normalized_file")"
  missing_terms="$(jq -c '.missingTerms // []' "$normalized_file")"
  unlinked_terms="$(jq -c '.unlinkedTerms // []' "$normalized_file")"

  jq -cn \
    --argjson score "$composite" \
    --argjson readability "$readability" \
    --argjson glossary "$glossary" \
    --arg readabilityNote "$readability_note" \
    --arg glossaryNote "$glossary_note" \
    --argjson confusionPoints "$confusion_points" \
    --argjson missingTerms "$missing_terms" \
    --argjson unlinkedTerms "$unlinked_terms" \
    --arg model "claude-sonnet-4-20250514" \
    --argjson iteration 1 \
    '{score: $score, details: {readability: $readability, glossary: $glossary, readabilityNote: $readabilityNote, glossaryNote: $glossaryNote, confusionPoints: $confusionPoints, missingTerms: $missingTerms, unlinkedTerms: $unlinkedTerms}, model: $model, harness: "Claude Code", iteration: $iteration}'

  rm -f "$input_file" "$raw_file" "$normalized_file"
}

judge_sleep_duration() {
  # Sonnet is cheap and fast — short sleep between posts
  echo "${SONNET_SLEEP_SECONDS:-10}"
}
