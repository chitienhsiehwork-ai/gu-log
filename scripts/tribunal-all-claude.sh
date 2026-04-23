#!/usr/bin/env bash
# tribunal-all-claude.sh — 4-stage sequential tribunal (all-Claude models)
#
# Stages (in order):
#   1. Librarian  (Opus 4.6) — composite ≥ 8,             max 2 loops
#   2. Fact Check (Opus 4.7) — composite ≥ 8,             max 2 loops
#   3. Fresh Eyes (Opus 4.6) — composite ≥ 8,             max 2 loops
#   4. Vibe Scorer (Opus 4.6) — one dim ≥ 9 AND rest ≥ 8, max 3 loops
#
# Usage:
#   bash scripts/tribunal-all-claude.sh <filename.mdx>
#
# Standalone mode: bash scripts/tribunal-all-claude.sh sp-123-date-slug.mdx
# On crash resume: re-run same command; completed stages are skipped.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/score-helpers.sh
source "$SCRIPT_DIR/score-helpers.sh"

# shellcheck source=scripts/tribunal-run-control.sh
# Graceful stop helpers — file-flag only channel (no traps here; parent
# loop owns signals and writes the flag file on stop).
export RC_ROOT_DIR="$ROOT_DIR"
source "$SCRIPT_DIR/tribunal-run-control.sh"

# ─── Args ─────────────────────────────────────────────────────────────────────
POST_FILE="${1:-}"
if [ -z "$POST_FILE" ]; then
  echo "Usage: bash scripts/tribunal-all-claude.sh <filename.mdx>" >&2
  exit 1
fi

POST_FILE="$(basename "$POST_FILE")"  # strip any leading path
POST_PATH="$ROOT_DIR/src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

# ─── Logging ──────────────────────────────────────────────────────────────────
LOG_DIR="$ROOT_DIR/.score-loop/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/tribunal-$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)-${POST_FILE%.mdx}.log"

tlog() {
  local msg="[$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z')] [tribunal] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Lock ─────────────────────────────────────────────────────────────────────
# Exit code 75 = skipped (another instance is already running this article).
# Callers (batch-runner, quota-loop, Phase 2 supervisor) must treat this as
# "skipped", NOT as "passed" — otherwise stats are misleading. Chosen value:
# 75 matches sysexits.h EX_TEMPFAIL ("temporary failure, retry later") which
# is the closest stdlib semantic match.
LOCK_FILE="/tmp/tribunal-all-claude-${POST_FILE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[tribunal] skipped: another instance is already running for $POST_FILE (rc=75)." >&2
  exit 75
fi

# ─── Progress Tracking ────────────────────────────────────────────────────────
PROGRESS_FILE="$ROOT_DIR/scores/tribunal-progress.json"

ensure_progress_file() {
  mkdir -p "$(dirname "$PROGRESS_FILE")"
  if [ ! -f "$PROGRESS_FILE" ] || ! jq empty "$PROGRESS_FILE" 2>/dev/null; then
    printf '{}\n' > "$PROGRESS_FILE"
  fi
}

get_stage_status() {
  local article="$1"
  local stage="$2"
  jq -r --arg a "$article" --arg s "$stage" \
    '.[$a].stages[$s].status // "pending"' "$PROGRESS_FILE"
}

write_stage_progress() {
  local article="$1" stage="$2" status="$3" score_json="$4" model="$5" attempts="$6"
  (
    flock -x 9
    local tmp
    tmp="$(mktemp)"
    jq --arg a "$article" \
       --arg s "$stage" \
       --arg status "$status" \
       --arg model "$model" \
       --argjson attempts "$attempts" \
       --argjson score "$score_json" \
       '.[$a].stages[$s] = {status: $status, score: $score, model: $model, attempts: $attempts}' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

# Hard cap on how many times tribunal-all-claude.sh may run against the same
# article before we give up. Prevents sp-94-style 11-round FactChecker burn
# where quota-loop kept re-picking a FAILED article until it happened to pass.
MAX_TOP_ATTEMPTS=5

init_article_progress() {
  local article="$1"
  # Entire init + attempts increment + cap check runs under a single
  # flock so two workers can't both see attempts=N and both bump to N+1.
  local exhausted=0
  (
    flock -x 9
    local tmp
    tmp="$(mktemp)"
    local existing
    existing="$(jq -r --arg a "$article" '.[$a] // empty' "$PROGRESS_FILE")"
    if [ -z "$existing" ]; then
      jq --arg a "$article" \
         --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
         '.[$a] = {article: $a, startedAt: $ts, stages: {}, topLevelAttempts: 0}' \
         "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
      tlog "Progress initialized for $article"
    else
      tlog "Resuming existing progress for $article"
    fi

    # Increment + cap check
    local attempts
    attempts=$(jq -r --arg a "$article" '.[$a].topLevelAttempts // 0' "$PROGRESS_FILE")
    attempts=$((attempts + 1))
    jq --arg a "$article" --argjson n "$attempts" \
       '.[$a].topLevelAttempts = $n' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
    tlog "Top-level attempt $attempts/$MAX_TOP_ATTEMPTS for $article"

    if [ "$attempts" -gt "$MAX_TOP_ATTEMPTS" ]; then
      tlog "ERROR: $article exceeded MAX_TOP_ATTEMPTS=$MAX_TOP_ATTEMPTS. Marking EXHAUSTED."
      jq --arg a "$article" \
         --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
         '.[$a].status = "EXHAUSTED" | .[$a].finishedAt = $ts' \
         "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
      echo EXHAUSTED > "$tmp.flag"
    fi
    # Signal via file to parent shell; subshell variables don't escape.
    if [ -f "$tmp.flag" ]; then
      mv "$tmp.flag" "$RC_PROGRESS_LOCK.exhausted-flag" 2>/dev/null || true
    fi
  ) 9>>"$RC_PROGRESS_LOCK"

  if [ -f "$RC_PROGRESS_LOCK.exhausted-flag" ]; then
    rm -f "$RC_PROGRESS_LOCK.exhausted-flag"
    commit_progress "tribunal(${article%.mdx}): EXHAUSTED after $MAX_TOP_ATTEMPTS top-level attempts"
    exit 2
  fi
}

mark_article_failed() {
  local article="$1" failed_stage="$2"
  (
    flock -x 9
    local tmp
    tmp="$(mktemp)"
    jq --arg a "$article" \
       --arg s "$failed_stage" \
       --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
       '.[$a].status = "FAILED" | .[$a].failedStage = $s | .[$a].finishedAt = $ts' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

mark_article_passed() {
  local article="$1"
  (
    flock -x 9
    local tmp
    tmp="$(mktemp)"
    jq --arg a "$article" \
       --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
       '.[$a].status = "PASS" | .[$a].finishedAt = $ts' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

# ─── Pass Bar Checks (code is the rule) ───────────────────────────────────────
# Returns 0 = PASS, 1 = FAIL
check_pass_bar() {
  local validate_name="$1"
  local json_file="$2"

  case "$validate_name" in
    librarian)
      python3 - "$json_file" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
dims = data.get('dimensions', {})
vals = [dims.get(k, 0) for k in ('glossary', 'crossRef', 'sourceAlign', 'attribution')]
composite = math.floor(sum(vals) / len(vals))
sys.exit(0 if composite >= 8 else 1)
PY
      ;;
    fact-checker)
      python3 - "$json_file" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
dims = data.get('dimensions', {})
vals = [dims.get(k, 0) for k in ('accuracy', 'fidelity', 'consistency')]
composite = math.floor(sum(vals) / len(vals))
sys.exit(0 if composite >= 8 else 1)
PY
      ;;
    fresh-eyes)
      python3 - "$json_file" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
dims = data.get('dimensions', {})
vals = [dims.get(k, 0) for k in ('readability', 'firstImpression')]
composite = math.floor(sum(vals) / len(vals))
sys.exit(0 if composite >= 8 else 1)
PY
      ;;
    vibe-opus-scorer)
      # one dim ≥ 9 AND rest ≥ 8 (no dim < 8)
      python3 - "$json_file" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
dims = data.get('dimensions', {})
vals = [dims.get(k, 0) for k in ('persona', 'clawdNote', 'vibe', 'clarity', 'narrative')]
composite = math.floor(sum(vals) / len(vals))
if composite < 8:
    sys.exit(1)
if max(vals) < 9:
    sys.exit(1)
if min(vals) < 8:
    sys.exit(1)
sys.exit(0)
PY
      ;;
    *)
      tlog "ERROR: Unknown validate_name '$validate_name' in check_pass_bar"
      return 1
      ;;
  esac
}

# ─── Run One Tribunal Stage ───────────────────────────────────────────────────
# Args: stage_key, agent_name, validate_name, label, max_loops, model_label, post_file
# Returns: 0 = stage passed, 1 = stage failed (max loops exhausted)
run_stage() {
  local stage_key="$1"    # progress key: librarian, factChecker, freshEyes, vibe
  local agent_name="$2"   # agent name: librarian, fact-checker, fresh-eyes, vibe-opus-scorer
  local validate_name="$3" # validate name: librarian, fact-checker, fresh-eyes, vibe-opus-scorer
  local label="$4"        # human label: Librarian, FactChecker, FreshEyes, VibeScorer
  local max_loops="$5"    # 2 or 3
  local model_label="$6"  # opus-4.6 or opus-4.7 (for logging + --model flag)
  local post_file="$7"
  local fm_judge_key="${8:-}" # frontmatter scores key: librarian, factCheck, freshEyes, vibe

  local post_path="$ROOT_DIR/src/content/posts/$post_file"

  # Map model_label to CLI model ID (belt + suspenders: agent file also pins)
  local model_id
  case "$model_label" in
    opus-4.6) model_id="claude-opus-4-6" ;;
    opus-4.7) model_id="claude-opus-4-7" ;;
    *) model_id="" ;;  # no override, rely on agent file
  esac

  # ── Crash resume: skip already-passed stages ──
  local existing_status
  existing_status="$(get_stage_status "$post_file" "$stage_key")"
  if [ "$existing_status" = "pass" ]; then
    tlog "  Stage '$label' already PASS (crash resume). Skipping."
    return 0
  fi

  tlog "=== Stage $label ($model_label) | max_loops=$max_loops ==="

  # Load scoring SSOT once (included in writer prompt)
  local ssot_content
  ssot_content="$(cat "$ROOT_DIR/scripts/vibe-scoring-standard.md")"

  local score_tmp
  score_tmp="$(mktemp /tmp/tribunal-${stage_key}-XXXXXX.json)"

  local attempt=0
  while [ "$attempt" -lt "$max_loops" ]; do
    attempt=$((attempt + 1))
    tlog "  $label attempt $attempt/$max_loops..."

    write_stage_progress "$post_file" "$stage_key" "in_progress" "null" "$model_label" "$attempt"

    # ── Invoke judge (timeout 300s / 5 min) ──────────────────────────────────
    local judge_out
    judge_out="$(mktemp)"
    tlog "  Invoking agent '$agent_name' (timeout 300s)..."

    local judge_rc=0
    local -a judge_cmd=(timeout 300 claude -p --agent "$agent_name" --dangerously-skip-permissions)
    [ -n "$model_id" ] && judge_cmd+=(--model "$model_id")
    "${judge_cmd[@]}" \
      "Score this post: src/content/posts/$post_file
Write your JSON result to: $score_tmp" \
      > "$judge_out" 2>&1 || judge_rc=$?

    if [ "$judge_rc" -ne 0 ]; then
      tlog "  WARN: Agent '$agent_name' exited with code $judge_rc"
      if [ -s "$judge_out" ]; then
        head -5 "$judge_out" | while IFS= read -r line; do tlog "    $line"; done
      fi
    fi
    rm -f "$judge_out"

    # ── Validate score JSON ───────────────────────────────────────────────────
    if ! validate_judge_score_json "$validate_name" "$score_tmp"; then
      tlog "  WARN: Invalid/missing score JSON for $label attempt $attempt"
      if [ -f "$score_tmp" ]; then
        local raw
        raw="$(head -3 "$score_tmp" 2>/dev/null | tr '\n' ' ')"
        tlog "  Raw (head): $raw"
      fi
      # Don't count as pass; if last attempt, treat as fail
      if [ "$attempt" -ge "$max_loops" ]; then
        tlog "  Max loops exhausted with invalid JSON. FAIL."
        write_stage_progress "$post_file" "$stage_key" "fail" "null" "$model_label" "$attempt"
        rm -f "$score_tmp"
        return 1
      fi
      continue
    fi

    local score_json composite verdict
    score_json="$(cat "$score_tmp")"
    composite="$(jq -r '.score // 0' "$score_tmp")"
    verdict="$(jq -r '.verdict // "FAIL"' "$score_tmp")"
    tlog "  $label result: composite=$composite agent_verdict=$verdict"

    # ── Check pass bar (code wins over agent verdict) ─────────────────────────
    if check_pass_bar "$validate_name" "$score_tmp"; then
      tlog "  PASS: $label passed on attempt $attempt"
      write_stage_progress "$post_file" "$stage_key" "pass" "$score_json" "$model_label" "$attempt"

      # ── Write score to post frontmatter (tribunal badge) ──
      if [ -n "$fm_judge_key" ]; then
        local fm_score_json fm_model
        fm_model="$(jq -r '.judge_model // empty' "$score_tmp")"
        [ -z "$fm_model" ] && fm_model="claude-${model_label}"
        fm_score_json="$(jq --arg model "$fm_model" '. + {model: $model}' "$score_tmp")"
        tlog "  Writing $fm_judge_key score to frontmatter..."
        if write_score_to_frontmatter "$post_path" "$fm_judge_key" "$fm_score_json"; then
          tlog "  Frontmatter updated for $fm_judge_key."
        else
          tlog "  WARN: Failed to write $fm_judge_key score to frontmatter (non-fatal)."
        fi
      fi

      rm -f "$score_tmp"
      return 0
    fi

    tlog "  FAIL: $label failed on attempt $attempt"

    # Log failure reasons for diagnosis
    local reasons
    reasons="$(jq -r '.reasons | to_entries[] | "    \(.key): \(.value)"' "$score_tmp" 2>/dev/null || true)"
    if [ -n "$reasons" ]; then
      echo "$reasons" | while IFS= read -r line; do tlog "$line"; done
    fi

    # ── Max loops exhausted — no more rewrites ────────────────────────────────
    if [ "$attempt" -ge "$max_loops" ]; then
      tlog "  Max loops ($max_loops) exhausted for $label. FAIL."
      write_stage_progress "$post_file" "$stage_key" "fail" "$score_json" "$model_label" "$attempt"
      rm -f "$score_tmp"
      return 1
    fi

    # ── Rewrite: invoke tribunal-writer (timeout 900s / 15 min) ──────────────
    tlog "  Invoking tribunal-writer for rewrite (timeout 900s)..."

    local writer_prompt writer_out writer_rc
    writer_prompt="$(cat <<PROMPT
You are the tribunal-writer for gu-log. The $label judge reviewed this post and it FAILED.

## Post to rewrite
src/content/posts/$post_file

## Judge Feedback (JSON)
$score_json

## Scoring Standard (SSOT — read this carefully before rewriting)
$ssot_content

## Task
1. Read the post at src/content/posts/$post_file
2. Read the judge feedback JSON above — identify every dimension that scored below 8
3. Rewrite the post to fix the specific failures. Write it back in-place.
4. Also rewrite the EN counterpart at src/content/posts/en-$post_file if it exists.

Follow WRITING_GUIDELINES.md style rules and CONTRIBUTING.md frontmatter schema.
Do NOT change frontmatter fields (title, ticketId, dates, sourceUrl).
PROMPT
)"
    writer_out="$(mktemp)"
    writer_rc=0

    local -a writer_cmd=(timeout 900 claude -p --agent tribunal-writer --dangerously-skip-permissions --model claude-opus-4-6)
    "${writer_cmd[@]}" \
      "$writer_prompt" \
      > "$writer_out" 2>&1 || writer_rc=$?

    if [ "$writer_rc" -ne 0 ]; then
      tlog "  WARN: tribunal-writer exited with code $writer_rc"
    fi
    rm -f "$writer_out"

    # ── Verify post file still exists after rewrite ───────────────────────────
    if [ ! -f "$post_path" ]; then
      tlog "  ERROR: post file missing after writer rewrite. Reverting via git."
      git checkout -- "src/content/posts/$post_file" 2>/dev/null || true
      continue
    fi

    # ── Build check after rewrite ─────────────────────────────────────────────
    tlog "  Running pnpm build to verify no breakage..."
    local build_log build_rc
    build_log="$(mktemp)"
    build_rc=0
    pnpm run build > "$build_log" 2>&1 || build_rc=$?

    if [ "$build_rc" -ne 0 ]; then
      tlog "  ERROR: build failed after writer rewrite. Reverting changes."
      tail -15 "$build_log" | while IFS= read -r line; do tlog "    $line"; done
      git checkout -- "src/content/posts/$post_file" 2>/dev/null || true
      local en_file="src/content/posts/en-$post_file"
      if git ls-files --error-unmatch "$en_file" &>/dev/null 2>&1; then
        git checkout -- "$en_file" 2>/dev/null || true
      fi
    else
      tlog "  Build passed after rewrite."
    fi
    rm -f "$build_log"

    # Loop: re-score on next iteration
  done

  # Should never reach here (while condition handles all exits), but just in case:
  write_stage_progress "$post_file" "$stage_key" "fail" "null" "$model_label" "$attempt"
  rm -f "$score_tmp"
  return 1
}

# ─── Commit Progress ──────────────────────────────────────────────────────────
# Phase 2 (tribunal-safe-parallelism):
#   - Serialized by push_lock so 2 workers don't race on main branch.
#   - Honors TRIBUNAL_MAIN_REPO env var: workers running in their own isolated
#     worktrees can update the main repo's shared progress file (flock
#     coordinates the read-modify-write; this function coordinates the
#     git commit + push).
#   - Rebase-then-push with retry so a lost race to push is recoverable
#     without waiting for the next iteration.
commit_progress() {
  local msg="$1"
  local repo_dir="${TRIBUNAL_MAIN_REPO:-$ROOT_DIR}"
  (
    flock -x 10
    cd "$repo_dir" || { tlog "WARN: commit_progress cd $repo_dir failed"; exit 0; }
    git add "$PROGRESS_FILE" 2>/dev/null || true
    if git diff --cached --quiet; then
      exit 0  # nothing to commit
    fi
    git commit -m "$msg" --no-verify >> "$LOG_FILE" 2>&1 || exit 0

    local pushed=0
    for attempt in 1 2 3; do
      git fetch origin main >> "$LOG_FILE" 2>&1 || true
      if git rebase origin/main >> "$LOG_FILE" 2>&1; then
        if git push --no-verify >> "$LOG_FILE" 2>&1; then
          pushed=1
          break
        fi
      else
        tlog "WARN: rebase attempt $attempt failed, aborting and retrying."
        git rebase --abort 2>/dev/null || true
      fi
      sleep 2
    done
    [ "$pushed" -eq 1 ] || tlog "WARN: git push failed after 3 attempts (will retry on next run)"
  ) 10>>"$RC_PUSH_LOCK"
}

# ─── Prerequisites ────────────────────────────────────────────────────────────
for _cmd in jq python3 pnpm git flock claude; do
  if ! command -v "$_cmd" >/dev/null 2>&1; then
    echo "ERROR: Required command missing: $_cmd" >&2
    exit 1
  fi
done

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "ERROR: Git repository is mid-rebase. Resolve manually first." >&2
  exit 1
fi

ensure_score_dirs
ensure_progress_file
init_article_progress "$POST_FILE"

tlog "=== tribunal-all-claude.sh: $POST_FILE ==="

# ─── 4-Stage Sequential Loop ─────────────────────────────────────────────────
# Format: stage_key:agent_name:validate_name:label:max_loops:model_label:fm_judge_key
# fm_judge_key = frontmatter scores key (used by frontmatter-scores.mjs)
declare -a STAGES=(
  "librarian:librarian:librarian:Librarian:2:opus-4.6:librarian"
  "factChecker:fact-checker:fact-checker:FactChecker:2:opus-4.7:factCheck"
  "freshEyes:fresh-eyes:fresh-eyes:FreshEyes:2:opus-4.6:freshEyes"
  "vibe:vibe-opus-scorer:vibe-opus-scorer:VibeScorer:3:opus-4.6:vibe"
)

for stage_def in "${STAGES[@]}"; do
  IFS=':' read -r stage_key agent_name validate_name label max_loops model_label fm_judge_key <<< "$stage_def"

  if ! run_stage \
      "$stage_key" "$agent_name" "$validate_name" "$label" \
      "$max_loops" "$model_label" "$POST_FILE" "$fm_judge_key"; then
    tlog "=== FAILED at stage: $label ==="
    mark_article_failed "$POST_FILE" "$stage_key"
    commit_progress "tribunal(${POST_FILE%.mdx}): FAILED at $label stage"
    exit 1
  fi
done

tlog "=== ALL 4 STAGES PASSED: $POST_FILE ==="
mark_article_passed "$POST_FILE"
commit_progress "tribunal(${POST_FILE%.mdx}): all 4 stages PASS"
tlog "Done. Log: $LOG_FILE"
