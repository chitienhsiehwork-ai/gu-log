#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
log_ok() { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
log_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }

model_display_name() {
  local model_id="$1"
  case "$model_id" in
    gemini-3.1-pro-preview) printf '%s' "Gemini 3.1 Pro" ;;
    gemini-3-flash) printf '%s' "Gemini 3 Flash" ;;
    gpt-5.4) printf '%s' "GPT-5.4" ;;
    gpt-5.3-codex) printf '%s' "GPT-5.3-Codex" ;;
    claude-opus) printf '%s' "Opus 4.6" ;;
    *) printf '%s' "$model_id" ;;
  esac
}

model_harness_name() {
  local model_id="$1"
  case "$model_id" in
    gemini-3.1-pro-preview|gemini-3-flash) printf '%s' "Gemini CLI" ;;
    gpt-5.4|gpt-5.3-codex) printf '%s' "Codex CLI" ;;
    claude-opus) printf '%s' "Claude Code CLI" ;;
    *) printf '%s' "Unknown Harness" ;;
  esac
}

LAST_MODEL_USED=""
LAST_HARNESS_USED=""

die() {
  log_error "$1"
  exit 1
}

run_with_fallback() {
  local prompt_file
  prompt_file=$(mktemp)
  if [ "${1:-}" = "-p" ]; then
    printf '%s' "$2" > "$prompt_file"
  else
    cat > "$prompt_file"
  fi

  local out_tmp
  local err_tmp
  out_tmp=$(mktemp)
  err_tmp=$(mktemp)
  
  # --opus mode: skip Gemini/Codex, go straight to Claude Code
  if [ "$OPUS_MODE" = true ]; then
    local prompt_text_opus
    prompt_text_opus=$(cat "$prompt_file")
    if claude -p --model opus --permission-mode bypassPermissions "$prompt_text_opus" > "$out_tmp" 2> "$err_tmp"; then
      LAST_MODEL_USED=$(model_display_name "claude-opus")
      LAST_HARNESS_USED=$(model_harness_name "claude-opus")
      cat "$out_tmp"
      cat "$err_tmp" >&2
      rm -f "$out_tmp" "$err_tmp" "$prompt_file"
      return 0
    fi
    log_error "Claude Code (Opus) failed in --opus mode" >&2
    cat "$err_tmp" >&2
    rm -f "$out_tmp" "$err_tmp" "$prompt_file"
    return 1
  fi

  # Pipe prompt via stdin to avoid ARG_MAX limit on large prompts
  if GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 gemini -m gemini-3.1-pro-preview --sandbox false -y < "$prompt_file" > "$out_tmp" 2> "$err_tmp"; then
    LAST_MODEL_USED=$(model_display_name "gemini-3.1-pro-preview")
    LAST_HARNESS_USED=$(model_harness_name "gemini-3.1-pro-preview")
    cat "$out_tmp"
    cat "$err_tmp" >&2
    rm -f "$out_tmp" "$err_tmp" "$prompt_file"
    return 0
  fi
  
  local exit_code=$?
  local err_content
  err_content=$(cat "$err_tmp")
  
  if echo "$err_content" | grep -qiE "429|TerminalQuotaError|exhausted your capacity"; then
    log_warn "Gemini Pro 429, falling back to Codex CLI" >&2
    local prompt_text
    prompt_text=$(cat "$prompt_file")
    if codex exec --model gpt-5.4 --full-auto -- "$prompt_text" > "$out_tmp" 2> "$err_tmp"; then
      LAST_MODEL_USED=$(model_display_name "gpt-5.4")
      LAST_HARNESS_USED=$(model_harness_name "gpt-5.4")
      cat "$out_tmp"
      cat "$err_tmp" >&2
      rm -f "$out_tmp" "$err_tmp" "$prompt_file"
      return 0
    fi
    log_warn "Codex CLI failed, falling back to Claude Code (Opus)" >&2
    local prompt_text_cc
    prompt_text_cc=$(cat "$prompt_file")
    if claude -p --model opus --permission-mode bypassPermissions "$prompt_text_cc" > "$out_tmp" 2> "$err_tmp"; then
      LAST_MODEL_USED=$(model_display_name "claude-opus")
      LAST_HARNESS_USED=$(model_harness_name "claude-opus")
      cat "$out_tmp"
      cat "$err_tmp" >&2
      rm -f "$out_tmp" "$err_tmp" "$prompt_file"
      return 0
    fi
    log_warn "Claude Code failed, falling back to Gemini Flash" >&2
    if GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 gemini -m gemini-3-flash --sandbox false -y < "$prompt_file" > "$out_tmp" 2> "$err_tmp"; then
      LAST_MODEL_USED=$(model_display_name "gemini-3-flash")
      LAST_HARNESS_USED=$(model_harness_name "gemini-3-flash")
      cat "$out_tmp"
      cat "$err_tmp" >&2
      rm -f "$out_tmp" "$err_tmp" "$prompt_file"
      return 0
    fi
    log_error "All fallback models failed" >&2
    cat "$err_tmp" >&2
    rm -f "$out_tmp" "$err_tmp" "$prompt_file"
    return 1
  else
    cat "$out_tmp"
    cat "$err_tmp" >&2
    rm -f "$out_tmp" "$err_tmp" "$prompt_file"
    return $exit_code
  fi
}

usage() {
  cat <<'USAGE'
Usage:
  bash sp-pipeline.sh <tweet_url> [--dry-run] [--force]

Options:
  --dry-run   Run steps 0-4.5 and stop before deploy.
  --force     Skip evaluation step (Step 1.5).
  --opus      Use Claude Opus for ALL pipeline stages (write/review/refine).
  -h, --help  Show this help message.
USAGE
}

check_required_tools() {
  local tools=(bird gemini codex jq node npm git)
  local missing=()
  local t
  for t in "${tools[@]}"; do
    if ! command -v "$t" >/dev/null 2>&1; then
      missing+=("$t")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die "Missing required tools: ${missing[*]}"
  fi
}

sanitize_slug() {
  local input="$1"
  local out
  out=$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E "s/'//g; s/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g")
  if [ -z "$out" ]; then
    out="article"
  fi
  printf '%s' "$out"
}

extract_tweet_date() {
  local source_file="$1"
  local date_val=""
  local bird_date_line=""

  # Try bird-specific format first: 📅 Fri Feb 28 02:09:23 +0000 2026
  bird_date_line=$(grep -m1 '📅' "$source_file" | sed 's/^📅[[:space:]]*//' || true)
  if [ -n "$bird_date_line" ]; then
    date_val=$(date -d "$bird_date_line" +%F 2>/dev/null || true)
    if [ -n "$date_val" ]; then
      printf '%s' "$date_val"
      return 0
    fi
  fi

  # Fallback: ISO date format
  date_val=$(grep -Eo '[0-9]{4}-[0-9]{2}-[0-9]{2}' "$source_file" | head -n 1 || true)
  if [ -n "$date_val" ]; then
    printf '%s' "$date_val"
    return 0
  fi

  # Fallback: slash date format
  date_val=$(grep -Eo '[0-9]{4}/[0-9]{2}/[0-9]{2}' "$source_file" | head -n 1 | tr '/' '-' || true)
  if [ -n "$date_val" ]; then
    printf '%s' "$date_val"
    return 0
  fi

  return 1
}

TWEET_URL=""
DRY_RUN=false
FORCE=false
TICKET_PREFIX="SP"
OPUS_MODE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --prefix)
      shift
      TICKET_PREFIX="${1:-SP}"
      shift
      ;;
    --opus)
      OPUS_MODE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      die "Unknown option: $1"
      ;;
    *)
      if [ -n "$TWEET_URL" ]; then
        die "Unexpected extra argument: $1"
      fi
      TWEET_URL="$1"
      shift
      ;;
  esac
done

if [ -z "$TWEET_URL" ]; then
  usage
  exit 1
fi

GU_LOG_DIR="${GU_LOG_DIR:-$HOME/clawd/projects/gu-log}"
cd "$GU_LOG_DIR"
source scripts/ralph-helpers.sh
COUNTER_FILE="$GU_LOG_DIR/scripts/article-counter.json"
STYLE_GUIDE_FILE="$GU_LOG_DIR/scripts/sp-style-guide.md"
POSTS_DIR="$GU_LOG_DIR/src/content/posts"
TOTAL_START=$(date +%s)

STEP0_TIME=0
STEP1_TIME=0
STEP15_TIME=0
STEP2_TIME=0
STEP3_TIME=0
STEP4_TIME=0
STEP45_TIME=0
STEP47_TIME=0
STEP5_TIME=0

FILENAME=""
TITLE=""
SP_NUM=""
WORK_DIR=""
AUTHOR_HANDLE=""
ORIGINAL_DATE=""
WRITE_MODEL=""
WRITE_HARNESS=""
REVIEW_MODEL=""
REVIEW_HARNESS=""
REFINE_MODEL=""
REFINE_HARNESS=""

trap 'log_error "Pipeline failed at line $LINENO"' ERR

step_start() {
  STEP_TS=$(date +%s)
  log_info "$1"
}

step_end() {
  local name="$1"
  local elapsed
  elapsed=$(( $(date +%s) - STEP_TS ))
  log_ok "$name completed in ${elapsed}s"
  printf '%s' "$elapsed"
}

check_required_tools

# Step 0: Setup
step_start "Step 0: setup"
[ -f "$COUNTER_FILE" ] || die "Missing counter file: $COUNTER_FILE"
[ -f "$STYLE_GUIDE_FILE" ] || die "Missing style guide file: $STYLE_GUIDE_FILE"

SP_NUM=$(jq -r ".${TICKET_PREFIX}.next // empty" "$COUNTER_FILE")
[ -n "$SP_NUM" ] || die "Could not read ${TICKET_PREFIX}.next from $COUNTER_FILE"

WORK_DIR="$GU_LOG_DIR/tmp/${TICKET_PREFIX,,}-${SP_NUM}-pipeline"
mkdir -p "$WORK_DIR"
STEP0_TIME=$(step_end "Step 0")

# Step 1: Fetch content
step_start "Step 1: fetch content"
if [[ "$TWEET_URL" == *"twitter.com"* ]] || [[ "$TWEET_URL" == *"x.com"* ]]; then
  if ! bird read "$TWEET_URL" > "$WORK_DIR/source-tweet.md"; then
    die "bird read failed for URL: $TWEET_URL"
  fi

  AUTHOR_HANDLE=$(grep -Eo '@[A-Za-z0-9_]+' "$WORK_DIR/source-tweet.md" | head -n 1 | sed 's/^@//' || true)
  [ -n "$AUTHOR_HANDLE" ] || die "Failed to extract author handle from bird output"

  ORIGINAL_DATE=$(extract_tweet_date "$WORK_DIR/source-tweet.md" || true)
  [ -n "$ORIGINAL_DATE" ] || die "Failed to extract tweet date from bird output"
else
  log_info "Non-twitter URL detected. Fetching via curl and extracting metadata via Gemini..."
  
  # Dump via curl and simple HTML stripping (just enough for Gemini to read text)
  curl -sL "$TWEET_URL" | sed -e 's/<style[^>]*>.*<\/style>//ig' -e 's/<script[^>]*>.*<\/script>//ig' -e 's/<[^>]*>//g' | tr -s ' \t\r\n' '\n' > "$WORK_DIR/source-tweet.md"
  
  cat > "$WORK_DIR/extract-meta-prompt.txt" <<EOF_META
Extract the author handle/name (no @) and the publication date (YYYY-MM-DD format) from the text.
If the author is an organization like OpenAI, output "OpenAI".
If date is missing, output the current date.
Output ONLY valid JSON in this exact format: {"author": "AuthorName", "date": "YYYY-MM-DD"}

Text snippet:
$(head -n 200 "$WORK_DIR/source-tweet.md")
EOF_META

  META_JSON=$(run_with_fallback -p "$(cat "$WORK_DIR/extract-meta-prompt.txt")")
  AUTHOR_HANDLE=$(echo "$META_JSON" | grep -o '"author": *"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
  ORIGINAL_DATE=$(echo "$META_JSON" | grep -o '"date": *"[^"]*"' | cut -d'"' -f4 || date +%F)
  
  [ -n "$AUTHOR_HANDLE" ] && [ "$AUTHOR_HANDLE" != "Unknown" ] || AUTHOR_HANDLE="OpenAI"
  [ -n "$ORIGINAL_DATE" ] || ORIGINAL_DATE=$(date +%F)
  
  log_info "Extracted Author: $AUTHOR_HANDLE, Date: $ORIGINAL_DATE"
fi
STEP1_TIME=$(step_end "Step 1")

# Step 1.5: Evaluate worthiness
if [ "$FORCE" = true ]; then
  log_warn "--force enabled; skipping Step 1.5 evaluation"
else
  step_start "Step 1.5: evaluate worthiness"
  cat > "$WORK_DIR/eval-gemini-prompt.txt" <<EOF_EVAL_GEMINI
Evaluate whether this tweet is worth translating into a gu-log article.

Checklist:
1. Is the content substantial enough for a gu-log article (not just a one-liner/hot take)?
2. Is it relevant to gu-log audience topics (AI, tech, developer, indie hacker)?
3. Does it have enough depth to expand into a full article?

Tweet source:
$(cat "$WORK_DIR/source-tweet.md")

Output requirements:
- Write JSON only (no markdown) to eval-gemini.json in current directory.
- Exact schema:
  {"verdict":"GO"|"SKIP","reason":"...","suggested_title":"..."}
EOF_EVAL_GEMINI

  cat > "$WORK_DIR/eval-codex-prompt.txt" <<EOF_EVAL_CODEX
Evaluate whether this tweet is worth translating into a gu-log article.

Checklist:
1. Is the content substantial enough for a gu-log article (not just a one-liner/hot take)?
2. Is it relevant to gu-log audience topics (AI, tech, developer, indie hacker)?
3. Does it have enough depth to expand into a full article?

Tweet source:
$(cat "$WORK_DIR/source-tweet.md")

Output requirements:
- Write JSON only (no markdown) to eval-codex.json in current directory.
- Exact schema:
  {"verdict":"GO"|"SKIP","reason":"...","suggested_title":"..."}
EOF_EVAL_CODEX

  set +e
  (
    cd "$WORK_DIR"
    run_with_fallback < eval-gemini-prompt.txt
  )
  GEMINI_EVAL_STATUS=$?
  (
    cd "$WORK_DIR"
    codex exec -C . --model gpt-5.4 --full-auto "$(cat eval-codex-prompt.txt)"
  )
  CODEX_EVAL_STATUS=$?
  set -e

  [ -s "$WORK_DIR/eval-gemini.json" ] || die "eval-gemini.json missing or empty"
  [ -s "$WORK_DIR/eval-codex.json" ] || die "eval-codex.json missing or empty"
  [ "$GEMINI_EVAL_STATUS" -eq 0 ] || die "Gemini evaluation command failed"
  [ "$CODEX_EVAL_STATUS" -eq 0 ] || die "Codex evaluation command failed"

  GEMINI_VERDICT=$(jq -r '.verdict // empty' "$WORK_DIR/eval-gemini.json")
  GEMINI_REASON=$(jq -r '.reason // empty' "$WORK_DIR/eval-gemini.json")
  CODEX_VERDICT=$(jq -r '.verdict // empty' "$WORK_DIR/eval-codex.json")
  CODEX_REASON=$(jq -r '.reason // empty' "$WORK_DIR/eval-codex.json")

  if [ "$GEMINI_VERDICT" != "GO" ] && [ "$GEMINI_VERDICT" != "SKIP" ]; then
    die "Invalid Gemini verdict in eval-gemini.json: $GEMINI_VERDICT"
  fi
  if [ "$CODEX_VERDICT" != "GO" ] && [ "$CODEX_VERDICT" != "SKIP" ]; then
    die "Invalid Codex verdict in eval-codex.json: $CODEX_VERDICT"
  fi

  if [ "$GEMINI_VERDICT" = "GO" ] && [ "$CODEX_VERDICT" = "GO" ]; then
    log_info "Step 1.5 decision: GO/GO"
    log_info "Gemini reason: $GEMINI_REASON"
    log_info "Codex reason: $CODEX_REASON"
  elif [ "$GEMINI_VERDICT" = "SKIP" ] && [ "$CODEX_VERDICT" = "SKIP" ]; then
    log_info "Step 1.5 decision: SKIP/SKIP"
    log_info "Gemini reason: $GEMINI_REASON"
    log_info "Codex reason: $CODEX_REASON"
    log_ok "Both evaluators said SKIP; exiting without error"
    exit 0
  else
    log_warn "Gemini verdict: $GEMINI_VERDICT | reason: $GEMINI_REASON"
    log_warn "Codex verdict: $CODEX_VERDICT | reason: $CODEX_REASON"
    log_warn "SPLIT DECISION — Gemini says $GEMINI_VERDICT, Codex says $CODEX_VERDICT. Run with --force to override, or let Clawd decide."
    exit 2
  fi

  STEP15_TIME=$(step_end "Step 1.5")
fi

# Step 2: Gemini Write
step_start "Step 2: gemini write draft"
cat > "$WORK_DIR/gemini-write-prompt.txt" <<EOF_WRITE
You are writing a gu-log SP article draft in Traditional Chinese.

Task:
- Write ${TICKET_PREFIX}-${SP_NUM} article from the source tweet.
- Follow the style guide exactly.
- Use this metadata:
  - ticketId: ${TICKET_PREFIX}-${SP_NUM}
  - originalDate: ${ORIGINAL_DATE}
  - translatedDate: $(date +%F)
  - source: @${AUTHOR_HANDLE} on X
  - sourceUrl: ${TWEET_URL}

Extra metadata:
  - First tag must be: $(if [[ "$TICKET_PREFIX" == "CP" ]]; then echo "clawd-picks"; else echo "shroom-picks"; fi)

Hard requirements:
- Write output to a file named draft-v1.mdx in the current directory.
- Do not leave the output empty.
- Include valid MDX frontmatter and body.

Style guide:
$(cat "$STYLE_GUIDE_FILE")

Source tweet:
$(cat "$WORK_DIR/source-tweet.md")
EOF_WRITE

pushd "$WORK_DIR" >/dev/null
run_with_fallback -p "$(cat gemini-write-prompt.txt)"
popd >/dev/null

WRITE_MODEL="$LAST_MODEL_USED"
WRITE_HARNESS="$LAST_HARNESS_USED"

[ -s "$WORK_DIR/draft-v1.mdx" ] || die "draft-v1.mdx missing or empty"
STEP2_TIME=$(step_end "Step 2")

# Step 3: Codex Review
step_start "Step 3: codex review"
cat > "$WORK_DIR/review-prompt.txt" <<EOF_REVIEW
Review draft-v1.mdx for ${TICKET_PREFIX}-${SP_NUM}.

Checklist:
1. Fact-check: no hallucinated claims beyond source context.
2. Style alignment: matches sp-style-guide.md requirements.
3. Frontmatter accuracy: ticketId/source/sourceUrl/dates/tags format.
4. ClawdNote usage and kaomoji requirements.
5. Clear actionable fixes.
6. Certainty Preservation: source hedging language (seems, might, I think) must not be upgraded to definitive statements.
7. Number Integrity: every number in translation must trace back to source. No invented statistics/revenue/percentages.
8. Constraint Coverage: source limitations, caveats, and conditions must be preserved.
9. Ending Fidelity: conclusion must not introduce claims beyond source material.
10. Summary length: must be ≤300 characters.
11. Coverage Completeness: no key source claim/example/caveat is omitted.
12. Attribution Preservation: speculative opinions remain explicitly attributed to source author.

Severity: label each issue Blocker/Major/Minor.
Patch: each issue must include exact source quote + proposed replacement text.

Output requirements:
- Write the full review to review.md in the current directory.
- Focus on actionable fixes. No need to write agent notes JSON — all commentary goes through ClawdNote in the article itself.
EOF_REVIEW

if [ "$OPUS_MODE" = true ]; then
  (
    cd "$WORK_DIR"
    claude -p --model opus --permission-mode bypassPermissions "$(cat review-prompt.txt)"
  )
  REVIEW_MODEL=$(model_display_name "claude-opus")
  REVIEW_HARNESS=$(model_harness_name "claude-opus")
else
  (
    cd "$WORK_DIR"
    codex exec -C . --model gpt-5.4 --full-auto "$(cat review-prompt.txt)"
  )
  REVIEW_MODEL=$(model_display_name "gpt-5.4")
  REVIEW_HARNESS=$(model_harness_name "gpt-5.4")
fi

[ -s "$WORK_DIR/review.md" ] || die "review.md missing or empty"
STEP3_TIME=$(step_end "Step 3")

# Step 4: Gemini Refine
step_start "Step 4: gemini refine"
cat > "$WORK_DIR/refine-prompt.txt" <<EOF_REFINE
Refine the ${TICKET_PREFIX}-${SP_NUM} draft using review feedback.

Inputs:
- draft-v1.mdx
- review.md

Task:
- Produce a corrected final article.
- Keep style-guide compliance.
- Ensure frontmatter values remain accurate.

Output requirements:
- Write final output to final.mdx in the current directory.
- Only use ClawdNote for commentary (no CodexNote/GeminiNote). Add ClawdNotes wherever there's genuine insight — no fixed number, quality over quantity.
- Only import ClawdNote from '../../components/ClawdNote.astro' — no other note components.
EOF_REFINE

pushd "$WORK_DIR" >/dev/null
run_with_fallback -p "$(cat refine-prompt.txt)"
popd >/dev/null

REFINE_MODEL="$LAST_MODEL_USED"
REFINE_HARNESS="$LAST_HARNESS_USED"

[ -s "$WORK_DIR/final.mdx" ] || die "final.mdx missing or empty"
STEP4_TIME=$(step_end "Step 4")

# Step 4.5 (agent notes insertion) — removed. All commentary now uses ClawdNote inline.

# Step 4.6: Patch pipeline credits into frontmatter
# Gemini writes single-model credit; we add the full multi-model pipeline array
PIPELINE_URL="https://github.com/chitienhsiehwork-ai/clawd-workspace/blob/master/scripts/shroom-feed-pipeline.sh"
FINAL_MDX="$WORK_DIR/final.mdx"
if [[ -f "$FINAL_MDX" ]]; then
  [ -n "$WRITE_MODEL" ] || WRITE_MODEL=$(model_display_name "gemini-3.1-pro-preview")
  [ -n "$WRITE_HARNESS" ] || WRITE_HARNESS=$(model_harness_name "gemini-3.1-pro-preview")
  [ -n "$REVIEW_MODEL" ] || REVIEW_MODEL=$(model_display_name "gpt-5.4")
  [ -n "$REVIEW_HARNESS" ] || REVIEW_HARNESS=$(model_harness_name "gpt-5.4")
  [ -n "$REFINE_MODEL" ] || REFINE_MODEL=$(model_display_name "gemini-3.1-pro-preview")
  [ -n "$REFINE_HARNESS" ] || REFINE_HARNESS=$(model_harness_name "gemini-3.1-pro-preview")
  # Patch top-level model to match actual writer (may differ from what LLM hardcoded in draft)
  sed -i '/^  model: ".*"$/c\  model: "'"$WRITE_MODEL"'"' "$FINAL_MDX"
  # Replace single harness line with full pipeline credits
  sed -i '/^  harness: ".*"$/c\  harness: "Gemini CLI + Codex CLI"\n  pipeline:\n    - role: "Written"\n      model: "'"$WRITE_MODEL"'"\n      harness: "'"$WRITE_HARNESS"'"\n    - role: "Reviewed"\n      model: "'"$REVIEW_MODEL"'"\n      harness: "'"$REVIEW_HARNESS"'"\n    - role: "Refined"\n      model: "'"$REFINE_MODEL"'"\n      harness: "'"$REFINE_HARNESS"'"\n    - role: "Orchestrated"\n      model: "Opus 4.6"\n      harness: "OpenClaw"\n  pipelineUrl: "'"$PIPELINE_URL"'"' "$FINAL_MDX"
fi

# Step 4.7: Ralph Quality Loop (score → rewrite → re-score, bar = 9/9/9)
RALPH_MAX_ATTEMPTS=3
step_start "Step 4.7: ralph quality loop"

# Extract title + generate filename early (scorer needs file in posts dir)
TITLE=$(awk '
  BEGIN { in_fm=0 }
  /^---[[:space:]]*$/ { if (in_fm==0) { in_fm=1; next } else { exit } }
  in_fm && /^title:[[:space:]]*/ {
    line=$0
    sub(/^title:[[:space:]]*/, "", line)
    gsub(/^"|"$/, "", line)
    print line
    exit
  }
' "$WORK_DIR/final.mdx" || true)

if [ -z "$TITLE" ]; then
  TITLE="${TICKET_PREFIX}-${SP_NUM}"
fi

DATE_STAMP=$(date +%Y%m%d)
AUTHOR_SLUG=$(sanitize_slug "$AUTHOR_HANDLE")
TITLE_SLUG=$(sanitize_slug "$TITLE")
FILENAME="${TICKET_PREFIX,,}-${SP_NUM}-${DATE_STAMP}-${AUTHOR_SLUG}-${TITLE_SLUG}.mdx"
EN_FILENAME="en-${FILENAME}"

# Place file in posts dir for scorer
cp "$WORK_DIR/final.mdx" "$POSTS_DIR/$FILENAME"

RALPH_ATTEMPT=0
RALPH_PASSED=false
SCORE_P=0; SCORE_C=0; SCORE_V=0

while [ "$RALPH_ATTEMPT" -lt "$RALPH_MAX_ATTEMPTS" ]; do
  RALPH_ATTEMPT=$((RALPH_ATTEMPT + 1))
  SCORE_FILE="$WORK_DIR/ralph-score-attempt-${RALPH_ATTEMPT}.json"
  log_info "  Ralph attempt $RALPH_ATTEMPT/$RALPH_MAX_ATTEMPTS — Scoring..."

  # Score via independent subagent
  if bash scripts/ralph-scorer.sh "$FILENAME" "$SCORE_FILE" \
      > "$WORK_DIR/ralph-scorer-stdout-${RALPH_ATTEMPT}.txt" \
      2> "$WORK_DIR/ralph-scorer-stderr-${RALPH_ATTEMPT}.txt"; then
    read_scores "$SCORE_FILE"
    log_info "  Scores: P=$SCORE_P C=$SCORE_C V=$SCORE_V"

    if [ "$SCORE_P" -ge 9 ] && [ "$SCORE_C" -ge 9 ] && [ "$SCORE_V" -ge 9 ]; then
      RALPH_PASSED=true
      log_ok "  ✅ Ralph PASS on attempt $RALPH_ATTEMPT"
      break
    fi
  else
    log_warn "  Scorer failed (attempt $RALPH_ATTEMPT). See $WORK_DIR/ralph-scorer-stderr-${RALPH_ATTEMPT}.txt"
    continue
  fi

  # Not passed — rewrite if we have attempts left
  if [ "$RALPH_ATTEMPT" -lt "$RALPH_MAX_ATTEMPTS" ]; then
    log_info "  Rewriting (writer reads reviewer feedback)..."

    if timeout 900 claude -p \
      --model claude-opus-4-6 \
      --permission-mode bypassPermissions \
      --max-turns 20 \
      "You are a rewriter for gu-log blog posts. Your job is to improve a post that failed quality review.

## References (read ALL before rewriting)
1. Read scripts/ralph-vibe-scoring-standard.md — THE scoring rubric with calibration examples
2. Read TRANSLATION_PROMPT.md — LHY persona and style rules
3. Read CONTRIBUTING.md — frontmatter schema, ClawdNote format
4. Read the reviewer's feedback: cat $SCORE_FILE

## Task
Rewrite src/content/posts/$FILENAME to fix EVERY issue the reviewer flagged.
Also create the English version at src/content/posts/$EN_FILENAME with lang: en and same ticketId.

## Rules
- Keep ALL existing frontmatter fields intact (ticketId, source, sourceUrl, title, summary, tags, lang, dates)
- Do NOT touch translatedBy — shell handles that automatically
- ALL notes must be ClawdNote (convert any CodexNote/GeminiNote/ClaudeCodeNote)
- Import ONLY ClawdNote from components (remove unused imports)
- Apply full LHY persona — professor teaching with life analogies, not news article
- ClawdNote density: ~1 per 25 lines of prose, each with personality and opinion
- No bullet-dump endings, no motivational closings, no 「各位觀眾好」openings
- Kaomoji: MANDATORY — pre-commit hook rejects posts without at least one kaomoji. Sprinkle naturally in prose, avoid markdown special chars (backticks, asterisks)" \
      > "$WORK_DIR/ralph-writer-stdout-${RALPH_ATTEMPT}.txt" 2>&1; then
      log_info "  Writer completed."
    else
      log_warn "  Writer errored. See $WORK_DIR/ralph-writer-stdout-${RALPH_ATTEMPT}.txt"
    fi

    # Build check
    log_info "  Running build check..."
    if ! pnpm run build > "$WORK_DIR/ralph-build-${RALPH_ATTEMPT}.txt" 2>&1; then
      log_warn "  ❌ Build failed after rewrite! Reverting..."
      git checkout -- "$POSTS_DIR/$FILENAME" 2>/dev/null || true
      # Restore from work dir copy
      cp "$WORK_DIR/final.mdx" "$POSTS_DIR/$FILENAME"
      rm -f "$POSTS_DIR/$EN_FILENAME"
      continue
    fi
    log_info "  Build passed."

    # Ensure kaomoji present
    node scripts/add-kaomoji.mjs --write "$FILENAME" 2>/dev/null || true
    [ -f "$POSTS_DIR/$EN_FILENAME" ] && node scripts/add-kaomoji.mjs --write "$EN_FILENAME" 2>/dev/null || true
  fi
done

# Append Ralph quality stages to existing SP pipeline signature
# (stamp_ralph_signature replaces the whole block — we want to ADD to it)
for _rf in "$POSTS_DIR/$FILENAME" "$POSTS_DIR/$EN_FILENAME"; do
  [ -f "$_rf" ] || continue
  # Append Scored + Rewritten + update Orchestrated, keep original Written/Reviewed/Refined
  python3 - "$_rf" "$RALPH_PASSED" "$SCORE_P" "$SCORE_C" "$SCORE_V" << 'PYEOF'
import sys, re
filepath, passed, sp, sc, sv = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
with open(filepath, 'r') as f:
    content = f.read()

ralph_stages = """    - role: "Scored"
      model: "Opus 4.6"
      harness: "Claude Code (ralph-scorer)"
    - role: "Rewritten"
      model: "Opus 4.6"
      harness: "Claude Code"
    - role: "Orchestrated"
      model: "Opus 4.6"
      harness: "OpenClaw + Ralph Loop"
  pipelineUrl: "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/sp-pipeline.sh\""""

# Replace existing Orchestrated + pipelineUrl with Ralph stages
content = re.sub(
    r'    - role: "Orchestrated"\n.*?harness:.*?\n  pipelineUrl:.*',
    ralph_stages, content, count=1, flags=re.DOTALL
)
# Update top-level harness to include Claude Code
content = re.sub(
    r'(  harness: "[^"]*)"',
    r'\1 + Claude Code"',
    content, count=1
)
# Deduplicate " + Claude Code + Claude Code"
content = content.replace(' + Claude Code + Claude Code', ' + Claude Code')

with open(filepath, 'w') as f:
    f.write(content)
PYEOF
done

STEP47_TIME=$(step_end "Step 4.7")

if [ "$RALPH_PASSED" = false ]; then
  log_warn "Ralph quality bar not met after $RALPH_MAX_ATTEMPTS attempts (P:$SCORE_P C:$SCORE_C V:$SCORE_V). Deploying best effort."
fi

# Step 5: Deploy
if [ "$DRY_RUN" = true ]; then
  log_warn "--dry-run enabled; skipping deploy step"
else
  step_start "Step 5: deploy"
  [ -d "$POSTS_DIR" ] || die "Missing posts directory: $POSTS_DIR"

  # File already in $POSTS_DIR/$FILENAME from Step 4.7

  COUNTER_BACKUP="$WORK_DIR/counter-before.json"
  cp "$COUNTER_FILE" "$COUNTER_BACKUP"

  TMP_COUNTER=$(mktemp)
  jq ".${TICKET_PREFIX}.next += 1" "$COUNTER_FILE" > "$TMP_COUNTER"
  mv "$TMP_COUNTER" "$COUNTER_FILE"

  set +e
  VALIDATION_OUTPUT=$(
    cd "$GU_LOG_DIR"
    node scripts/validate-posts.mjs 2>&1
  )
  VALIDATION_STATUS=$?
  set -e

  if [ "$VALIDATION_STATUS" -ne 0 ]; then
    if printf '%s\n' "$VALIDATION_OUTPUT" | grep -E -F "$FILENAME|$EN_FILENAME" >/dev/null 2>&1; then
      log_error "Validation failed for newly generated file(s)"
      rm -f "$POSTS_DIR/$FILENAME" "$POSTS_DIR/$EN_FILENAME"
      cp "$COUNTER_BACKUP" "$COUNTER_FILE"
      printf '%s\n' "$VALIDATION_OUTPUT" >&2
      exit 1
    fi
    log_warn "Validation reported issues not tied to $FILENAME; proceeding"
    printf '%s\n' "$VALIDATION_OUTPUT"
  fi

  GITIGNORE_FILE="$GU_LOG_DIR/.gitignore"
  if [ -f "$GITIGNORE_FILE" ]; then
    if ! grep -qx 'tmp/' "$GITIGNORE_FILE"; then
      printf '\ntmp/\n' >> "$GITIGNORE_FILE"
      log_info "Added tmp/ to .gitignore"
    fi
  else
    printf 'tmp/\n' > "$GITIGNORE_FILE"
    log_info "Created .gitignore with tmp/"
  fi

  (
    cd "$GU_LOG_DIR"
    npm run build
  )

  (
    cd "$GU_LOG_DIR"
    git add "src/content/posts/$FILENAME" "scripts/article-counter.json"
    [ -f "src/content/posts/$EN_FILENAME" ] && git add "src/content/posts/$EN_FILENAME"
    git commit -m "Add ${TICKET_PREFIX}-${SP_NUM}: ${TITLE}"
    git push
  )

  STEP5_TIME=$(step_end "Step 5")
fi

# Step 6: Report
TOTAL_TIME=$(( $(date +%s) - TOTAL_START ))
printf "\n"
log_info "Pipeline Summary"
printf "SP number   : %s\n" "$SP_NUM"
printf "Title       : %s\n" "${TITLE:-N/A}"
printf "Filename    : %s\n" "${FILENAME:-N/A (dry-run)}"
printf "Work dir    : %s\n" "$WORK_DIR"
printf "Step 0 time : %ss\n" "$STEP0_TIME"
printf "Step 1 time : %ss\n" "$STEP1_TIME"
printf "Step 1.5 time : %ss\n" "$STEP15_TIME"
printf "Step 2 time : %ss\n" "$STEP2_TIME"
printf "Step 3 time : %ss\n" "$STEP3_TIME"
printf "Step 4 time : %ss\n" "$STEP4_TIME"
printf "Step 4.5 time : %ss\n" "$STEP45_TIME"
printf "Step 4.7 time : %ss\n" "${STEP47_TIME:-0}"
printf "Ralph pass  : %s\n" "${RALPH_PASSED:-N/A}"
printf "Ralph scores: P:%s C:%s V:%s\n" "${SCORE_P:-?}" "${SCORE_C:-?}" "${SCORE_V:-?}"
printf "Step 5 time : %ss\n" "$STEP5_TIME"
printf "Total time  : %ss\n" "$TOTAL_TIME"
log_ok "Pipeline finished"
