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
  bash sp-pipeline.sh <tweet_url> [--dry-run] [--force]

Options:
  --dry-run   Run steps 0-4.5 and stop before deploy.
  --force     Skip evaluation step (Step 1.5).
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
STEP15_TIME=0
STEP2_TIME=0
STEP3_TIME=0
STEP4_TIME=0
STEP45_TIME=0
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
    GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 gemini -m gemini-3.1-pro-preview -p "$(cat eval-gemini-prompt.txt)" --sandbox false -y
  )
  GEMINI_EVAL_STATUS=$?
  (
    cd "$WORK_DIR"
    codex exec -C . --full-auto "$(cat eval-codex-prompt.txt)"
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

Output requirements:
- Write the full review to review.md in the current directory.
- Also write structured notes JSON to review-codex-notes.json in the current directory.
- Notes schema (JSON only):
  {"notes":[{"after_section":"## heading text","content":"explanation of what was wrong/fixed"}]}
- Keep notes highly selective: max 2 notes.
- If no factual errors or significant issues found, output {"notes":[]} instead.
- Only output notes for factual corrections, important missing context, or substantial fixes.
- Never output generic praise.
- Strict rule: 只在發現事實錯誤、重要遺漏、或有實質修改時才輸出 note。品質 > 數量。
EOF_REVIEW

(
  cd "$WORK_DIR"
  codex exec -C . --full-auto "$(cat review-prompt.txt)"
)

[ -s "$WORK_DIR/review.md" ] || die "review.md missing or empty"
[ -s "$WORK_DIR/review-codex-notes.json" ] || die "review-codex-notes.json missing or empty"
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

Output requirements:
- Write final output to final.mdx in the current directory.
- Also write structured notes JSON to refine-gemini-notes.json in the current directory.
- Notes schema (JSON only):
  {"notes":[{"after_section":"## heading text","content":"what substantial change was made and why"}]}
- Keep notes highly selective: max 2 notes.
- If edits are minor/no substantial refinement, output {"notes":[]} instead.
- Only output notes for factual corrections, important missing context, or substantial rewrites.
- Never output generic or self-congratulatory notes.
- Strict rule: 只在發現事實錯誤、重要遺漏、或有實質修改時才輸出 note。品質 > 數量。
EOF_REFINE

(
  cd "$WORK_DIR"
  GOOGLE_GENAI_USE_GCA=true TERM=dumb NO_COLOR=1 gemini -m gemini-3.1-pro-preview -p "$(cat refine-prompt.txt)" --sandbox false -y
)

[ -s "$WORK_DIR/final.mdx" ] || die "final.mdx missing or empty"
[ -s "$WORK_DIR/refine-gemini-notes.json" ] || die "refine-gemini-notes.json missing or empty"
STEP4_TIME=$(step_end "Step 4")

# Step 4.5: Insert agent notes into final article
step_start "Step 4.5: insert agent notes"
cat > "$WORK_DIR/insert-agent-notes.mjs" <<'EOF_INSERT_NOTES'
import fs from 'node:fs';

const [, , finalPath, codexPath, geminiPath] = process.argv;

if (!finalPath || !codexPath || !geminiPath) {
  console.error('Usage: node insert-agent-notes.mjs <final.mdx> <codex.json> <gemini.json>');
  process.exit(1);
}

function readNotes(path, componentName, maxPerAgent) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
  return notes
    .filter((n) => typeof n?.after_section === 'string' && typeof n?.content === 'string')
    .map((n) => ({
      after_section: n.after_section.trim(),
      content: n.content.trim(),
      component: componentName,
    }))
    .filter((n) => n.after_section.length > 0 && n.content.length > 0)
    .slice(0, maxPerAgent);
}

const codexNotes = readNotes(codexPath, 'CodexNote', 2);
const geminiNotes = readNotes(geminiPath, 'GeminiNote', 2);
const merged = [...codexNotes, ...geminiNotes].slice(0, 3);

if (merged.length === 0) {
  process.exit(0);
}

const raw = fs.readFileSync(finalPath, 'utf8');
const lines = raw.split('\n');

const fmStart = lines[0]?.trim() === '---' ? 0 : -1;
let fmEnd = -1;
if (fmStart === 0) {
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      fmEnd = i;
      break;
    }
  }
}

const bodyStart = fmEnd >= 0 ? fmEnd + 1 : 0;
const headingMap = new Map();
for (let i = bodyStart; i < lines.length; i += 1) {
  const normalized = lines[i].trim();
  if (normalized.startsWith('## ')) {
    if (!headingMap.has(normalized)) {
      headingMap.set(normalized, []);
    }
    headingMap.get(normalized).push(i);
  }
}

const notesByLine = new Map();
const usedComponents = new Set();
for (const note of merged) {
  const targetLines = headingMap.get(note.after_section);
  if (!targetLines || targetLines.length === 0) {
    continue;
  }
  const targetLine = targetLines[0];
  if (!notesByLine.has(targetLine)) {
    notesByLine.set(targetLine, []);
  }
  notesByLine.get(targetLine).push(note);
  usedComponents.add(note.component);
}

if (notesByLine.size === 0) {
  process.exit(0);
}

const insertImports = [];
if (usedComponents.has('CodexNote') && !raw.includes("import CodexNote from '../../components/CodexNote.astro';")) {
  insertImports.push("import CodexNote from '../../components/CodexNote.astro';");
}
if (usedComponents.has('GeminiNote') && !raw.includes("import GeminiNote from '../../components/GeminiNote.astro';")) {
  insertImports.push("import GeminiNote from '../../components/GeminiNote.astro';");
}

if (insertImports.length > 0) {
  const importBlock = ['', ...insertImports];
  lines.splice(bodyStart, 0, ...importBlock);
  const shift = importBlock.length;
  const shifted = new Map();
  for (const [lineNo, noteList] of notesByLine.entries()) {
    shifted.set(lineNo + shift, noteList);
  }
  notesByLine.clear();
  for (const [lineNo, noteList] of shifted.entries()) {
    notesByLine.set(lineNo, noteList);
  }
}

const output = [];
let inserted = 0;
for (let i = 0; i < lines.length; i += 1) {
  output.push(lines[i]);
  const notes = notesByLine.get(i);
  if (!notes) {
    continue;
  }
  output.push('');
  for (const note of notes) {
    const cleanContent = note.content.replace(/\n+/g, ' ').trim();
    output.push(`<${note.component}>${cleanContent}</${note.component}>`);
    output.push('');
    inserted += 1;
  }
}

fs.writeFileSync(finalPath, output.join('\n').replace(/\n{3,}/g, '\n\n'));
console.log(`Inserted ${inserted} agent note(s).`);
EOF_INSERT_NOTES

(
  cd "$WORK_DIR"
  node insert-agent-notes.mjs final.mdx review-codex-notes.json refine-gemini-notes.json
)
STEP45_TIME=$(step_end "Step 4.5")

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

  COUNTER_BACKUP="$WORK_DIR/counter-before.json"
  cp "$COUNTER_FILE" "$COUNTER_BACKUP"

  TMP_COUNTER=$(mktemp)
  jq '.SP.next += 1' "$COUNTER_FILE" > "$TMP_COUNTER"
  mv "$TMP_COUNTER" "$COUNTER_FILE"

  set +e
  VALIDATION_OUTPUT=$(
    cd "$GU_LOG_DIR"
    node scripts/validate-posts.mjs 2>&1
  )
  VALIDATION_STATUS=$?
  set -e

  if [ "$VALIDATION_STATUS" -ne 0 ]; then
    if printf '%s\n' "$VALIDATION_OUTPUT" | grep -F "$FILENAME" >/dev/null 2>&1; then
      log_error "Validation failed for newly generated file: $FILENAME"
      rm -f "$POSTS_DIR/$FILENAME"
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
printf "Step 1.5 time : %ss\n" "$STEP15_TIME"
printf "Step 2 time : %ss\n" "$STEP2_TIME"
printf "Step 3 time : %ss\n" "$STEP3_TIME"
printf "Step 4 time : %ss\n" "$STEP4_TIME"
printf "Step 4.5 time : %ss\n" "$STEP45_TIME"
printf "Step 5 time : %ss\n" "$STEP5_TIME"
printf "Total time  : %ss\n" "$TOTAL_TIME"
log_ok "Pipeline finished"
