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

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  bash sp-pipeline.sh <tweet_url> [--dry-run]

Description:
  Run the full gu-log SP article pipeline from a tweet URL.

Options:
  --dry-run   Run steps 0-4 and stop before deploy.
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
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
COUNTER_FILE="$GU_LOG_DIR/scripts/article-counter.json"
STYLE_GUIDE_FILE="$GU_LOG_DIR/scripts/sp-style-guide.md"
POSTS_DIR="$GU_LOG_DIR/src/content/posts"
TOTAL_START=$(date +%s)

STEP0_TIME=0
STEP1_TIME=0
STEP2_TIME=0
STEP3_TIME=0
STEP4_TIME=0
STEP5_TIME=0

FILENAME=""
TITLE=""
SP_NUM=""
WORK_DIR=""
AUTHOR_HANDLE=""
ORIGINAL_DATE=""

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

SP_NUM=$(jq -r '.SP.next // empty' "$COUNTER_FILE")
[ -n "$SP_NUM" ] || die "Could not read SP.next from $COUNTER_FILE"

WORK_DIR="$GU_LOG_DIR/tmp/sp-${SP_NUM}-pipeline"
mkdir -p "$WORK_DIR"
STEP0_TIME=$(step_end "Step 0")

# Step 1: Fetch tweet
step_start "Step 1: fetch tweet"
if ! bird read "$TWEET_URL" > "$WORK_DIR/source-tweet.md"; then
  die "bird read failed for URL: $TWEET_URL"
fi

AUTHOR_HANDLE=$(grep -Eo '@[A-Za-z0-9_]+' "$WORK_DIR/source-tweet.md" | head -n 1 | sed 's/^@//' || true)
[ -n "$AUTHOR_HANDLE" ] || die "Failed to extract author handle from bird output"

ORIGINAL_DATE=$(extract_tweet_date "$WORK_DIR/source-tweet.md" || true)
[ -n "$ORIGINAL_DATE" ] || die "Failed to extract tweet date from bird output"
STEP1_TIME=$(step_end "Step 1")

# Step 2: Gemini Write
step_start "Step 2: gemini write draft"
cat > "$WORK_DIR/gemini-write-prompt.txt" <<EOF_WRITE
You are writing a gu-log SP article draft in Traditional Chinese.

Task:
- Write SP-${SP_NUM} article from the source tweet.
- Follow the style guide exactly.
- Use this metadata:
  - ticketId: SP-${SP_NUM}
  - originalDate: ${ORIGINAL_DATE}
  - translatedDate: $(date +%F)
  - source: @${AUTHOR_HANDLE} on X
  - sourceUrl: ${TWEET_URL}

Hard requirements:
- Write output to a file named draft-v1.mdx in the current directory.
- Do not leave the output empty.
- Include valid MDX frontmatter and body.

Style guide:
$(cat "$STYLE_GUIDE_FILE")

Source tweet:
$(cat "$WORK_DIR/source-tweet.md")
EOF_WRITE

(
  cd "$WORK_DIR"
  GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 gemini -m gemini-3.1-pro-preview -p "$(cat gemini-write-prompt.txt)" --sandbox false -y
)

[ -s "$WORK_DIR/draft-v1.mdx" ] || die "draft-v1.mdx missing or empty"
STEP2_TIME=$(step_end "Step 2")

# Step 3: Codex Review
step_start "Step 3: codex review"
cat > "$WORK_DIR/review-prompt.txt" <<EOF_REVIEW
Review draft-v1.mdx for SP-${SP_NUM}.

Checklist:
1. Fact-check: no hallucinated claims beyond source context.
2. Style alignment: matches sp-style-guide.md requirements.
3. Frontmatter accuracy: ticketId/source/sourceUrl/dates/tags format.
4. ClawdNote usage and kaomoji requirements.
5. Clear actionable fixes.

Write the full review to review.md in the current directory.
EOF_REVIEW

(
  cd "$WORK_DIR"
  codex exec -C . --full-auto "$(cat review-prompt.txt)"
)

[ -s "$WORK_DIR/review.md" ] || die "review.md missing or empty"
STEP3_TIME=$(step_end "Step 3")

# Step 4: Gemini Refine
step_start "Step 4: gemini refine"
cat > "$WORK_DIR/refine-prompt.txt" <<EOF_REFINE
Refine the SP-${SP_NUM} draft using review feedback.

Inputs:
- draft-v1.mdx
- review.md

Task:
- Produce a corrected final article.
- Keep style-guide compliance.
- Ensure frontmatter values remain accurate.

Hard requirement:
- Write final output to final.mdx in the current directory.
EOF_REFINE

(
  cd "$WORK_DIR"
  GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 gemini -m gemini-3.1-pro-preview -p "$(cat refine-prompt.txt)" --sandbox false -y
)

[ -s "$WORK_DIR/final.mdx" ] || die "final.mdx missing or empty"
STEP4_TIME=$(step_end "Step 4")

# Step 5: Deploy
if [ "$DRY_RUN" = true ]; then
  log_warn "--dry-run enabled; skipping deploy step"
else
  step_start "Step 5: deploy"
  [ -d "$POSTS_DIR" ] || die "Missing posts directory: $POSTS_DIR"

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
    TITLE="SP-${SP_NUM}"
  fi

  DATE_STAMP=$(date +%Y%m%d)
  AUTHOR_SLUG=$(sanitize_slug "$AUTHOR_HANDLE")
  TITLE_SLUG=$(sanitize_slug "$TITLE")

  FILENAME="sp-${SP_NUM}-${DATE_STAMP}-${AUTHOR_SLUG}-${TITLE_SLUG}.mdx"
  cp "$WORK_DIR/final.mdx" "$POSTS_DIR/$FILENAME"

  TMP_COUNTER=$(mktemp)
  jq '.SP.next += 1' "$COUNTER_FILE" > "$TMP_COUNTER"
  mv "$TMP_COUNTER" "$COUNTER_FILE"

  (
    cd "$GU_LOG_DIR"
    node scripts/validate-posts.mjs 2>&1
  )

  (
    cd "$GU_LOG_DIR"
    npm run build
  )

  (
    cd "$GU_LOG_DIR"
    git add "src/content/posts/$FILENAME" "scripts/article-counter.json"
    git commit -m "Add SP-${SP_NUM}: ${TITLE}"
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
printf "Step 2 time : %ss\n" "$STEP2_TIME"
printf "Step 3 time : %ss\n" "$STEP3_TIME"
printf "Step 4 time : %ss\n" "$STEP4_TIME"
printf "Step 5 time : %ss\n" "$STEP5_TIME"
printf "Total time  : %ss\n" "$TOTAL_TIME"
log_ok "Pipeline finished"
