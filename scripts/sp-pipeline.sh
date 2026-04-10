#!/usr/bin/env bash
set -euo pipefail

# Ensure local bin wrappers (e.g. codex shim) are found before system symlinks
export PATH="/home/clawd/.local/bin:$HOME/.local/bin:$PATH"

# === Pipeline Timeout ===
# Total wall-clock limit for the entire pipeline run.
# The full pipeline (eval → write → review → refine → 3x Ralph loop + builds)
# typically takes 30-40 min. Set to 50 min (3000s) for headroom.
# Override with: PIPELINE_TIMEOUT=3600 bash sp-pipeline.sh <url>
PIPELINE_TIMEOUT="${PIPELINE_TIMEOUT:-3000}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
log_ok() { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
log_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }

# Start timeout watchdog (now that log functions are defined)
(
  sleep "$PIPELINE_TIMEOUT"
  printf "${RED}[ERROR]${NC} Pipeline timeout (%ss) reached — killing pipeline\n" "$PIPELINE_TIMEOUT" >&2
  kill -TERM "$$" 2>/dev/null || true
) &
_TIMEOUT_PID=$!
trap 'kill $_TIMEOUT_PID 2>/dev/null || true' EXIT

model_display_name() {
  local model_id="$1"
  case "$model_id" in
    gemini-3.1-pro-preview) printf '%s' "Gemini 3.1 Pro" ;;
    gpt-5.4) printf '%s' "GPT-5.4" ;;
    gpt-5.3-codex) printf '%s' "GPT-5.3-Codex" ;;
    claude-opus) printf '%s' "Opus 4.6" ;;
    *) printf '%s' "$model_id" ;;
  esac
}

model_harness_name() {
  local model_id="$1"
  case "$model_id" in
    gemini-3.1-pro-preview) printf '%s' "Gemini CLI" ;;
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
    if claude -p --model opus --permission-mode bypassPermissions < "$prompt_file" > "$out_tmp" 2> "$err_tmp"; then
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

  # === Opus-first writing chain ===
  # Primary: Claude Opus (best writing quality)
  # Fallback: GPT-5.4 Codex
  # Gemini is excluded from article writing — only used for tribunal (AI judges)

  # 1. Try Claude Opus first
  if claude -p --model opus --permission-mode bypassPermissions < "$prompt_file" > "$out_tmp" 2> "$err_tmp"; then
    LAST_MODEL_USED=$(model_display_name "claude-opus")
    LAST_HARNESS_USED=$(model_harness_name "claude-opus")
    cat "$out_tmp"
    cat "$err_tmp" >&2
    rm -f "$out_tmp" "$err_tmp" "$prompt_file"
    return 0
  fi
  log_warn "Claude Opus failed, falling back to Codex CLI" >&2

  # 2. Fallback: GPT-5.4 Codex
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
  log_error "All models failed (Opus → Codex)" >&2
  cat "$err_tmp" >&2
  rm -f "$out_tmp" "$err_tmp" "$prompt_file"
  return 1
}

usage() {
  cat <<'USAGE'
Usage:
  bash sp-pipeline.sh <tweet_url> [--dry-run] [--force] [--from-step <step>] [--file <filename>]

Options:
  --dry-run           Run steps 0-4.5 and stop before deploy.
  --force             Skip evaluation step (Step 1.5).
  --opus              Use Claude Opus for ALL pipeline stages (write/review/refine).
  --bar <N>           Override Ralph quality bar (default: 8). All 3 dimensions must >= N.
  --from-step <step>  Resume from a specific step (skips earlier steps).
                      Steps: 0/setup, 1/fetch, 1.5/eval, 2/write, 3/review,
                             4/refine, 4.7/ralph, 5/deploy
  --file <filename>   Existing post filename in src/content/posts/ (required with
                      --from-step when skipping fetch/write steps).
  -h, --help          Show this help message.

Examples:
  # Run Ralph loop on existing article
  bash sp-pipeline.sh --from-step ralph --file cp-231-...-vibe-engineering.mdx

  # Re-run from review step
  bash sp-pipeline.sh --from-step review --file sp-138-...-hidden-features.mdx
USAGE
}

check_required_tools() {
  # NOTE(all-claude): bird, gemini, codex removed from critical path.
  # Dead code: old tools=(bird gemini codex jq node npm git)
  local tools=(jq node npm git curl python3)
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

extract_x_status_id() {
  local url="$1"
  printf '%s' "$url" | sed -nE 's#.*status(es)?/([0-9]+).*#\2#p' | head -n 1
}

validate_tweet_source_capture() {
  local source_file="$1"
  python3 - "$source_file" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="ignore")
lower = text.lower()
lines = [line.strip() for line in text.splitlines() if line.strip()]

if len(text.strip()) < 120 or len(lines) < 3:
    raise SystemExit(1)

bad_markers = [
    "tool=exec",
    "process exited with code",
    "wrote the evaluation to",
    "workspace check confirms",
    "file update:",
    "tokens used",
    "/bin/bash -lc",
    "succeeded in ",
    "fetch-agent-stderr.log",
    "eval-codex.json",
    "eval-gemini.json",
    "plan updated",
    "exact_fetch_failed",
]

if sum(marker in lower for marker in bad_markers) >= 2:
    raise SystemExit(1)

has_handle = bool(re.search(r'@[A-Za-z0-9_]+', text))
has_date = bool(re.search(r'\b\d{4}-\d{2}-\d{2}\b', text)) or ('📅' in text)
has_source_shape = (
    '=== main tweet ===' in lower
    or '=== tweet(s) ===' in lower
    or 'source url:' in lower
    or 'tweet url:' in lower
    or '📅' in text
)

if (has_handle and has_date) or (has_handle and has_source_shape):
    raise SystemExit(0)

raise SystemExit(1)
PY
}

fetch_x_api_fallback() {
  local tweet_url="$1"
  local out_file="$2"
  local helper_script="$GU_LOG_DIR/scripts/fetch-x-api-fallback.sh"
  local status_id=""

  [ -f "$helper_script" ] || return 1
  status_id="$(extract_x_status_id "$tweet_url")"
  [ -n "$status_id" ] || return 1

  if bash "$helper_script" "$tweet_url" > "$out_file"; then
    validate_tweet_source_capture "$out_file"
    return 0
  fi

  return 1
}

validate_article_source_capture() {
  local source_file="$1"
  python3 - "$source_file" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="ignore")
lines = [line.strip() for line in text.splitlines() if line.strip()]
lower = text.lower()

blocked_markers = [
    "enable javascript",
    "please enable javascript",
    "please verify you are human",
    "just a moment",
    "access denied",
    "too many requests",
    "rate limit",
    "captcha",
    "subscribe to continue",
    "sign in to continue",
    "already a subscriber",
]
code_markers = [
    "function",
    "const ",
    "let ",
    "var ",
    "import ",
    "export ",
    "window.",
    "document.",
    "=>",
    "__next",
    "webpack",
]

if len(text.strip()) < 200 or len(lines) < 5:
    raise SystemExit(1)

blocked_hits = sum(marker in lower for marker in blocked_markers)
if blocked_hits >= 2 and len(text) < 6000:
    raise SystemExit(1)

code_lines = sum(1 for line in lines if any(marker in line.lower() for marker in code_markers))
if code_lines / max(len(lines), 1) > 0.3:
    raise SystemExit(1)
PY
}

TWEET_URL=""
DRY_RUN=false
FORCE=false
TICKET_PREFIX="SP"
OPUS_MODE=true  # all-claude: Opus is default; Gemini/Codex fallback kept as dead code below
FROM_STEP=""
FROM_STEP_INT=0
EXISTING_FILE=""
RALPH_BAR=8

# Convert step name/number to sortable integer
step_to_int() {
  case "$1" in
    0|setup) echo 0 ;;
    1|fetch) echo 10 ;;
    1.5|eval) echo 15 ;;
    1.7|dedup) echo 17 ;;
    2|write) echo 20 ;;
    3|review) echo 30 ;;
    4|refine) echo 40 ;;
    4.7|ralph) echo 47 ;;
    5|deploy) echo 50 ;;
    *) die "Unknown step: $1. Valid: 0, 1, 1.5, 1.7, 2, 3, 4, 4.7, 5 (or: setup, fetch, eval, dedup, write, review, refine, ralph, deploy)" ;;
  esac
}

# Check if a step should run (based on --from-step)
should_run_step() {
  local step_int
  step_int=$(step_to_int "$1")
  [ "$step_int" -ge "$FROM_STEP_INT" ]
}

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
    --bar)
      shift
      RALPH_BAR="${1:-}"
      [[ "$RALPH_BAR" =~ ^[0-9]+$ ]] || die "--bar requires a number (e.g. --bar 9)"
      shift
      ;;
    --from-step)
      shift
      FROM_STEP="${1:-}"
      [ -n "$FROM_STEP" ] || die "--from-step requires a step name/number"
      FROM_STEP_INT=$(step_to_int "$FROM_STEP")
      shift
      ;;
    --file)
      shift
      EXISTING_FILE="${1:-}"
      [ -n "$EXISTING_FILE" ] || die "--file requires a filename"
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

# TWEET_URL is required unless --from-step is used (resuming from existing file)
if [ -z "$TWEET_URL" ] && [ -z "$FROM_STEP" ]; then
  usage
  exit 1
fi

# --from-step with late steps requires --file (unless PIPELINE_WORK_DIR is set)
if [ -n "$FROM_STEP" ] && [ "$FROM_STEP_INT" -ge 20 ] && [ -z "$EXISTING_FILE" ] && [ -z "${PIPELINE_WORK_DIR:-}" ]; then
  die "--from-step $FROM_STEP requires --file <filename> (existing article in posts dir)"
fi

GU_LOG_DIR="${GU_LOG_DIR:-$HOME/clawd/projects/gu-log}"
cd "$GU_LOG_DIR"
SCRIPT_DIR="$GU_LOG_DIR/scripts"
source scripts/ralph-helpers.sh
COUNTER_FILE="$GU_LOG_DIR/scripts/article-counter.json"
STYLE_GUIDE_FILE="$GU_LOG_DIR/WRITING_GUIDELINES.md"
POSTS_DIR="$GU_LOG_DIR/src/content/posts"
TOTAL_START=$(date +%s)
COUNTER_LOCK="/tmp/gu-log-counter.lock"

STEP0_TIME=0
STEP1_TIME=0
STEP15_TIME=0
STEP17_TIME=0
STEP2_TIME=0
STEP3_TIME=0
STEP4_TIME=0
STEP45_TIME=0
STEP47_TIME=0
STEP5_TIME=0

FILENAME=""
EN_FILENAME=""
ACTIVE_FILENAME=""
ACTIVE_EN_FILENAME=""
TITLE=""
SP_NUM=""
PROMPT_TICKET_ID="PENDING"
WORK_DIR=""
AUTHOR_HANDLE=""
ORIGINAL_DATE=""
WRITE_MODEL=""
WRITE_HARNESS=""
REVIEW_MODEL=""
REVIEW_HARNESS=""
REFINE_MODEL=""
REFINE_HARNESS=""
DATE_STAMP=""
AUTHOR_SLUG=""
TITLE_SLUG=""

allocate_ticket_number() {
  exec 200>"$COUNTER_LOCK"
  flock -w 60 200 || die "Could not acquire counter lock (another pipeline running?)"

  local next_num tmp_counter
  next_num=$(jq -r ".${TICKET_PREFIX}.next // empty" "$COUNTER_FILE")
  [ -n "$next_num" ] || {
    flock -u 200 || true
    exec 200>&-
    die "Could not read ${TICKET_PREFIX}.next from $COUNTER_FILE"
  }

  tmp_counter=$(mktemp)
  if ! jq ".${TICKET_PREFIX}.next += 1" "$COUNTER_FILE" > "$tmp_counter"; then
    rm -f "$tmp_counter"
    flock -u 200 || true
    exec 200>&-
    die "Failed to bump ${TICKET_PREFIX}.next in $COUNTER_FILE"
  fi
  mv "$tmp_counter" "$COUNTER_FILE"

  flock -u 200 || true
  exec 200>&-
  printf '%s' "$next_num"
}

replace_pending_ticket_id() {
  local file="$1"
  local ticket_id="$2"
  [ -f "$file" ] || return 0

  sed -i "s/ticketId: \"PENDING\"/ticketId: \"${ticket_id}\"/g" "$file"
  sed -i "s/ticketId: PENDING/ticketId: ${ticket_id}/g" "$file"
  sed -i "s/PENDING/${ticket_id}/g" "$file"
}

_cleanup_on_exit() {
  local exit_code=$?
  kill "$_TIMEOUT_PID" 2>/dev/null || true
  if [ "$exit_code" -ne 0 ]; then
    log_warn "Pipeline exiting with code $exit_code — cleaning up incomplete files..."
    for _f in "$POSTS_DIR/$FILENAME" "$POSTS_DIR/$EN_FILENAME" "$POSTS_DIR/$ACTIVE_FILENAME" "$POSTS_DIR/$ACTIVE_EN_FILENAME"; do
      if [ -f "$_f" ] && [ "$(grep -c '^---' "$_f")" -lt 2 ]; then
        log_warn "  Removing incomplete: $_f"
        rm -f "$_f"
      fi
    done
  fi
}

trap 'log_error "Pipeline failed at line $LINENO"' ERR
trap _cleanup_on_exit EXIT

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

# When --file is given, extract metadata from existing file instead of allocating new counter
if [ -n "$EXISTING_FILE" ]; then
  [ -f "$POSTS_DIR/$EXISTING_FILE" ] || die "File not found: $POSTS_DIR/$EXISTING_FILE"

  # Extract ticket prefix and number from frontmatter
  TICKET_ID_FROM_FILE=$(grep -m1 'ticketId' "$POSTS_DIR/$EXISTING_FILE" | sed -E 's/.*ticketId:[[:space:]]*"?([^"]+)"?.*/\1/' | tr -d '[:space:]')
  TICKET_PREFIX=$(echo "$TICKET_ID_FROM_FILE" | sed -E 's/-[0-9]+$//')
  SP_NUM=$(echo "$TICKET_ID_FROM_FILE" | grep -oE '[0-9]+$')

  # Extract other metadata from frontmatter
  AUTHOR_HANDLE=$(grep -m1 'source:' "$POSTS_DIR/$EXISTING_FILE" | sed -E 's/.*@([A-Za-z0-9_]+).*/\1/' || true)
  ORIGINAL_DATE=$(grep -m1 'originalDate:' "$POSTS_DIR/$EXISTING_FILE" | sed -E 's/.*originalDate:[[:space:]]*"?([0-9-]+)"?.*/\1/' || true)
  TWEET_URL=$(grep -m1 'sourceUrl:' "$POSTS_DIR/$EXISTING_FILE" | sed -E 's/.*sourceUrl:[[:space:]]*"?([^"]+)"?.*/\1/' | tr -d '[:space:]' || true)

  [ -n "$SP_NUM" ] || die "Could not extract ticket number from $EXISTING_FILE"
  [ -n "$AUTHOR_HANDLE" ] || AUTHOR_HANDLE="Unknown"
  [ -n "$ORIGINAL_DATE" ] || ORIGINAL_DATE=$(date +%F)

  FILENAME="$EXISTING_FILE"
  EN_FILENAME="en-${FILENAME}"
  ACTIVE_FILENAME="$FILENAME"
  ACTIVE_EN_FILENAME="$EN_FILENAME"
  PROMPT_TICKET_ID="${TICKET_PREFIX}-${SP_NUM}"
  log_info "Resuming with existing file: $EXISTING_FILE (${TICKET_PREFIX}-${SP_NUM})"
else
  log_info "Deferring counter allocation until Step 5 commit"
fi

if [ -n "$EXISTING_FILE" ]; then
  WORK_DIR="$GU_LOG_DIR/tmp/${TICKET_PREFIX,,}-${SP_NUM}-pipeline"
elif [ -n "${PIPELINE_WORK_DIR:-}" ]; then
  WORK_DIR="$PIPELINE_WORK_DIR"
else
  WORK_DIR="$GU_LOG_DIR/tmp/${TICKET_PREFIX,,}-pending-$(date +%s)-pipeline"
fi
mkdir -p "$WORK_DIR"
STEP0_TIME=$(step_end "Step 0")

# Step 1: Fetch content
if ! should_run_step 1; then
  log_info "Step 1: fetch content — SKIPPED (--from-step $FROM_STEP)"
  # Extract author/date from pre-populated source-tweet.md when skipping fetch
  if [ -f "$WORK_DIR/source-tweet.md" ] && [ -s "$WORK_DIR/source-tweet.md" ]; then
    AUTHOR_HANDLE=$(grep -Eo '@[A-Za-z0-9_]+' "$WORK_DIR/source-tweet.md" | head -1 | sed 's/^@//' || true)
    [ -n "$AUTHOR_HANDLE" ] || AUTHOR_HANDLE=$(printf '%s' "$TWEET_URL" | grep -oP '(?<=x\.com/)[^/?]+' || true)
    ORIGINAL_DATE=$(extract_tweet_date "$WORK_DIR/source-tweet.md" || true)
    [ -n "$ORIGINAL_DATE" ] || ORIGINAL_DATE=$(TZ=Asia/Taipei date +%F)
    log_info "  Extracted from existing source: author=$AUTHOR_HANDLE date=$ORIGINAL_DATE"
  fi
else
step_start "Step 1: fetch content"
# --- Smart skip: if source-tweet.md exists, ask Claude whether to re-fetch ---
if [ -f "$WORK_DIR/source-tweet.md" ] && [ -s "$WORK_DIR/source-tweet.md" ]; then
  EXISTING_LINES=$(wc -l < "$WORK_DIR/source-tweet.md")
  log_info "source-tweet.md exists ($EXISTING_LINES lines) — asking Claude whether to re-fetch"

  # PIPELINE_SOURCE_KEEP=1 bypasses the Claude check (for pre-injected content)
  if [ -n "${PIPELINE_SOURCE_KEEP:-}" ]; then
    SKIP_DECISION="KEEP"
    log_info "  PIPELINE_SOURCE_KEEP set — forcing KEEP"
  else
  SKIP_DECISION=$(claude -p --bare "You are a pipeline assistant. A source file already exists for this tweet URL:
URL: $TWEET_URL
File: $EXISTING_LINES lines

First 10 lines:
$(head -10 "$WORK_DIR/source-tweet.md")

Last 10 lines:
$(tail -10 "$WORK_DIR/source-tweet.md")

Does this file look like a complete, usable source capture? Consider:
- Does it contain actual tweet content (not just errors/empty)?
- If the tweet mentions a thread or numbered list, does the file seem to contain all parts?
- Are there author handles, dates, and tweet text present?

Reply with ONLY one word: KEEP or REFETCH" 2>/dev/null || echo "REFETCH")
  fi  # end PIPELINE_SOURCE_KEEP check

  # Strip whitespace, take first word
  SKIP_DECISION=$(echo "$SKIP_DECISION" | tr -d '[:space:]' | head -c 10)

  if [[ "$SKIP_DECISION" == "KEEP" ]]; then
    log_info "Claude says KEEP — using existing source-tweet.md"
    AUTHOR_HANDLE=$(grep -Eo '@[A-Za-z0-9_]+' "$WORK_DIR/source-tweet.md" | head -n 1 | sed 's/^@//' || true)
    [ -n "$AUTHOR_HANDLE" ] || AUTHOR_HANDLE=$(printf '%s' "$TWEET_URL" | grep -oP '(?<=x\.com/)[^/?]+' || true)
    [ -n "$AUTHOR_HANDLE" ] || die "Failed to extract author handle from source-tweet.md"
    ORIGINAL_DATE=$(extract_tweet_date "$WORK_DIR/source-tweet.md" || true)
    [ -n "$ORIGINAL_DATE" ] || ORIGINAL_DATE=$(date +%F)
  else
    log_info "Claude says REFETCH (or unavailable) — proceeding with fresh fetch"
    rm -f "$WORK_DIR/source-tweet.md"
  fi
fi

if [ ! -f "$WORK_DIR/source-tweet.md" ] && { [[ "$TWEET_URL" == *"twitter.com"* ]] || [[ "$TWEET_URL" == *"x.com"* ]]; }; then
  # --- Agentic fetch via gemini-safe-search.sh (Podman sandbox + bird) ---
  # Gemini handles the judgment calls (is this a thread? how to chase it?)
  # while bird provides the raw tweet data. Runs inside Podman sandbox so
  # prompt injection from tweets can't touch the host filesystem.
  # Replaces the fragile bash loop that failed on high-engagement threads.
  log_info "Agentic fetch: Gemini sandbox + bird (Flash)"

  SAFE_SEARCH="${GU_LOG_DIR}/scripts/../../../scripts/gemini-safe-search.sh"
  # Resolve to absolute path; fall back to well-known location
  if [ ! -x "$SAFE_SEARCH" ]; then
    SAFE_SEARCH="$HOME/clawd/scripts/gemini-safe-search.sh"
  fi
  [ -x "$SAFE_SEARCH" ] || die "gemini-safe-search.sh not found"

  FETCH_PROMPT="GOAL: Collect ALL source material a blog writer would need to write a comprehensive
article about this tweet. The writer will ONLY see what you output — if you miss content,
the article will be shallow or padded with filler.

You have these tools:
- bird read <url> — fetch a single tweet (text, author, date, URL, stats)
- bird replies <url> — fetch replies to a tweet
- Google Search — search the web for additional context

Steps:
1. Run bird read $TWEET_URL to get the initial tweet.
2. Check if it's a THREAD (numbered like '1/', '(1/N)', or author promising more).
   If thread: use bird replies to chase the SAME AUTHOR's continuation tweets.
   bird read each found URL. Chase up to 30 tweets. Skip other users' replies.
   If bird replies buries the author's next tweet, check a few more results.
3. Check if the tweet contains EXTERNAL LINKS (blog posts, articles, GitHub repos, etc.).
   If yes: use Google Search to find and read the linked content. Include the FULL text
   of linked articles — these are often the real substance behind a teaser tweet.
   For t.co shortened URLs, search for the author name + keywords from the tweet to find
   the destination article.
4. If the tweet references another person's tweet or a specific resource, fetch that too.

Output format:
=== TWEET(S) ===
[Each tweet's full bird read output, separated by ---]
[Chronological order, thread author only]

=== LINKED CONTENT ===
[For each external link found in the tweet:]
Source URL: <url>
<Full article text / content>
---

If there are no external links, omit the LINKED CONTENT section.
If there is no thread (single tweet), just output that one tweet.

REMEMBER: The writer depends entirely on your output. Missing content = bad article."

  if FETCH_OUTPUT=$("$SAFE_SEARCH" -m gemini-2.5-flash -t 300 "$FETCH_PROMPT" 2>"$WORK_DIR/fetch-agent-stderr.log"); then
    echo "$FETCH_OUTPUT" > "$WORK_DIR/source-tweet.md"
  else
    log_warn "Gemini agentic fetch failed (exit $?) — falling back to basic bird read"
    if ! bird read "$TWEET_URL" > "$WORK_DIR/source-tweet.md"; then
      die "bird read failed for URL: $TWEET_URL"
    fi
  fi

  # Validate output exists and has content
  if [ ! -s "$WORK_DIR/source-tweet.md" ]; then
    log_warn "Gemini produced empty output — falling back to basic bird read"
    if ! bird read "$TWEET_URL" > "$WORK_DIR/source-tweet.md"; then
      die "bird read failed for URL: $TWEET_URL"
    fi
  fi

  SOURCE_CAPTURE_VALID=true
  if ! validate_tweet_source_capture "$WORK_DIR/source-tweet.md"; then
    SOURCE_CAPTURE_VALID=false
    log_warn "Primary fetch output looks incomplete or contaminated"
  fi

  # Detect bird auth failure or contaminated fallback output.
  # If the sandbox cannot produce a clean capture, use a deterministic X API fallback
  # before trying any LLM/web-search paraphrase path.
  if [ "$SOURCE_CAPTURE_VALID" = false ] || ! grep -qE '@[A-Za-z0-9_]+' "$WORK_DIR/source-tweet.md"; then
    log_warn "Primary fetch missing reliable tweet metadata/content. Trying deterministic X API fallback"
    if fetch_x_api_fallback "$TWEET_URL" "$WORK_DIR/source-tweet.md"; then
      log_ok "Deterministic X API fallback succeeded"
      SOURCE_CAPTURE_VALID=true
    else
      log_warn "Deterministic X API fallback failed — trying strict web-search fallback"
      WEB_ONLY_PROMPT="Search the web for this tweet and return the ORIGINAL tweet text verbatim.
Do NOT paraphrase, summarize, or add commentary.
If you cannot verify the exact tweet text, output EXACT_FETCH_FAILED.

You MUST include:
- The author's @handle (e.g. @PawelHuryn)
- The tweet date (YYYY-MM-DD format)
- The exact tweet text, verbatim

Tweet URL: $TWEET_URL

Output in this exact format:
@<handle> — <YYYY-MM-DD>
<exact tweet text>"
      if WEB_FETCH_OUT=$("$SAFE_SEARCH" -m gemini-2.5-flash -t 120 "$WEB_ONLY_PROMPT" 2>/dev/null) && [ -n "$WEB_FETCH_OUT" ]; then
        echo "$WEB_FETCH_OUT" > "$WORK_DIR/source-tweet.md"
        if validate_tweet_source_capture "$WORK_DIR/source-tweet.md"; then
          log_ok "Strict web-search fallback fetch succeeded"
          SOURCE_CAPTURE_VALID=true
        else
          SOURCE_CAPTURE_VALID=false
          log_warn "Strict web-search fallback produced unusable capture"
        fi
      else
        SOURCE_CAPTURE_VALID=false
        log_warn "Strict web-search fallback failed"
      fi
    fi
  fi

  if [ "$SOURCE_CAPTURE_VALID" != true ]; then
    die "Tweet fetch produced unusable or contaminated source after all fallbacks"
  fi

  TWEETS_COLLECTED=$(grep -c '^---$' "$WORK_DIR/source-tweet.md" || true)
  [ -n "$TWEETS_COLLECTED" ] || TWEETS_COLLECTED=0
  TWEETS_COLLECTED=$((TWEETS_COLLECTED + 1))  # separators = tweets - 1
  log_ok "Agentic fetch complete: $TWEETS_COLLECTED tweet(s) collected"

  AUTHOR_HANDLE=$(grep -Eo '@[A-Za-z0-9_]+' "$WORK_DIR/source-tweet.md" | head -n 1 | sed 's/^@//' || true)
  # Fallback: extract handle from tweet URL (covers envs where bird isn't auth'd)
  [ -n "$AUTHOR_HANDLE" ] || AUTHOR_HANDLE=$(printf '%s' "$TWEET_URL" | grep -oP '(?<=x\.com/)[^/?]+' || true)
  [ -n "$AUTHOR_HANDLE" ] || die "Failed to extract author handle from source"

  ORIGINAL_DATE=$(extract_tweet_date "$WORK_DIR/source-tweet.md" || true)
  # Fallback: use today's date if bird isn't auth'd and Gemini output lacks date
  [ -n "$ORIGINAL_DATE" ] || ORIGINAL_DATE=$(TZ=Asia/Taipei date +%F)
  [ -n "$ORIGINAL_DATE" ] || die "Failed to extract tweet date from source"
elif [ ! -f "$WORK_DIR/source-tweet.md" ]; then
  log_info "Non-twitter URL detected. Fetching via readability parser..."
  
  # Use readability-lxml to extract clean article text (handles React SSR, SPAs, etc.)
  # Falls back to BS4 tag stripping if readability fails.
  # Old approach (curl | sed) produced JavaScript garbage on React SSR pages.
  FETCH_SCRIPT="$GU_LOG_DIR/scripts/fetch-article.py"
  if [ -x "$FETCH_SCRIPT" ] || [ -f "$FETCH_SCRIPT" ]; then
    if ! python3 "$FETCH_SCRIPT" "$TWEET_URL" "$WORK_DIR/source-tweet.md" 2>"$WORK_DIR/fetch-stderr.log"; then
      log_warn "fetch-article.py failed: $(cat "$WORK_DIR/fetch-stderr.log")"
      log_warn "Falling back to curl + sed (may produce garbage on SPAs)"
      curl -fsSL "$TWEET_URL" | sed -e 's/<style[^>]*>.*<\/style>//ig' -e 's/<script[^>]*>.*<\/script>//ig' -e 's/<[^>]*>//g' | tr -s ' \t\r\n' '\n' > "$WORK_DIR/source-tweet.md"
    fi
  else
    log_warn "fetch-article.py not found, falling back to curl + sed"
    curl -fsSL "$TWEET_URL" | sed -e 's/<style[^>]*>.*<\/style>//ig' -e 's/<script[^>]*>.*<\/script>//ig' -e 's/<[^>]*>//g' | tr -s ' \t\r\n' '\n' > "$WORK_DIR/source-tweet.md"
  fi
  
  # Validate we got real content, not a paywall / JS shell / boilerplate blob
  if ! validate_article_source_capture "$WORK_DIR/source-tweet.md"; then
    die "Fetch produced unreadable or blocked output for URL: $TWEET_URL"
  fi
  SOURCE_LINES=$(wc -l < "$WORK_DIR/source-tweet.md")
  
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
fi  # end should_run_step 1

# Step 1.5: Evaluate worthiness
if ! should_run_step 1.5; then
  log_info "Step 1.5: evaluate worthiness — SKIPPED (--from-step $FROM_STEP)"
elif [ "$FORCE" = true ]; then
  log_warn "--force enabled; skipping Step 1.5 evaluation"
else
  step_start "Step 1.5: evaluate worthiness"
  TWEET_LINE_COUNT=$(wc -l < "$WORK_DIR/source-tweet.md")
  cat > "$WORK_DIR/eval-gemini-prompt.txt" <<EOF_EVAL_GEMINI
Evaluate whether this tweet/thread is worth translating into a gu-log article.

IMPORTANT: The source below may be a multi-tweet thread (separated by ---).
Evaluate the ENTIRE content holistically, not just the first tweet.
A thread with multiple substantial tweets IS enough content for an article.

Checklist:
1. Is the TOTAL content substantial enough for a gu-log article (not just a one-liner/hot take)?
2. Is it relevant to gu-log audience topics (AI, tech, developer, indie hacker)?
3. Does it have enough depth to expand into a full article?

Source content (${TWEET_LINE_COUNT} lines):
$(cat "$WORK_DIR/source-tweet.md")

Output requirements:
- Write JSON only (no markdown) to eval-gemini.json in current directory.
- Exact schema:
  {"verdict":"GO"|"SKIP","reason":"...","suggested_title":"..."}
EOF_EVAL_GEMINI

  cat > "$WORK_DIR/eval-codex-prompt.txt" <<EOF_EVAL_CODEX
Evaluate whether this tweet/thread is worth translating into a gu-log article.

IMPORTANT: The source below may be a multi-tweet thread (separated by ---).
Evaluate the ENTIRE content holistically, not just the first tweet.
A thread with multiple substantial tweets IS enough content for an article.

Checklist:
1. Is the TOTAL content substantial enough for a gu-log article (not just a one-liner/hot take)?
2. Is it relevant to gu-log audience topics (AI, tech, developer, indie hacker)?
3. Does it have enough depth to expand into a full article?

Source content (${TWEET_LINE_COUNT} lines):
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

  # Sanitize eval-codex.json: Codex sometimes appends garbage lines after the JSON object.
  # Extract only the first valid JSON line to prevent jq parse failures.
  if [ -s "$WORK_DIR/eval-codex.json" ]; then
    python3 - <<'PYEOF' "$WORK_DIR/eval-codex.json"
import json, sys, pathlib
f = pathlib.Path(sys.argv[1])
for line in f.read_text().splitlines():
    line = line.strip()
    if line.startswith('{'):
        try:
            obj = json.loads(line)
            f.write_text(json.dumps(obj) + '\n')
            sys.exit(0)
        except json.JSONDecodeError:
            continue
# No valid JSON found — leave file as-is, let downstream die() handle it
PYEOF
  fi

  # Fallback: if Codex failed (quota exhausted etc.), try Opus for eval
  if [ "$CODEX_EVAL_STATUS" -ne 0 ] || [ ! -s "$WORK_DIR/eval-codex.json" ]; then
    log_warn "Codex eval failed (status=$CODEX_EVAL_STATUS), falling back to Claude Opus"
    (
      cd "$WORK_DIR"
      claude -p --model opus --permission-mode bypassPermissions "$(cat eval-codex-prompt.txt)"
    )
    CODEX_EVAL_STATUS=$?
  fi
  set -e

  [ -s "$WORK_DIR/eval-gemini.json" ] || die "eval-gemini.json missing or empty"
  [ -s "$WORK_DIR/eval-codex.json" ] || die "eval-codex.json missing or empty"
  [ "$GEMINI_EVAL_STATUS" -eq 0 ] || die "Gemini evaluation command failed"
  [ "$CODEX_EVAL_STATUS" -eq 0 ] || die "Codex evaluation command (incl. fallback) failed"

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

# Step 1.7: Dedup Gate — block if URL or topic already covered
if should_run_step 1 && [ -n "$TWEET_URL" ]; then
  # Extract suggested title from eval JSON if available
  DEDUP_TITLE=""
  if [ -f "$WORK_DIR/eval-gemini.json" ]; then
    DEDUP_TITLE=$(jq -r '.suggested_title // empty' "$WORK_DIR/eval-gemini.json" 2>/dev/null || true)
  fi
  [ -n "$DEDUP_TITLE" ] || DEDUP_TITLE="${PROMPT_TICKET_ID}"

  step_start "Step 1.7: dedup gate"
  log_info "Running dedup gate..."
  DEDUP_RESULT=$(node "$SCRIPT_DIR/dedup-gate.mjs" \
    --url "$TWEET_URL" \
    --title "$DEDUP_TITLE" \
    --series SP 2>&1) || true

  if echo "$DEDUP_RESULT" | grep -q "^BLOCK"; then
    log_error "Dedup gate blocked: $DEDUP_RESULT"
    exit 1
  fi

  if echo "$DEDUP_RESULT" | grep -q "^WARN"; then
    log_warn "Dedup warning: $DEDUP_RESULT"
    # Continue but log the warning
  fi

  log_info "Dedup gate: $DEDUP_RESULT"
  STEP17_TIME=$(step_end "Step 1.7")
fi

# Step 2: Write Draft (Opus primary)
if ! should_run_step 2; then
  log_info "Step 2: write draft — SKIPPED (--from-step $FROM_STEP)"
  # When skipping write, the existing file IS the draft
  if [ -n "$EXISTING_FILE" ] && [ ! -f "$WORK_DIR/draft-v1.mdx" ]; then
    cp "$POSTS_DIR/$EXISTING_FILE" "$WORK_DIR/draft-v1.mdx"
    log_info "  Copied existing file as draft-v1.mdx"
  fi
else
step_start "Step 2: write draft (Opus primary)"
cat > "$WORK_DIR/gemini-write-prompt.txt" <<EOF_WRITE
You are writing a gu-log SP article draft in Traditional Chinese.

GOAL: Write a comprehensive, substantive article that covers ALL the ideas and details
in the source material. The reader should walk away understanding everything the original
author shared — not just a surface-level summary.

Task:
- Write ${PROMPT_TICKET_ID} article from the source material below.
- The source may contain TWEETS + LINKED CONTENT (blog posts, articles). Cover ALL of it.
- If the source includes a "=== LINKED CONTENT ===" section, that is the primary substance.
  The tweet is just the teaser — the linked article is where the real content lives.
  Your article MUST cover the linked content in depth, not just mention it exists.
- The source may contain a FULL THREAD (multiple tweets separated by ---). Cover ALL tweets, not just the first one.
- If you see "⚠️ INCOMPLETE THREAD", acknowledge what's missing and note it for the reader. Do NOT pad partial content into a full article.
- NEVER pad or filler. If a section says "there are other patterns" but you don't have the details, either skip that claim or explicitly say the details weren't available. Do NOT write vague paragraphs that say nothing.
- Follow the style guide exactly.
- Use this metadata:
  - ticketId: ${PROMPT_TICKET_ID}
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
fi  # end should_run_step 2

# Step 3: Codex Review
if ! should_run_step 3; then
  log_info "Step 3: codex review — SKIPPED (--from-step $FROM_STEP)"
else
step_start "Step 3: codex review"
cat > "$WORK_DIR/review-prompt.txt" <<EOF_REVIEW
Review draft-v1.mdx for ${PROMPT_TICKET_ID}.

Checklist:
1. Fact-check: no hallucinated claims beyond source context.
2. Style alignment: matches WRITING_GUIDELINES.md requirements.
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
  CODEX_REVIEW_STATUS=$?
  REVIEW_MODEL=$(model_display_name "gpt-5.4")
  REVIEW_HARNESS=$(model_harness_name "gpt-5.4")

  # Fallback: if Codex review failed (quota exhausted etc.), try Opus
  if [ "$CODEX_REVIEW_STATUS" -ne 0 ] || [ ! -s "$WORK_DIR/review.md" ]; then
    log_warn "Codex review failed (status=$CODEX_REVIEW_STATUS), falling back to Claude Opus"
    (
      cd "$WORK_DIR"
      claude -p --model opus --permission-mode bypassPermissions "$(cat review-prompt.txt)"
    )
    REVIEW_MODEL=$(model_display_name "claude-opus")
    REVIEW_HARNESS=$(model_harness_name "claude-opus")
  fi
fi

[ -s "$WORK_DIR/review.md" ] || die "review.md missing or empty"
STEP3_TIME=$(step_end "Step 3")
fi  # end should_run_step 3

# Step 4: Refine (Opus primary)
if ! should_run_step 4; then
  log_info "Step 4: refine draft — SKIPPED (--from-step $FROM_STEP)"
  # When skipping refine, use existing file (or draft) as final.mdx
  if [ ! -f "$WORK_DIR/final.mdx" ]; then
    if [ -n "$EXISTING_FILE" ] && [ -f "$POSTS_DIR/$EXISTING_FILE" ]; then
      cp "$POSTS_DIR/$EXISTING_FILE" "$WORK_DIR/final.mdx"
    elif [ -f "$WORK_DIR/draft-v1.mdx" ]; then
      cp "$WORK_DIR/draft-v1.mdx" "$WORK_DIR/final.mdx"
    fi
    log_info "  Using existing content as final.mdx"
  fi
else
step_start "Step 4: refine draft (Opus primary)"
cat > "$WORK_DIR/refine-prompt.txt" <<EOF_REFINE
Refine the ${PROMPT_TICKET_ID} draft using review feedback.

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
fi  # end should_run_step 4

# Step 4.5 (agent notes insertion) — removed. All commentary now uses ClawdNote inline.

# Step 4.6: Patch pipeline credits into frontmatter (only if refine ran)
if ! should_run_step 4 || [ -n "$EXISTING_FILE" ] && [ "$FROM_STEP_INT" -ge 47 ]; then
  log_info "Step 4.6: pipeline credits — SKIPPED (using existing credits)"
fi
if should_run_step 4 && { [ -z "$EXISTING_FILE" ] || [ "$FROM_STEP_INT" -lt 47 ]; }; then
# Step 4.6: Patch pipeline credits into frontmatter
# Gemini writes single-model credit; we add the full multi-model pipeline array
PIPELINE_URL="https://github.com/chitienhsiehwork-ai/clawd-workspace/blob/master/scripts/shroom-feed-pipeline.sh"
FINAL_MDX="$WORK_DIR/final.mdx"
if [[ -f "$FINAL_MDX" ]]; then
  [ -n "$WRITE_MODEL" ] || WRITE_MODEL=$(model_display_name "claude-opus")
  [ -n "$WRITE_HARNESS" ] || WRITE_HARNESS=$(model_harness_name "claude-opus")
  [ -n "$REVIEW_MODEL" ] || REVIEW_MODEL=$(model_display_name "gpt-5.4")
  [ -n "$REVIEW_HARNESS" ] || REVIEW_HARNESS=$(model_harness_name "gpt-5.4")
  [ -n "$REFINE_MODEL" ] || REFINE_MODEL=$(model_display_name "claude-opus")
  [ -n "$REFINE_HARNESS" ] || REFINE_HARNESS=$(model_harness_name "claude-opus")
  # Patch top-level model to match actual writer (may differ from what LLM hardcoded in draft)
  sed -i '/^  model: ".*"$/c\  model: "'"$WRITE_MODEL"'"' "$FINAL_MDX"
  # Replace single harness line with full pipeline credits
  sed -i '/^  harness: ".*"$/c\  harness: "Gemini CLI + Codex CLI"\n  pipeline:\n    - role: "Written"\n      model: "'"$WRITE_MODEL"'"\n      harness: "'"$WRITE_HARNESS"'"\n    - role: "Reviewed"\n      model: "'"$REVIEW_MODEL"'"\n      harness: "'"$REVIEW_HARNESS"'"\n    - role: "Refined"\n      model: "'"$REFINE_MODEL"'"\n      harness: "'"$REFINE_HARNESS"'"\n    - role: "Orchestrated"\n      model: "Opus 4.6"\n      harness: "OpenClaw"\n  pipelineUrl: "'"$PIPELINE_URL"'"' "$FINAL_MDX"
fi
fi  # end should_run_step 4 (4.6 credits)

# Step 4.7: Ralph Quality Loop (score → rewrite → re-score, bar = $RALPH_BAR/$RALPH_BAR/$RALPH_BAR)
RALPH_MAX_ATTEMPTS=3
step_start "Step 4.7: ralph quality loop"

# Extract title first; new articles use a staging filename until Step 5 assigns the real ticket.
_TITLE_SOURCE=""
if [ -n "$EXISTING_FILE" ] && [ -f "$POSTS_DIR/$FILENAME" ]; then
  _TITLE_SOURCE="$POSTS_DIR/$FILENAME"
elif [ -f "$WORK_DIR/final.mdx" ]; then
  _TITLE_SOURCE="$WORK_DIR/final.mdx"
fi

TITLE=""
if [ -n "$_TITLE_SOURCE" ]; then
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
  ' "$_TITLE_SOURCE" || true)
fi

if [ -z "$TITLE" ]; then
  TITLE="$PROMPT_TICKET_ID"
fi

DATE_STAMP=$(date +%Y%m%d)
AUTHOR_SLUG=$(sanitize_slug "$AUTHOR_HANDLE")
TITLE_SLUG=$(sanitize_slug "$TITLE")

if [ -n "$EXISTING_FILE" ]; then
  ACTIVE_FILENAME="$FILENAME"
  ACTIVE_EN_FILENAME="$EN_FILENAME"
else
  ACTIVE_FILENAME="${TICKET_PREFIX,,}-pending-${DATE_STAMP}-${AUTHOR_SLUG}-${TITLE_SLUG}.mdx"
  ACTIVE_EN_FILENAME="en-${ACTIVE_FILENAME}"
fi

# Place file in posts dir for scorer (skip if already there from --file)
if [ -n "$EXISTING_FILE" ] && [ -f "$POSTS_DIR/$ACTIVE_FILENAME" ]; then
  log_info "  File already in posts dir: $ACTIVE_FILENAME"
elif [ -f "$WORK_DIR/final.mdx" ]; then
  cp "$WORK_DIR/final.mdx" "$POSTS_DIR/$ACTIVE_FILENAME"
fi

RALPH_PASSED=false
SCORE_P=0; SCORE_C=0; SCORE_V=0  # kept for pipeline signature compat below

# ── 4-stage all-Claude tribunal (replaces old inline ralph scorer loop) ──────
log_info "  Running 4-stage tribunal (ralph-all-claude.sh)..."
if bash "$GU_LOG_DIR/scripts/ralph-all-claude.sh" "$ACTIVE_FILENAME" \
    >> "$WORK_DIR/tribunal-stdout.txt" 2>&1; then
  RALPH_PASSED=true
  log_ok "  Tribunal PASS: $ACTIVE_FILENAME"
else
  log_warn "  Tribunal FAIL (see $WORK_DIR/tribunal-stdout.txt). Deploying best effort."
fi

# Append Ralph quality stages to existing SP pipeline signature
# (stamp_ralph_signature replaces the whole block — we want to ADD to it)
for _rf in "$POSTS_DIR/$ACTIVE_FILENAME" "$POSTS_DIR/$ACTIVE_EN_FILENAME"; do
  [ -f "$_rf" ] || continue
  # Normalize Ralph stages deterministically so reruns stay idempotent.
  python3 - "$_rf" << 'PYEOF'
import re
import sys
from pathlib import Path

filepath = Path(sys.argv[1])
content = filepath.read_text()

match = re.match(r'^---\n([\s\S]*?)\n---\n([\s\S]*)$', content)
if not match:
    raise SystemExit(0)

fm, body = match.group(1), match.group(2)

# Remove any existing translatedBy pipeline block and pipelineUrl line.
fm = re.sub(r'(?ms)^  pipeline:\n(?:    - role:.*\n      model:.*\n      harness:.*\n)+', '', fm)
fm = re.sub(r'(?m)^  pipelineUrl: ".*\n?', '', fm)

# Normalize top-level harness once.
fm = re.sub(
    r'(?m)^  harness: ".*"$',
    '  harness: "Gemini CLI + Codex CLI + Claude Code"',
    fm,
    count=1,
)

pipeline_block = '''  pipeline:
    - role: "Written"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Reviewed"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Refined"
      model: "Opus 4.6"
      harness: "Claude Code CLI"
    - role: "Scored"
      model: "Opus 4.6"
      harness: "Claude Code (vibe-opus-scorer)"
    - role: "Rewritten"
      model: "Opus 4.6"
      harness: "Claude Code"
    - role: "Orchestrated"
      model: "Opus 4.6"
      harness: "OpenClaw + Ralph Loop"
  pipelineUrl: "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/sp-pipeline.sh"'''

fm = re.sub(
    r'(?m)^  harness: ".*"$',
    lambda m: m.group(0) + '\n' + pipeline_block,
    fm,
    count=1,
)

filepath.write_text(f"---\n{fm}\n---\n{body}")
PYEOF
done

STEP47_TIME=$(step_end "Step 4.7")

if [ "$RALPH_PASSED" = false ]; then
  log_warn "Ralph quality bar ($RALPH_BAR/$RALPH_BAR/$RALPH_BAR) not met after $RALPH_MAX_ATTEMPTS attempts (P:$SCORE_P C:$SCORE_C V:$SCORE_V). Deploying best effort."

  # Still write the best score to frontmatter (so UI shows it even on best-effort deploys)
  if [ "$SCORE_P" -gt 0 ] && [ "$SCORE_C" -gt 0 ] && [ "$SCORE_V" -gt 0 ]; then
    RALPH_SCORE_JSON="$(jq -cn \
      --argjson score "$(( (SCORE_P + SCORE_C + SCORE_V) / 3 ))" \
      --argjson persona "$SCORE_P" \
      --argjson clawdNote "$SCORE_C" \
      --argjson vibe "$SCORE_V" \
      --argjson iter "$RALPH_ATTEMPT" \
      '{score: $score, details: {persona: $persona, clawdNote: $clawdNote, vibe: $vibe}, model: "claude-opus-4-6", iteration: $iter}')"
    node "$GU_LOG_DIR/scripts/frontmatter-scores.mjs" write \
      "$POSTS_DIR/$ACTIVE_FILENAME" opus "$RALPH_SCORE_JSON" \
      && log_ok "  Wrote best-effort Ralph score to frontmatter" \
      || log_warn "  Failed to write Ralph score to frontmatter"
  fi
fi

# Step 5: Deploy
if [ "$DRY_RUN" = true ]; then
  log_warn "--dry-run enabled; skipping deploy step"
else
  step_start "Step 5: deploy"
  [ -d "$POSTS_DIR" ] || die "Missing posts directory: $POSTS_DIR"

  if [ -z "$EXISTING_FILE" ]; then
    SP_NUM=$(allocate_ticket_number)
    PROMPT_TICKET_ID="${TICKET_PREFIX}-${SP_NUM}"
    FILENAME="${TICKET_PREFIX,,}-${SP_NUM}-${DATE_STAMP}-${AUTHOR_SLUG}-${TITLE_SLUG}.mdx"
    EN_FILENAME="en-${FILENAME}"

    log_info "  Counter locked+bumped at commit time: ${PROMPT_TICKET_ID} (next will be $((SP_NUM + 1)))"

    if [ -f "$POSTS_DIR/$FILENAME" ] && [ "$ACTIVE_FILENAME" != "$FILENAME" ]; then
      die "Final filename already exists: $POSTS_DIR/$FILENAME"
    fi
    if [ -f "$POSTS_DIR/$EN_FILENAME" ] && [ "$ACTIVE_EN_FILENAME" != "$EN_FILENAME" ]; then
      die "Final EN filename already exists: $POSTS_DIR/$EN_FILENAME"
    fi

    if [ -f "$POSTS_DIR/$ACTIVE_FILENAME" ] && [ "$ACTIVE_FILENAME" != "$FILENAME" ]; then
      mv "$POSTS_DIR/$ACTIVE_FILENAME" "$POSTS_DIR/$FILENAME"
    fi
    if [ -f "$POSTS_DIR/$ACTIVE_EN_FILENAME" ] && [ "$ACTIVE_EN_FILENAME" != "$EN_FILENAME" ]; then
      mv "$POSTS_DIR/$ACTIVE_EN_FILENAME" "$POSTS_DIR/$EN_FILENAME"
    fi

    replace_pending_ticket_id "$POSTS_DIR/$FILENAME" "$PROMPT_TICKET_ID"
    replace_pending_ticket_id "$POSTS_DIR/$EN_FILENAME" "$PROMPT_TICKET_ID"

    ACTIVE_FILENAME="$FILENAME"
    ACTIVE_EN_FILENAME="$EN_FILENAME"
  else
    log_info "  Skipping counter bump (--file resume)"
  fi

  set +e
  VALIDATION_OUTPUT=$(
    cd "$GU_LOG_DIR"
    node scripts/validate-posts.mjs 2>&1
  )
  VALIDATION_STATUS=$?
  set -e

  if [ "$VALIDATION_STATUS" -ne 0 ]; then
    if printf '%s\n' "$VALIDATION_OUTPUT" | grep -F -e "$FILENAME" -e "$EN_FILENAME" >/dev/null 2>&1; then
      log_error "Validation failed for newly generated file(s)"
      rm -f "$POSTS_DIR/$FILENAME" "$POSTS_DIR/$EN_FILENAME"
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
    git commit -m "Add ${PROMPT_TICKET_ID}: ${TITLE}"
    git push
  )

  STEP5_TIME=$(step_end "Step 5")
fi

# Step 6: Report
TOTAL_TIME=$(( $(date +%s) - TOTAL_START ))
printf "\n"
log_info "Pipeline Summary"
printf "SP number   : %s\n" "${SP_NUM:-PENDING}"
printf "Title       : %s\n" "${TITLE:-N/A}"
printf "Filename    : %s\n" "${FILENAME:-${ACTIVE_FILENAME:-N/A (dry-run)}}"
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
