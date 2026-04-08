#!/usr/bin/env bash
set -euo pipefail

JUDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_ROOT="$(cd "$JUDGE_DIR/../.." && pwd)"

# shellcheck source=scripts/score-helpers.sh
source "$SCORE_ROOT/scripts/score-helpers.sh"

judge_name() {
  echo "opus"
}

judge_required_tools() {
  echo "claude jq python3 node pnpm git timeout"
}

judge_build_queue() {
  local post_file ticket_id

  while IFS= read -r post_file; do
    [ -n "$post_file" ] || continue
    ticket_id="$(get_ticket_id "$SCORE_ROOT/src/content/posts/$post_file")"
    [ -n "$ticket_id" ] || continue

    if [ -n "$(get_score gemini "$ticket_id")" ] \
      && [ -n "$(get_score codex "$ticket_id")" ] \
      && [ -n "$(get_score sonnet "$ticket_id")" ] \
      && [ -z "$(get_score opus "$ticket_id")" ]; then
      echo "$post_file"
    fi
  done < <(list_all_posts)
}

judge_check_quota() {
  local backoff_remaining

  # 1. Respect rate-limit backoff from previous 429
  backoff_remaining="$(rate_limit_backoff_remaining opus)"
  if [ "$backoff_remaining" -gt 0 ]; then
    echo "sleep:${backoff_remaining}"
    return 0
  fi

  # 2. Real quota check via usage-monitor.sh → Anthropic API
  source "$SCORE_ROOT/scripts/quota-bridge.sh"
  claude_real_quota_check
}

judge_score_post() {
  local post_path="$1"
  local raw_file normalized_file persona clawd_note vibe overall iteration
  raw_file="$(mktemp)"
  normalized_file="$(mktemp)"

  if ! bash "$SCORE_ROOT/scripts/ralph-scorer.sh" "$(basename "$post_path")" "$raw_file" >/dev/null 2>&1; then
    rm -f "$raw_file" "$normalized_file"
    return 1
  fi

  cp "$raw_file" "$normalized_file"
  validate_score_json "$normalized_file" "$(basename "$post_path")" || {
    rm -f "$raw_file" "$normalized_file"
    return 1
  }

  persona="$(jq -r '.scores.persona.score' "$normalized_file")"
  clawd_note="$(jq -r '.scores.clawdNote.score' "$normalized_file")"
  vibe="$(jq -r '.scores.vibe.score' "$normalized_file")"
  overall="$(awk -v a="$persona" -v b="$clawd_note" -v c="$vibe" 'BEGIN {
    min = a
    if (b < min) min = b
    if (c < min) min = c
    print min
  }')"
  iteration=1

  jq -cn \
    --argjson score "$overall" \
    --argjson persona "$persona" \
    --argjson clawdNote "$clawd_note" \
    --argjson vibe "$vibe" \
    --arg model "claude-opus-4-6" \
    --argjson iteration "$iteration" \
    '{score: $score, details: {persona: $persona, clawdNote: $clawdNote, vibe: $vibe}, model: $model, harness: "Claude Code", iteration: $iteration}'

  rm -f "$raw_file" "$normalized_file"
}

judge_fix_post() {
  local post_path="$1"
  local current_json="$2"
  local max_iterations=3 current_iteration persona clawd_note vibe score_json raw_file overall
  local base_file post_rel en_rel en_path run_dir build_log writer_log rewrite_prompt

  base_file="$(basename "$post_path")"
  post_rel="src/content/posts/${base_file}"
  en_rel="src/content/posts/en-${base_file}"
  en_path="$SCORE_ROOT/$en_rel"
  run_dir="$SCORE_ROOT/.score-loop/tmp/opus-$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$run_dir"

  score_json="$current_json"
  current_iteration="$(jq -r '.iteration // 1' <<< "$score_json")"

  while :; do
    persona="$(jq -r '.details.persona' <<< "$score_json")"
    clawd_note="$(jq -r '.details.clawdNote' <<< "$score_json")"
    vibe="$(jq -r '.details.vibe' <<< "$score_json")"

    if [ "$persona" -ge 9 ] && [ "$clawd_note" -ge 9 ] && [ "$vibe" -ge 9 ]; then
      printf '%s\n' "$score_json"
      return 0
    fi

    if [ "$current_iteration" -ge "$max_iterations" ]; then
      printf '%s\n' "$score_json"
      return 0
    fi

    writer_log="$run_dir/writer-${current_iteration}.log"
    build_log="$run_dir/build-${current_iteration}.log"

    rewrite_prompt="$(cat <<EOF
You are a rewriter for gu-log blog posts. Your job is to improve a post that failed quality review.

## References (read ALL before rewriting)
1. Read scripts/vibe-scoring-standard.md — THE scoring rubric with calibration examples
2. Read WRITING_GUIDELINES.md — LHY persona and style rules
3. Read CONTRIBUTING.md — frontmatter schema, ClawdNote format
4. Read this reviewer feedback JSON:
$score_json

## Task
Rewrite src/content/posts/$base_file to fix EVERY issue implied by the score profile.
Also create/rewrite the English version at src/content/posts/en-$base_file with lang: en and same ticketId.

## Rules
- Keep ALL existing frontmatter fields intact (ticketId, source, sourceUrl, title, summary, tags, lang, dates)
- Do NOT touch translatedBy — shell handles that automatically
- ALL notes must be ClawdNote (convert any CodexNote/GeminiNote/ClaudeCodeNote)
- Import ONLY ClawdNote from components (remove unused imports)
- Apply full LHY persona — professor teaching with life analogies, not news article
- ClawdNote density: ~1 per 25 lines of prose, each with personality and opinion
- No bullet-dump endings, no motivational closings, no 「各位觀眾好」openings
- Kaomoji: mandatory and natural; avoid markdown special chars
EOF
)"

    if ! timeout 900 claude -p \
      --model claude-opus-4-6 \
      --permission-mode bypassPermissions \
      --max-turns 20 \
      "$rewrite_prompt" > "$writer_log" 2>&1; then
      printf '%s\n' "$score_json"
      return 0
    fi

    if ! pnpm run build > "$build_log" 2>&1; then
      git checkout -- "$post_rel" 2>/dev/null || true
      git checkout -- "$en_rel" 2>/dev/null || true
      if ! git ls-files --error-unmatch "$en_rel" >/dev/null 2>&1; then
        rm -f "$en_path"
      fi

      current_iteration=$((current_iteration + 1))
      score_json="$(jq -cn \
        --argjson score "$(jq -r '.score' <<< "$score_json")" \
        --argjson persona "$persona" \
        --argjson clawdNote "$clawd_note" \
        --argjson vibe "$vibe" \
        --arg model "claude-opus-4-6" \
        --argjson iteration "$current_iteration" \
        '{score: $score, details: {persona: $persona, clawdNote: $clawdNote, vibe: $vibe}, model: $model, harness: "Claude Code", iteration: $iteration}')"
      continue
    fi

    node "$SCORE_ROOT/scripts/add-kaomoji.mjs" --write "$base_file" >/dev/null 2>&1 || true
    [ -f "$en_path" ] && node "$SCORE_ROOT/scripts/add-kaomoji.mjs" --write "en-$base_file" >/dev/null 2>&1 || true

    stamp_ralph_signature "$post_path"
    [ -f "$en_path" ] && stamp_ralph_signature "$en_path"

    raw_file="$(mktemp)"
    if ! bash "$SCORE_ROOT/scripts/ralph-scorer.sh" "$base_file" "$raw_file" >/dev/null 2>&1; then
      rm -f "$raw_file"
      printf '%s\n' "$score_json"
      return 0
    fi

    persona="$(jq -r '.scores.persona.score' "$raw_file")"
    clawd_note="$(jq -r '.scores.clawdNote.score' "$raw_file")"
    vibe="$(jq -r '.scores.vibe.score' "$raw_file")"
    current_iteration=$((current_iteration + 1))
    overall="$(awk -v a="$persona" -v b="$clawd_note" -v c="$vibe" 'BEGIN { min = a; if (b < min) min = b; if (c < min) min = c; print min }')"

    score_json="$(jq -cn \
      --argjson score "$overall" \
      --argjson persona "$persona" \
      --argjson clawdNote "$clawd_note" \
      --argjson vibe "$vibe" \
      --arg model "claude-opus-4-6" \
      --argjson iteration "$current_iteration" \
      '{score: $score, details: {persona: $persona, clawdNote: $clawdNote, vibe: $vibe}, model: $model, harness: "Claude Code", iteration: $iteration}')"

    rm -f "$raw_file"
  done
}

judge_sleep_duration() {
  local count_5h count_7d wait_5h wait_7d
  local remaining_5h_pct remaining_7d_pct time_5h_pct time_7d_pct headroom

  count_5h="$(usage_count_since opus 18000)"
  count_7d="$(usage_count_since opus 604800)"
  wait_5h="$(seconds_until_slot_available opus 18000 "${OPUS_MAX_RUNS_5H:-8}")"
  wait_7d="$(seconds_until_slot_available opus 604800 "${OPUS_MAX_RUNS_7D:-56}")"

  remaining_5h_pct="$(remaining_pct_from_counts "$count_5h" "${OPUS_MAX_RUNS_5H:-8}")"
  remaining_7d_pct="$(remaining_pct_from_counts "$count_7d" "${OPUS_MAX_RUNS_7D:-56}")"
  time_5h_pct="$(pct_from_seconds "$wait_5h" 18000)"
  time_7d_pct="$(pct_from_seconds "$wait_7d" 604800)"
  headroom="$(awk -v a="$(calc_headroom "$remaining_5h_pct" "$time_5h_pct")" -v b="$(calc_headroom "$remaining_7d_pct" "$time_7d_pct")" 'BEGIN { if (a < b) print a; else print b }')"

  if awk -v h="$headroom" 'BEGIN { exit !(h >= 60) }'; then
    echo 480
  elif awk -v h="$headroom" 'BEGIN { exit !(h >= 35) }'; then
    echo 720
  elif awk -v h="$headroom" 'BEGIN { exit !(h >= 15) }'; then
    echo 960
  else
    echo 1200
  fi
}
