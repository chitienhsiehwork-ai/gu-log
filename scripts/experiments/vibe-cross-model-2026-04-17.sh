#!/usr/bin/env bash
# One-shot experiment: score SP-175 + CP-85 with Opus 4.5 / 4.6 / 4.7
# Purpose: measure vibe-scoring bar drift across Opus versions.
# Output: .results/vibe-experiment-2026-04-17/{POST}_{MODEL}.json + .log
#
# User context: SP-175 passed tribunal v2 with composite 8, but user reads
# it as "weird to watch". CP-85 is the standard's 10-baseline. Hypothesis:
# scorer (Opus 4.7 frontmatter, tier-resolved) may be drifting too lenient
# on decorative-persona-trap posts. This script gives us empirical data
# across 3 Opus versions to confirm/refute.
#
# NOT for production pipeline — throwaway.

set -euo pipefail
cd "$(dirname "$0")/../.."

POSTS=(
  "sp-175-20260416-anthropic-opus-4-7-prompting-best-practices.mdx"
  "clawd-picks-20260216-yegge-ai-vampire.mdx"
)
MODELS=("claude-opus-4-5" "claude-opus-4-6" "claude-opus-4-7")
OUT_DIR=".results/vibe-experiment-2026-04-17"
mkdir -p "$OUT_DIR"

echo "Spawning 6 scorer runs (2 posts × 3 models) in parallel..."
echo "Output dir: $OUT_DIR"
echo "Timeout: 600s per run"
echo ""

pids=()
for post in "${POSTS[@]}"; do
  for model in "${MODELS[@]}"; do
    ticket="${post%%-2*}"           # sp-175 / clawd-picks
    ticket="${ticket%%-*}-${ticket##*-}"
    # Just use first 6 chars of filename stem for tag
    stem="${post%.mdx}"
    short=$(echo "$stem" | awk -F'-' '{
      if ($1 == "clawd") print "cp-85"
      else print $1"-"$2
    }')
    short=$(echo "$short" | tr -d '/')
    tag="${short}_${model##claude-opus-}"    # sp-175_4-5 / cp-85_4-7
    out="$OUT_DIR/${tag}.json"
    log="$OUT_DIR/${tag}.log"
    rm -f "$out"
    echo "  → $tag (model=$model, post=$post)"
    (
      timeout 600 claude -p \
        --agent vibe-opus-scorer \
        --model "$model" \
        --permission-mode bypassPermissions \
        --max-turns 5 \
        "Score this post: src/content/posts/$post
Write your JSON output to exactly this path: $out" \
        > "$log" 2>&1 || echo "EXITED non-zero (see $log)" >> "$log"
    ) &
    pids+=($!)
  done
done

echo ""
echo "Waiting for all 6 runs to finish..."
for pid in "${pids[@]}"; do
  wait "$pid" || true
done

echo ""
echo "All runs completed. Results:"
ls -la "$OUT_DIR"
echo ""
echo "Score summary:"
for f in "$OUT_DIR"/*.json; do
  [ -f "$f" ] || continue
  tag=$(basename "$f" .json)
  if [ -s "$f" ]; then
    dims=$(jq -c '.dimensions' "$f" 2>/dev/null || echo "PARSE_ERROR")
    score=$(jq -r '.score' "$f" 2>/dev/null || echo "?")
    verdict=$(jq -r '.verdict' "$f" 2>/dev/null || echo "?")
    echo "  $tag: composite=$score verdict=$verdict dims=$dims"
  else
    echo "  $tag: EMPTY (check ${tag}.log)"
  fi
done
