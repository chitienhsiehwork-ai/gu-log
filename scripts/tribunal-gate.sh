#!/usr/bin/env bash
# tribunal-gate.sh — Multi-judge convergence loop for quality threshold
#
# Finds posts with ALL 3 scores that don't meet the Tribunal threshold,
# rewrites them incorporating ALL judges' feedback, then clears their scores
# so the judges will re-queue and re-score in the next orchestrator round.
#
# Usage:
#   ./scripts/tribunal-gate.sh [LIMIT] [--dry-run]
#   LIMIT: max posts to process (default 3)
#   --dry-run: list posts that would be processed, no changes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

source "$SCRIPT_DIR/score-helpers.sh"
# score-helpers.sh sources ralph-helpers.sh already

# ─── Thresholds ───
TRIBUNAL_GEMINI_MIN=9
TRIBUNAL_CODEX_MIN=9
TRIBUNAL_OPUS_PERSONA_MIN=8
TRIBUNAL_OPUS_CLAWDNOTE_MIN=8
TRIBUNAL_OPUS_VIBE_MIN=8
TRIBUNAL_MAX_ROUNDS=3

# ─── Paths ───
TRIBUNAL_PROGRESS="$ROOT_DIR/scores/tribunal-progress.json"
LOG_DIR="$ROOT_DIR/.score-loop/logs"
LOCK_FILE="/tmp/tribunal-gate.lock"
LOG_FILE="$LOG_DIR/tribunal-$(TZ=Asia/Taipei date +%Y%m%d).log"

# ─── Args ───
DRY_RUN=0
LIMIT=3

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    [0-9]*) LIMIT="$arg" ;;
  esac
done

# ─── Lock ───
exec 201>"$LOCK_FILE"
if ! flock -n 201; then
  echo "[tribunal-gate] Another instance is already running. Exiting."
  exit 0
fi

mkdir -p "$LOG_DIR"

tlog() {
  local msg="[$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z')] [tribunal] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Progress file helpers ───
ensure_tribunal_progress() {
  if [ ! -f "$TRIBUNAL_PROGRESS" ] || ! jq empty "$TRIBUNAL_PROGRESS" 2>/dev/null; then
    echo '{}' > "$TRIBUNAL_PROGRESS"
  fi
}

get_tribunal_iteration() {
  local ticket_id="$1"
  ensure_tribunal_progress
  jq -r --arg t "$ticket_id" '.[$t].iterations // 0' "$TRIBUNAL_PROGRESS"
}

set_tribunal_iteration() {
  local ticket_id="$1"
  local iters="$2"
  local tmp
  tmp="$(mktemp)"
  jq --arg t "$ticket_id" --argjson i "$iters" '.[$t].iterations = $i' \
    "$TRIBUNAL_PROGRESS" > "$tmp" && mv "$tmp" "$TRIBUNAL_PROGRESS"
}

# ─── Score pass/fail check ───
# Returns 0 if post PASSES tribunal (all thresholds met), 1 if fails
post_passes_tribunal() {
  local ticket_id="$1"

  local gscore
  gscore="$(jq -r '.score // 0' <<< "$(get_score gemini "$ticket_id")")"

  local cscore
  cscore="$(jq -r '.score // 0' <<< "$(get_score codex "$ticket_id")")"

  local opersona oclawdnote ovibe
  local opus_entry
  opus_entry="$(get_score opus "$ticket_id")"
  opersona="$(jq -r '.details.persona // 0' <<< "$opus_entry")"
  oclawdnote="$(jq -r '.details.clawdNote // 0' <<< "$opus_entry")"
  ovibe="$(jq -r '.details.vibe // 0' <<< "$opus_entry")"

  [ "$gscore" -ge "$TRIBUNAL_GEMINI_MIN" ] \
    && [ "$cscore" -ge "$TRIBUNAL_CODEX_MIN" ] \
    && [ "$opersona" -ge "$TRIBUNAL_OPUS_PERSONA_MIN" ] \
    && [ "$oclawdnote" -ge "$TRIBUNAL_OPUS_CLAWDNOTE_MIN" ] \
    && [ "$ovibe" -ge "$TRIBUNAL_OPUS_VIBE_MIN" ]
}

# ─── Build tribunal queue ───
# Outputs post filenames that have ALL 3 scores and fail threshold
build_tribunal_queue() {
  ensure_manifest_file gemini
  ensure_manifest_file codex
  ensure_manifest_file opus

  local post_file ticket_id
  while IFS= read -r post_file; do
    [ -n "$post_file" ] || continue
    ticket_id="$(get_ticket_id "$ROOT_DIR/src/content/posts/$post_file")"
    [ -n "$ticket_id" ] || continue

    # Must have all 3 scores
    [ -n "$(get_score gemini "$ticket_id")" ] || continue
    [ -n "$(get_score codex "$ticket_id")" ] || continue
    [ -n "$(get_score opus "$ticket_id")" ] || continue

    # Must fail at least one threshold
    if ! post_passes_tribunal "$ticket_id"; then
      echo "$post_file"
    fi
  done < <(list_all_posts)
}

# ─── Delete score entry from a manifest ───
delete_score_entry() {
  local judge="$1"
  local ticket_id="$2"
  local manifest
  manifest="$(score_manifest_path "$judge")"
  [ -f "$manifest" ] || return 0
  local tmp
  tmp="$(mktemp)"
  jq --arg t "$ticket_id" 'del(.[$t])' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
}

# ─── Log current scores for a post ───
log_scores() {
  local ticket_id="$1"
  local gscore cscore opersona oclawdnote ovibe opus_overall

  local gemini_entry codex_entry opus_entry
  gemini_entry="$(get_score gemini "$ticket_id")"
  codex_entry="$(get_score codex "$ticket_id")"
  opus_entry="$(get_score opus "$ticket_id")"

  gscore="$(jq -r '.score // "?"' <<< "$gemini_entry")"
  local greasonlng
  greasonlng="$(jq -r '.details.reasoning // ""' <<< "$gemini_entry" | head -c 200)"

  cscore="$(jq -r '.score // "?"' <<< "$codex_entry")"
  local creasoning
  creasoning="$(jq -r '.details.reasoning // ""' <<< "$codex_entry" | head -c 200)"

  opus_overall="$(jq -r '.score // "?"' <<< "$opus_entry")"
  opersona="$(jq -r '.details.persona // "?"' <<< "$opus_entry")"
  oclawdnote="$(jq -r '.details.clawdNote // "?"' <<< "$opus_entry")"
  ovibe="$(jq -r '.details.vibe // "?"' <<< "$opus_entry")"

  tlog "  Scores for $ticket_id:"
  tlog "    Gemini=$gscore (min $TRIBUNAL_GEMINI_MIN) | $greasonlng"
  tlog "    Codex=$cscore (min $TRIBUNAL_CODEX_MIN) | $creasoning"
  tlog "    Opus overall=$opus_overall | persona=$opersona (min $TRIBUNAL_OPUS_PERSONA_MIN), clawdNote=$oclawdnote (min $TRIBUNAL_OPUS_CLAWDNOTE_MIN), vibe=$ovibe (min $TRIBUNAL_OPUS_VIBE_MIN)"
}

# ─── Build rewrite prompt incorporating all 3 judges' feedback ───
build_rewrite_prompt() {
  local post_file="$1"
  local ticket_id="$2"

  local gemini_entry codex_entry opus_entry
  gemini_entry="$(get_score gemini "$ticket_id")"
  codex_entry="$(get_score codex "$ticket_id")"
  opus_entry="$(get_score opus "$ticket_id")"

  local gscore greasonig gunlinked
  gscore="$(jq -r '.score // "?"' <<< "$gemini_entry")"
  greasonig="$(jq -r '.details.reasoning // "(no reasoning)"' <<< "$gemini_entry")"
  gunlinked="$(jq -r '(.details.unlinked_terms // []) | join(", ")' <<< "$gemini_entry")"

  local cscore creasoning
  cscore="$(jq -r '.score // "?"' <<< "$codex_entry")"
  creasoning="$(jq -r '.details.reasoning // "(no reasoning)"' <<< "$codex_entry")"

  local opus_overall opersona oclawdnote ovibe opus_pfeedback opus_cfeedback opus_vfeedback
  opus_overall="$(jq -r '.score // "?"' <<< "$opus_entry")"
  opersona="$(jq -r '.details.persona // "?"' <<< "$opus_entry")"
  oclawdnote="$(jq -r '.details.clawdNote // "?"' <<< "$opus_entry")"
  ovibe="$(jq -r '.details.vibe // "?"' <<< "$opus_entry")"
  opus_pfeedback="$(jq -r '.details.personaFeedback // "(see persona score)"' <<< "$opus_entry")"
  opus_cfeedback="$(jq -r '.details.clawdNoteFeedback // "(see clawdNote score)"' <<< "$opus_entry")"
  opus_vfeedback="$(jq -r '.details.vibeFeedback // "(see vibe score)"' <<< "$opus_entry")"

  local en_file="en-$post_file"
  local en_path="src/content/posts/$en_file"

  cat <<PROMPT
You are a rewriter for the gu-log blog. Your task is to improve a post that failed the Tribunal Gate — a multi-judge quality threshold requiring ALL 3 judges to pass.

## References (read ALL before rewriting)
1. Read scripts/ralph-vibe-scoring-standard.md — scoring rubric with calibration examples
2. Read WRITING_GUIDELINES.md — LHY persona and style rules
3. Read CONTRIBUTING.md — frontmatter schema, ClawdNote format

## Current Tribunal Scores (ALL must pass to publish)

### Judge 1: Gemini Cross-Reference Verifier
Score: $gscore / 10 (need >= $TRIBUNAL_GEMINI_MIN)
Reasoning: $greasonig
Unlinked terms: $gunlinked

### Judge 2: Codex Fact Checker
Score: $cscore / 10 (need >= $TRIBUNAL_CODEX_MIN)
Reasoning: $creasoning

### Judge 3: Opus Vibe Checker
Overall: $opus_overall
  persona: $opersona / 10 (need >= $TRIBUNAL_OPUS_PERSONA_MIN) — $opus_pfeedback
  clawdNote: $oclawdnote / 10 (need >= $TRIBUNAL_OPUS_CLAWDNOTE_MIN) — $opus_cfeedback
  vibe: $ovibe / 10 (need >= $TRIBUNAL_OPUS_VIBE_MIN) — $opus_vfeedback

## Task
Rewrite src/content/posts/$post_file to fix EVERY issue flagged by ALL THREE judges above.
Also create/rewrite the English version at $en_path with lang: en and same ticketId.

## Rules
- Fix ALL Gemini issues: add missing internal links (use /posts/slug format), add attribution, link glossary terms
- Fix ALL Codex issues: correct or remove unsupported claims, add hedging for unverifiable statements
- Fix ALL Opus issues: improve persona (LHY professor style), strengthen ClawdNotes, boost overall vibe
- Keep ALL existing frontmatter fields intact (ticketId, source, sourceUrl, title, summary, tags, lang, dates)
- Do NOT touch translatedBy — the shell handles that automatically
- ALL annotation components must be <ClawdNote> (convert any CodexNote/GeminiNote/ClaudeCodeNote)
- Import ONLY ClawdNote from components (remove unused imports)
- Apply full LHY persona — passionate professor teaching with life analogies, not a news summary
- ClawdNote density: ~1 per 25 lines of prose, each with personality and opinion
- No bullet-dump endings, no motivational closings, no 「各位觀眾好」openings
- Kaomoji: MANDATORY — pre-commit hook rejects posts without at least one kaomoji. Sprinkle naturally in prose
- Use ONLY Solarized CSS variables for any inline color styling
PROMPT
}

# ─── Process one post ───
process_post() {
  local post_file="$1"
  local post_path="$ROOT_DIR/src/content/posts/$post_file"
  local ticket_id
  ticket_id="$(get_ticket_id "$post_path")"

  tlog "Processing: $post_file ($ticket_id)"
  log_scores "$ticket_id"

  local iteration
  iteration="$(get_tribunal_iteration "$ticket_id")"
  tlog "  Tribunal iteration: $iteration / $TRIBUNAL_MAX_ROUNDS"

  if [ "$iteration" -ge "$TRIBUNAL_MAX_ROUNDS" ]; then
    tlog "  SKIP: reached max rounds ($TRIBUNAL_MAX_ROUNDS) for $ticket_id"
    return 0
  fi

  local en_file="en-$post_file"
  local en_path="$ROOT_DIR/src/content/posts/$en_file"

  # Build the rewrite prompt
  local prompt
  prompt="$(build_rewrite_prompt "$post_file" "$ticket_id")"

  tlog "  Launching Claude rewriter (timeout 900s)..."
  local rewrite_exit=0
  local stdout_file
  stdout_file="$(mktemp)"

  if timeout 900 claude -p \
    --model claude-opus-4-6 \
    --permission-mode bypassPermissions \
    --max-turns 20 \
    "$prompt" > "$stdout_file" 2>&1; then
    tlog "  Rewriter completed."
  else
    rewrite_exit=$?
    tlog "  Rewriter exited with code $rewrite_exit. Stdout:"
    head -20 "$stdout_file" | while IFS= read -r line; do tlog "    $line"; done
  fi
  rm -f "$stdout_file"

  # Verify post file still exists (rewriter may have failed silently)
  if [ ! -f "$post_path" ]; then
    tlog "  ERROR: post file missing after rewrite, reverting"
    git checkout -- "src/content/posts/$post_file" 2>/dev/null || true
    return 1
  fi

  # Build check
  tlog "  Running pnpm build..."
  local build_log
  build_log="$(mktemp)"
  if ! pnpm run build > "$build_log" 2>&1; then
    tlog "  ERROR: build failed after rewrite"
    tail -20 "$build_log" | while IFS= read -r line; do tlog "    $line"; done
    rm -f "$build_log"
    tlog "  Reverting changes..."
    git checkout -- "src/content/posts/$post_file" 2>/dev/null || true
    git checkout -- "src/content/posts/$en_file" 2>/dev/null || true
    if ! git ls-files --error-unmatch "src/content/posts/$en_file" &>/dev/null 2>&1; then
      rm -f "$en_path"
    fi
    return 1
  fi
  rm -f "$build_log"
  tlog "  Build passed."

  # Add kaomoji to both files
  tlog "  Running add-kaomoji on zh file..."
  node scripts/add-kaomoji.mjs --write "src/content/posts/$post_file" 2>/dev/null || true
  if [ -f "$en_path" ]; then
    tlog "  Running add-kaomoji on en file..."
    node scripts/add-kaomoji.mjs --write "src/content/posts/$en_file" 2>/dev/null || true
  fi

  # Stamp ralph signature
  tlog "  Stamping ralph signature..."
  stamp_ralph_signature "$post_path"
  [ -f "$en_path" ] && stamp_ralph_signature "$en_path"

  # Clear scores from ALL 3 manifests (triggers re-queue in next round)
  tlog "  Clearing scores for $ticket_id from all 3 manifests..."
  delete_score_entry gemini "$ticket_id"
  delete_score_entry codex "$ticket_id"
  delete_score_entry opus "$ticket_id"

  # Increment tribunal iteration
  local new_iter=$(( iteration + 1 ))
  set_tribunal_iteration "$ticket_id" "$new_iter"
  tlog "  Tribunal iteration updated: $new_iter"

  # Git commit + push
  tlog "  Committing..."
  git add "src/content/posts/$post_file" 2>/dev/null || true
  [ -f "$en_path" ] && git add "src/content/posts/$en_file" 2>/dev/null || true
  git add "$TRIBUNAL_PROGRESS" 2>/dev/null || true
  git add "scores/gemini-scores.json" "scores/codex-scores.json" "scores/opus-scores.json" 2>/dev/null || true

  git commit -m "$(cat <<EOF
tribunal(${ticket_id}): rewrite round $new_iter — clear scores for re-judging

Tribunal iteration $new_iter / $TRIBUNAL_MAX_ROUNDS.
Scores cleared: Gemini, Codex, Opus — will re-queue in next orchestrator round.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
  )" 2>/dev/null || tlog "  WARN: git commit failed (nothing staged?)"

  tlog "  Pushing..."
  git push origin main >> "$LOG_FILE" 2>&1 || tlog "  WARN: git push failed"

  tlog "  Done: $ticket_id"
}

# ─── Main ───
tlog "=== Tribunal Gate started (limit=$LIMIT, dry-run=$DRY_RUN) ==="

ensure_score_dirs
ensure_tribunal_progress

# Build queue
tlog "Building tribunal queue..."
mapfile -t QUEUE < <(build_tribunal_queue)
TOTAL="${#QUEUE[@]}"
tlog "Found $TOTAL posts needing tribunal"

if [ "$TOTAL" -eq 0 ]; then
  tlog "Nothing to do. All scored posts pass the threshold."
  exit 0
fi

# Apply limit
PROCESSED=0
for post_file in "${QUEUE[@]}"; do
  [ "$PROCESSED" -lt "$LIMIT" ] || break

  ticket_id="$(get_ticket_id "$ROOT_DIR/src/content/posts/$post_file")"
  iteration="$(get_tribunal_iteration "$ticket_id")"

  if [ "$DRY_RUN" -eq 1 ]; then
    # Print dry-run info
    gscore="$(jq -r '.score // "?"' <<< "$(get_score gemini "$ticket_id")")"
    cscore="$(jq -r '.score // "?"' <<< "$(get_score codex "$ticket_id")")"
    opus_entry="$(get_score opus "$ticket_id")"
    opersona="$(jq -r '.details.persona // "?"' <<< "$opus_entry")"
    oclawdnote="$(jq -r '.details.clawdNote // "?"' <<< "$opus_entry")"
    ovibe="$(jq -r '.details.vibe // "?"' <<< "$opus_entry")"
    tlog "[DRY-RUN] $post_file ($ticket_id) iter=$iteration — Gemini=$gscore Codex=$cscore Opus=${opersona}/${oclawdnote}/${ovibe}"
    PROCESSED=$(( PROCESSED + 1 ))
    continue
  fi

  if [ "$iteration" -ge "$TRIBUNAL_MAX_ROUNDS" ]; then
    tlog "Skipping $ticket_id: max rounds ($TRIBUNAL_MAX_ROUNDS) reached"
    continue
  fi

  set +e
  process_post "$post_file"
  proc_exit=$?
  set -e

  if [ "$proc_exit" -ne 0 ]; then
    tlog "WARN: process_post failed for $post_file (exit=$proc_exit), continuing"
  fi

  PROCESSED=$(( PROCESSED + 1 ))
done

tlog "=== Tribunal Gate done. Processed=$PROCESSED / Total=$TOTAL ==="
