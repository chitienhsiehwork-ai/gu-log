#!/usr/bin/env bash
# tribunal.sh — Tribunal v8 sequential tribunal (Codex/GPT-5.5 runner)
#
# Stages (in order):
#   1. Fact Check (GPT-5.5) — source/commentary gate + fact bar, max 2 loops
#   2. Librarian  (GPT-5.5) — composite ≥ 8,             max 2 loops
#   3. Fresh Eyes (GPT-5.5) — composite ≥ 8,             max 2 loops
#   4. Vibe Scorer (GPT-5.5) — one dim ≥ 9 AND rest ≥ 8, max 3 loops
#
# Usage:
#   bash scripts/tribunal.sh [--only-stage <factChecker|librarian|freshEyes|vibe>] [--allow-rewrite] [--no-commit] <filename.mdx>
#   bash scripts/tribunal.sh --score-only --only-stage vibe <filename.mdx>
#
# Standalone mode: bash scripts/tribunal.sh sp-123-date-slug.mdx
# Single-stage mode is judge-only by default: it scores and may update progress,
# but it will not invoke tribunal-writer unless --allow-rewrite is explicit.
# --score-only is fully non-mutating: no rewrite, no frontmatter, no commit.
# On crash resume: re-run same command; completed stages are skipped.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/score-helpers.sh
source "$SCRIPT_DIR/score-helpers.sh"

# shellcheck source=scripts/tribunal-helpers.sh
source "$SCRIPT_DIR/tribunal-helpers.sh"

# shellcheck source=scripts/tribunal-run-control.sh
# Graceful stop helpers — file-flag only channel (no traps here; parent
# loop owns signals and writes the flag file on stop).
export RC_ROOT_DIR="$ROOT_DIR"
source "$SCRIPT_DIR/tribunal-run-control.sh"

# ─── Args ─────────────────────────────────────────────────────────────────────
ONLY_STAGE=""
POST_FILE=""
ALLOW_REWRITE=""
WRITE_FRONTMATTER=1
SCORE_ONLY=0
TRIBUNAL_VERSION=8
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only-stage)
      ONLY_STAGE="${2:-}"
      if [ -z "$ONLY_STAGE" ]; then
        echo "ERROR: --only-stage requires a stage key" >&2
        exit 1
      fi
      shift 2
      ;;
    --only-stage=*)
      ONLY_STAGE="${1#--only-stage=}"
      shift
      ;;
    --allow-rewrite)
      ALLOW_REWRITE=1
      shift
      ;;
    --no-rewrite|--judge-only)
      ALLOW_REWRITE=0
      shift
      ;;
    --no-commit)
      export TRIBUNAL_NO_COMMIT=1
      shift
      ;;
    --score-only)
      export TRIBUNAL_NO_COMMIT=1
      ALLOW_REWRITE=0
      WRITE_FRONTMATTER=0
      SCORE_ONLY=1
      shift
      ;;
    -h|--help)
      echo "Usage: bash scripts/tribunal.sh [--only-stage <factChecker|librarian|freshEyes|vibe>] [--allow-rewrite] [--no-commit|--score-only] <filename.mdx>"
      exit 0
      ;;
    --*)
      echo "ERROR: unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [ -n "$POST_FILE" ]; then
        echo "ERROR: multiple post files provided: $POST_FILE and $1" >&2
        exit 1
      fi
      POST_FILE="$1"
      shift
      ;;
  esac
done

if [ -z "$POST_FILE" ]; then
  echo "Usage: bash scripts/tribunal.sh [--only-stage <factChecker|librarian|freshEyes|vibe>] [--allow-rewrite] [--no-commit|--score-only] <filename.mdx>" >&2
  exit 1
fi

case "$ONLY_STAGE" in
  ""|librarian|factChecker|freshEyes|vibe) ;;
  *)
    echo "ERROR: unknown --only-stage value: $ONLY_STAGE" >&2
    exit 1
    ;;
esac

if [ -z "$ALLOW_REWRITE" ]; then
  if [ -n "$ONLY_STAGE" ]; then
    ALLOW_REWRITE=0
  else
    ALLOW_REWRITE=1
  fi
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
LOCK_FILE="/tmp/tribunal-${POST_FILE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[tribunal] skipped: another instance is already running for $POST_FILE (rc=75)." >&2
  exit 75
fi

# ─── Progress Tracking ────────────────────────────────────────────────────────
# Supervisor runs in the main repo and exports PROGRESS_FILE pointing at the
# ignored runtime ledger under .score-loop/state; workers run in isolated
# worktrees. Without honoring the export, this line would clobber the shared
# ledger path with the WORKTREE's local default, so per-worker progress writes
# land in the wrong place and the supervisor can re-dispatch already-terminal
# articles. Keep the exported env authoritative so shared flock + shared file
# coordinates all line up.
PROGRESS_FILE="${PROGRESS_FILE:-$(tribunal_progress_file_default "$ROOT_DIR")}"
if [ "$SCORE_ONLY" -eq 1 ]; then
  if [ -n "${TRIBUNAL_SCORE_ONLY_PROGRESS_FILE:-}" ]; then
    PROGRESS_FILE="$TRIBUNAL_SCORE_ONLY_PROGRESS_FILE"
  else
    PROGRESS_FILE="$(mktemp /tmp/tribunal-score-only-progress-XXXXXX.json)"
    trap 'rm -f "$PROGRESS_FILE"' EXIT
  fi
fi

ensure_progress_file() {
  ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"
}

get_stage_status() {
  local article="$1"
  local stage="$2"
  jq -r --arg a "$article" --arg s "$stage" --argjson v "$TRIBUNAL_VERSION" \
    'if ((.[$a].stages[$s].tribunalVersion // 0) >= $v) then (.[$a].stages[$s].status // "pending") else "pending" end' "$PROGRESS_FILE"
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
       --argjson tribunalVersion "$TRIBUNAL_VERSION" \
       --argjson score "$score_json" \
       '.[$a].stages[$s] = {status: $status, score: $score, model: $model, attempts: $attempts, tribunalVersion: $tribunalVersion}' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

# Hard cap on how many times tribunal.sh may run against the same
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
         --argjson tribunalVersion "$TRIBUNAL_VERSION" \
         --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
         '.[$a] = {article: $a, startedAt: $ts, stages: {}, topLevelAttempts: 0, tribunalVersion: $tribunalVersion}' \
         "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
      tlog "Progress initialized for $article"
    else
      local existing_version
      existing_version=$(jq -r --arg a "$article" '.[$a].tribunalVersion // 0' "$PROGRESS_FILE")
      if ! [[ "$existing_version" =~ ^[0-9]+$ ]]; then existing_version=0; fi
      if [ "$existing_version" -lt "$TRIBUNAL_VERSION" ]; then
        jq --arg a "$article" \
           --argjson tribunalVersion "$TRIBUNAL_VERSION" \
           --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
           '.[$a].status = "PENDING" | .[$a].stages = {} | .[$a].topLevelAttempts = 0 | .[$a].startedAt = $ts | .[$a].tribunalVersion = $tribunalVersion | del(.[$a].finishedAt, .[$a].failedStage)' \
           "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
        tlog "Progress reset for $article: tribunalVersion $existing_version → $TRIBUNAL_VERSION"
      fi
      tlog "Resuming existing progress for $article"
    fi

    # topLevelAttempts counts terminal content failures, not process starts.
    # A worker killed mid-stage leaves status in-progress/no-score; restarting
    # that article must not burn an attempt or eventually poison it as
    # EXHAUSTED.
    local attempts article_status
    attempts=$(jq -r --arg a "$article" '.[$a].topLevelAttempts // 0' "$PROGRESS_FILE")
    article_status=$(jq -r --arg a "$article" '.[$a].status // ""' "$PROGRESS_FILE")
    if ! [[ "$attempts" =~ ^[0-9]+$ ]]; then attempts=0; fi

    if [ "$article_status" != "FAILED" ] && [ "$attempts" -gt 0 ]; then
      jq --arg a "$article" '.[$a].topLevelAttempts = 0' \
         "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
      attempts=0
      tlog "Reset non-terminal topLevelAttempts for $article after interrupted/non-content run."
    fi

    tlog "Top-level attempt $((attempts + 1))/$MAX_TOP_ATTEMPTS for $article"

    if [ "$article_status" = "FAILED" ] && [ "$attempts" -ge "$MAX_TOP_ATTEMPTS" ]; then
      tlog "ERROR: $article exceeded MAX_TOP_ATTEMPTS=$MAX_TOP_ATTEMPTS. Marking EXHAUSTED."
      jq --arg a "$article" \
         --argjson tribunalVersion "$TRIBUNAL_VERSION" \
         --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
         '.[$a].status = "EXHAUSTED" | .[$a].finishedAt = $ts | .[$a].tribunalVersion = $tribunalVersion' \
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
       --argjson tribunalVersion "$TRIBUNAL_VERSION" \
       --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
       '.[$a].topLevelAttempts = ((.[$a].topLevelAttempts // 0) + 1)
        | .[$a].status = "FAILED"
        | .[$a].failedStage = $s
        | .[$a].finishedAt = $ts
        | .[$a].tribunalVersion = $tribunalVersion' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

mark_article_runner_error() {
  local article="$1" failed_stage="$2" model="$3" attempts="$4" reason="$5"
  (
    flock -x 9
    local tmp
    tmp="$(mktemp)"
    jq --arg a "$article" \
       --arg s "$failed_stage" \
       --arg model "$model" \
       --arg reason "$reason" \
       --argjson attempts "$attempts" \
       --argjson tribunalVersion "$TRIBUNAL_VERSION" \
       --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
       '.[$a].status = "RUNNER_ERROR"
        | .[$a].failedStage = $s
        | .[$a].finishedAt = $ts
        | .[$a].tribunalVersion = $tribunalVersion
        | .[$a].topLevelAttempts = (.[$a].topLevelAttempts // 0)
        | .[$a].stages[$s] = {
            status: "runner_error",
            score: null,
            model: $model,
            attempts: $attempts,
            tribunalVersion: $tribunalVersion,
            error: $reason
          }' \
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
       --argjson tribunalVersion "$TRIBUNAL_VERSION" \
       --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
       '.[$a].status = "PASS" | .[$a].finishedAt = $ts | .[$a].tribunalVersion = $tribunalVersion' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

# ─── Cheap Validation + Final Build Gate ─────────────────────────────────────
# After writer rewrites we intentionally avoid full-site builds; those are
# serialized and deferred to the final gate after all judge stages pass.
cheap_validate_writer_rewrite() {
  local post_file="$1" en_existed_before="$2"
  local post_rel="src/content/posts/$post_file"
  local en_rel="src/content/posts/en-$post_file"
  local diff_paths=("$post_rel")

  if [ ! -f "$post_rel" ]; then
    tlog "  ERROR: cheap validation failed: post file missing after writer rewrite ($post_rel)."
    return 1
  fi

  if [ "$en_existed_before" = "1" ]; then
    if [ ! -f "$en_rel" ]; then
      tlog "  ERROR: cheap validation failed: EN counterpart missing after writer rewrite ($en_rel)."
      return 1
    fi
    diff_paths+=("$en_rel")
  elif git ls-files --error-unmatch "$en_rel" >/dev/null 2>&1; then
    diff_paths+=("$en_rel")
  fi

  local validate_paths=("$post_rel")
  if [[ " ${diff_paths[*]} " == *" $en_rel "* ]]; then
    validate_paths+=("$en_rel")
  fi

  tlog "  Running cheap post validation for ${validate_paths[*]}..."
  if ! node scripts/validate-posts.mjs "${validate_paths[@]}" >> "$LOG_FILE" 2>&1; then
    tlog "  ERROR: cheap validation failed: validate-posts rejected rewritten post files."
    return 1
  fi

  tlog "  Running git diff --check for rewritten post files..."
  if ! git diff --check -- "${diff_paths[@]}" >> "$LOG_FILE" 2>&1; then
    tlog "  ERROR: cheap validation failed: git diff --check found whitespace/conflict issues."
    return 1
  fi

  tlog "  Cheap validation passed after writer rewrite."
  return 0
}

revert_writer_rewrite_files() {
  local post_file="$1"
  local post_rel="src/content/posts/$post_file"
  local en_rel="src/content/posts/en-$post_file"
  git checkout -- "$post_rel" 2>/dev/null || true
  if git ls-files --error-unmatch "$en_rel" >/dev/null 2>&1; then
    git checkout -- "$en_rel" 2>/dev/null || true
  elif [ -e "$en_rel" ]; then
    rm -f -- "$en_rel"
  fi
}

# Writers sometimes rewrite/copy the YAML scores block while editing prose.
# Tribunal scores are harness-owned: stale v5 scores may be temporarily present
# while v8 is re-scoring, and partial writer edits can turn them into invalid
# v8 frontmatter (for example tribunalVersion: 8 without FreshEyes v8 dims).
# Preserve the pre-writer scores block exactly; successful stages write their
# own score blocks later via frontmatter-scores.mjs.
restore_scores_block_from_snapshot() {
  local snapshot="$1" target="$2"
  [ -f "$snapshot" ] || return 0
  [ -f "$target" ] || return 0
  python3 - "$snapshot" "$target" <<'PY'
import re, sys
from pathlib import Path
snap = Path(sys.argv[1])
target = Path(sys.argv[2])
old = snap.read_text(encoding='utf-8')
new = target.read_text(encoding='utf-8')
fm_re = re.compile(r'^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)([\s\S]*)$')
old_m = fm_re.match(old)
new_m = fm_re.match(new)
if not old_m or not new_m:
    sys.exit(0)

def split_scores(fm: str):
    lines = fm.split('\n')
    out = []
    start = end = None
    i = 0
    while i < len(lines):
        if lines[i] == 'scores:':
            start = i
            j = i + 1
            while j < len(lines):
                if lines[j] != '' and not lines[j].startswith((' ', '\t')):
                    break
                j += 1
            end = j
            out = lines[start:end]
            break
        i += 1
    return start, end, out

old_start, old_end, old_scores = split_scores(old_m.group(2))
new_fm = new_m.group(2)
new_lines = new_fm.split('\n')
new_start, new_end, _ = split_scores(new_fm)
if new_start is not None:
    if old_scores:
        new_lines[new_start:new_end] = old_scores
    else:
        del new_lines[new_start:new_end]
elif old_scores:
    # Reinsert at end of frontmatter if the writer accidentally removed scores.
    while new_lines and new_lines[-1] == '':
        new_lines.pop()
    if new_lines:
        new_lines.append('')
    new_lines.extend(old_scores)
restored_fm = '\n'.join(new_lines).rstrip('\n')
target.write_text(new_m.group(1) + restored_fm + new_m.group(3) + new_m.group(4), encoding='utf-8')
PY
}

classify_build_failure() {
  local rc="$1" build_log="$2" post_file="$3"
  local post_rel="src/content/posts/$post_file"
  local en_rel="src/content/posts/en-$post_file"
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo operational
    return 0
  fi
  if grep -Eiq 'out of memory|oom-kill|oom killed|killed process|heap out of memory|JavaScript heap out of memory|FATAL ERROR|SIGKILL|Killed$|Exit status 137' "$build_log" 2>/dev/null; then
    echo operational
    return 0
  fi
  # Only spend writer repair tokens when the full-build evidence points at the
  # target post or its EN counterpart. Unrelated global/component/build breaks
  # should fail safely instead of asking the writer to hallucinate a content fix.
  if grep -Fq "$post_rel" "$build_log" 2>/dev/null || grep -Fq "$en_rel" "$build_log" 2>/dev/null; then
    if grep -Eiq 'MDX|frontmatter|schema|Expected|Unexpected|SyntaxError|ParseError|cannot render|render|component|validate-posts|content collection|astro:content|src/content/posts' "$build_log" 2>/dev/null; then
      echo actionable
      return 0
    fi
  fi
  echo unknown
}

run_final_build_once() {
  local build_log="$1"
  local lock_dir="${TRIBUNAL_SHARED_LOCK_DIR:-${TRIBUNAL_MAIN_REPO:-$ROOT_DIR}/.score-loop/locks}"
  local lock_file="$lock_dir/build.lock"
  local wait_start wait_duration rc
  mkdir -p "$lock_dir"
  wait_start="$(date +%s)"
  tlog "Waiting for build lock: $lock_file"
  rc=0
  (
    flock -x 8
    wait_duration=$(($(date +%s) - wait_start))
    tlog "Acquired build lock after ${wait_duration} seconds"
    local build_start build_duration build_rc
    build_start="$(date +%s)"
    build_rc=0
    tlog "Running final pnpm build"
    timeout --kill-after=15s 900 pnpm run build > "$build_log" 2>&1 || build_rc=$?
    build_duration=$(($(date +%s) - build_start))
    if [ "$build_rc" -eq 0 ]; then
      tlog "Final build passed rc=0 duration=${build_duration}s"
    else
      tlog "Final build failed rc=$build_rc duration=${build_duration}s"
      tail -30 "$build_log" | while IFS= read -r line; do tlog "    $line"; done
    fi
    exit "$build_rc"
  ) 8>>"$lock_file" || rc=$?
  tlog "Released build lock"
  return "$rc"
}

repair_final_build_failure() {
  local post_file="$1" build_log="$2" repair_attempt="$3"
  local evidence writer_prompt writer_out writer_rc en_existed_before
  evidence="$(tail -80 "$build_log" 2>/dev/null || true)"
  if [ -f "src/content/posts/en-$post_file" ]; then
    en_existed_before=1
  else
    en_existed_before=0
  fi

  tlog "Invoking tribunal-writer for final build repair attempt $repair_attempt/2..."
  writer_prompt="$(cat <<PROMPT
You are the tribunal-writer for gu-log. All judge stages passed, but the final full-site build failed.

## Repo root
$ROOT_DIR

## Target post
$ROOT_DIR/src/content/posts/$post_file

## EN counterpart, if present
$ROOT_DIR/src/content/posts/en-$post_file

## Build failure evidence (tail)
$evidence

## Task
1. Use absolute paths under the Repo root above; this Codex process runs from a temp directory, not the repo root.
2. Fix only content-actionable problems in $ROOT_DIR/src/content/posts/$post_file.
3. Also update $ROOT_DIR/src/content/posts/en-$post_file if it exists and the same issue applies.
4. Inspect your diff before finishing. Do not run tribunal, judge agents, or any quota-burning model calls from inside this repair.
5. Do not rewrite unrelated content and do not change stable frontmatter fields unless the build error specifically requires it.
PROMPT
)"
  writer_out="$(mktemp)"
  writer_rc=0
  # Spawn from tmp work-dir so Codex does not inherit unrelated repo-local
  # instructions. Writer's job is to edit src/content/posts/*.mdx.
  local writer_work_dir
  writer_work_dir="$(tribunal_llm_work_dir)"
  tribunal_codex_exec "$writer_work_dir" "tribunal-writer" "$writer_prompt" > "$writer_out" 2>&1 || writer_rc=$?
  rm -rf "$writer_work_dir"
  if [ "$writer_rc" -ne 0 ]; then
    tlog "  WARN: final build repair writer exited with code $writer_rc"
    tail -10 "$writer_out" | while IFS= read -r line; do tlog "    $line"; done
    rm -f "$writer_out"
    return 1
  fi
  rm -f "$writer_out"

  cheap_validate_writer_rewrite "$post_file" "$en_existed_before"
}

run_final_build_gate() {
  local post_file="$1"
  local max_repairs=2
  local repair_attempt=0
  local build_log build_rc classification
  build_log="$(mktemp /tmp/tribunal-final-build-XXXXXX.log)"

  while true; do
    : > "$build_log"
    build_rc=0
    run_final_build_once "$build_log" || build_rc=$?
    if [ "$build_rc" -eq 0 ]; then
      rm -f "$build_log"
      return 0
    fi

    classification="$(classify_build_failure "$build_rc" "$build_log" "$post_file")"
    tlog "Final build failure classified as: $classification (rc=$build_rc)"
    if [ "$classification" = "operational" ]; then
      tlog "Final build failed due to likely operational/resource issue; not invoking writer repair."
      revert_writer_rewrite_files "$post_file"
      rm -f "$build_log"
      return 1
    fi
    if [ "$classification" != "actionable" ]; then
      tlog "Final build failure is not clearly content-actionable; failing safely without PASS."
      revert_writer_rewrite_files "$post_file"
      rm -f "$build_log"
      return 1
    fi
    if [ "$repair_attempt" -ge "$max_repairs" ]; then
      tlog "Final build repair attempts exhausted ($max_repairs); failing without PASS."
      revert_writer_rewrite_files "$post_file"
      rm -f "$build_log"
      return 1
    fi

    repair_attempt=$((repair_attempt + 1))
    if ! repair_final_build_failure "$post_file" "$build_log" "$repair_attempt"; then
      tlog "Final build repair attempt $repair_attempt failed cheap validation; failing without PASS."
      revert_writer_rewrite_files "$post_file"
      rm -f "$build_log"
      return 1
    fi
  done
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
core = [dims.get(k, 0) for k in ('accuracy', 'fidelity', 'consistency')]
core_composite = math.floor(sum(core) / len(core))
source_boundary = dims.get('sourceBoundary', 0)
commentary_separation = dims.get('commentarySeparation', 0)
sys.exit(0 if core_composite >= 8 and source_boundary >= 8 and commentary_separation >= 8 else 1)
PY
      ;;
    fresh-eyes)
      python3 - "$json_file" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
dims = data.get('dimensions', {})
vals = [dims.get(k, 0) for k in ('readability', 'firstImpression', 'payoffDensity', 'lengthFit')]
composite = math.floor(sum(vals) / len(vals))
# FreshEyes length/readability dimensions are non-compensating: a flashy hook
# must not hide low payoff density or bad length fit.
sys.exit(0 if composite >= 8 and dims.get('payoffDensity', 0) >= 8 and dims.get('lengthFit', 0) >= 8 else 1)
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
# Args: stage_key, agent_name, validate_name, label, max_loops, runner_label, post_file
# Returns: 0 = stage passed, 1 = stage failed (max loops exhausted)
run_stage() {
  local stage_key="$1"    # progress key: librarian, factChecker, freshEyes, vibe
  local agent_name="$2"   # agent name: librarian, fact-checker, fresh-eyes, vibe-opus-scorer
  local validate_name="$3" # validate name: librarian, fact-checker, fresh-eyes, vibe-opus-scorer
  local label="$4"        # human label: Librarian, FactChecker, FreshEyes, VibeScorer
  local max_loops="$5"    # 2 or 3
  local runner_label="$6"  # Codex runner label for logging/progress/frontmatter
  local post_file="$7"
  local fm_judge_key="${8:-}" # frontmatter scores key: librarian, factCheck, freshEyes, vibe

  local post_path="$ROOT_DIR/src/content/posts/$post_file"

  # Tribunal v8 executes every stage through Codex/GPT-5.5. Agent specs are
  # prompt contracts; the runtime model comes from this runner.
  local model_id="gpt-5.5"

  # ── Crash resume: skip already-passed stages ──
  local existing_status
  existing_status="$(get_stage_status "$post_file" "$stage_key")"
  if [ "$existing_status" = "pass" ]; then
    tlog "  Stage '$label' already PASS (crash resume). Skipping."
    return 0
  fi

  tlog "=== Stage $label ($runner_label) | max_loops=$max_loops ==="

  # Load scoring SSOT once (included in writer prompt)
  local ssot_content
  ssot_content="$(cat "$ROOT_DIR/scripts/vibe-scoring-standard.md")"

  local score_tmp
  score_tmp="$(mktemp /tmp/tribunal-${stage_key}-XXXXXX.json)"

  local attempt=0
  while [ "$attempt" -lt "$max_loops" ]; do
    attempt=$((attempt + 1))
    tlog "  $label attempt $attempt/$max_loops..."

    write_stage_progress "$post_file" "$stage_key" "in_progress" "null" "$runner_label" "$attempt"

    # ── Invoke judge ─────────────────────────────────────────────────────────
    local judge_out
    judge_out="$(mktemp)"

    local stage_timeout
    if [ -n "${TRIBUNAL_CODEX_TIMEOUT_SEC:-}" ]; then
      stage_timeout="$TRIBUNAL_CODEX_TIMEOUT_SEC"
    elif [ "$stage_key" = "librarian" ]; then
      # Librarian intentionally gets a longer wall clock: it is the stage that
      # reasons over prior posts/dedup/cross-links. The deterministic packet
      # below keeps Codex from spending that time on repo discovery.
      stage_timeout="${TRIBUNAL_LIBRARIAN_TIMEOUT_SEC:-3600}"
    else
      stage_timeout="${TRIBUNAL_JUDGE_TIMEOUT_SEC:-3600}"
    fi
    tlog "  Invoking Codex agent-spec '$agent_name' (runtime model '$model_id', timeout ${stage_timeout}s)..."

    local judge_rc=0 judge_task librarian_packet
    judge_task="Score this post: $ROOT_DIR/src/content/posts/$post_file
Write your JSON result to: SCORE_PATH_PLACEHOLDER"
    local calibration_ref
    calibration_ref="$ROOT_DIR/.codex/agents/references/sp-187-v7-false-positive.md"
    if [ -f "$calibration_ref" ]; then
      judge_task="$(cat <<PROMPT
$judge_task

## Tribunal v8 calibration reference
Read this if the current stage is Librarian, FreshEyes, Vibe, or Writer-adjacent reasoning:
$calibration_ref

It records the exact git commit/blob for the rejected SP-187 false-positive sample and CP-179 overlap target. Use it to calibrate responsibility boundaries; do not treat it as a request to rewrite unless the runner explicitly enables rewrite.
PROMPT
)"
    fi

    if [ "$stage_key" = "vibe" ]; then
      local jingjing_output jingjing_rc
      jingjing_rc=0
      jingjing_output="$(node "$SCRIPT_DIR/check-jingjing.mjs" "$post_path" 2>&1)" || jingjing_rc=$?
      judge_task="$(cat <<PROMPT
Score this post: $ROOT_DIR/src/content/posts/$post_file
Write your JSON result to: SCORE_PATH_PLACEHOLDER

## Deterministic evidence packet
Use this packet first. Do not invent a separate zh-tw decorative-English / 晶晶體 lint policy.

### 晶晶體 checker
Command: node scripts/check-jingjing.mjs src/content/posts/$post_file
Exit code: $jingjing_rc

\`\`\`
$jingjing_output
\`\`\`

If the checker exit code is 0, do not penalize allowlisted engineering terms such as \`vs\`, \`bug\`, \`commit\`, \`PR\`, model names, tool names, or glossary terms as hard-policy 晶晶體 hits.
PROMPT
)"
    fi
    if [ "$stage_key" = "librarian" ]; then
      librarian_packet="$(python3 "$SCRIPT_DIR/tribunal-librarian-packet.py" "$post_file")"
      judge_task="$(cat <<PROMPT
Score this post: $ROOT_DIR/src/content/posts/$post_file
Write your JSON result to: SCORE_PATH_PLACEHOLDER

## Deterministic evidence packet
The harness already scanned glossary terms, internal links, and similar old posts. Use this packet first. Do not rescan the whole repo unless this evidence is clearly insufficient.

$librarian_packet
PROMPT
)"
    fi
    # Spawn from a tmp work-dir (NOT the repo) so Codex gets only the agent
    # contract + task prompt. Score JSON path stays inside work-dir, then moves
    # back to score_tmp after the run finishes.
    local judge_work_dir
    judge_work_dir="$(tribunal_llm_work_dir)"
    local judge_score_in_work="$judge_work_dir/score.json"
    judge_task="${judge_task/SCORE_PATH_PLACEHOLDER/$judge_score_in_work}"
    TRIBUNAL_CODEX_TIMEOUT_SEC="$stage_timeout" tribunal_codex_exec_watchdog "$judge_work_dir" "$agent_name" "$judge_task" "$judge_out" "$judge_score_in_work" || judge_rc=$?

    if [ -f "$judge_score_in_work" ]; then
      mv "$judge_score_in_work" "$score_tmp"
    fi
    rm -rf "$judge_work_dir"

    if [ "$judge_rc" -ne 0 ]; then
      tlog "  WARN: Agent '$agent_name' exited with code $judge_rc"
      if [ -s "$judge_out" ]; then
        head -5 "$judge_out" | while IFS= read -r line; do tlog "    $line"; done
      fi
    fi
    rm -f "$judge_out"

    # ── Validate score JSON ───────────────────────────────────────────────────
    if ! validate_judge_score_json "$validate_name" "$score_tmp"; then
      tlog "  ERROR: Invalid/missing $label score JSON schema on attempt $attempt; treating as runner infrastructure failure."
      if [ -f "$score_tmp" ]; then
        local raw
        raw="$(head -3 "$score_tmp" 2>/dev/null | tr '\n' ' ')"
        tlog "  Raw (head): $raw"
      fi
      mark_article_runner_error "$post_file" "$stage_key" "$runner_label" "$attempt" "invalid_or_missing_score_json"
      rm -f "$score_tmp"
      return 70
    fi

    local score_json composite verdict
    score_json="$(cat "$score_tmp")"
    if [ -n "${TRIBUNAL_SCORE_OUTPUT:-}" ]; then
      cp "$score_tmp" "$TRIBUNAL_SCORE_OUTPUT"
    fi
    composite="$(jq -r '.score // 0' "$score_tmp")"
    verdict="$(jq -r '.verdict // "FAIL"' "$score_tmp")"
    tlog "  $label result: composite=$composite agent_verdict=$verdict"

    # ── Check pass bar (code wins over agent verdict) ─────────────────────────
    if check_pass_bar "$validate_name" "$score_tmp"; then
      tlog "  PASS: $label passed on attempt $attempt"
      write_stage_progress "$post_file" "$stage_key" "pass" "$score_json" "$runner_label" "$attempt"

      # ── Write score to post frontmatter (tribunal badge) ──
      if [ -n "$fm_judge_key" ] && [ "$WRITE_FRONTMATTER" -eq 1 ]; then
        local fm_score_json fm_model judge_reported_model
        # Programmatic model — never trust judge self-report (judges hallucinate their own model ID)
        fm_model="$model_id"
        judge_reported_model="$(jq -r '.judge_model // empty' "$score_tmp")"
        if [ -n "$judge_reported_model" ]; then
          if [ "$judge_reported_model" != "$fm_model" ]; then
            tlog "  WARN: Model mismatch — expected=$fm_model, judge_self_report=$judge_reported_model"
          else
            tlog "  Model confirmed: judge agrees with expected=$fm_model"
          fi
        fi
        fm_score_json="$(jq --arg model "$fm_model" '. + {model: $model}' "$score_tmp")"
        tlog "  Writing $fm_judge_key score to frontmatter (model=$fm_model)..."
        if write_score_to_frontmatter "$post_path" "$fm_judge_key" "$fm_score_json"; then
          tlog "  Frontmatter updated for $fm_judge_key."
        else
          tlog "  ERROR: Failed to write $fm_judge_key score to frontmatter."
          rm -f "$score_tmp"
          return 1
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
      write_stage_progress "$post_file" "$stage_key" "fail" "$score_json" "$runner_label" "$attempt"
      rm -f "$score_tmp"
      return 1
    fi

    if [ "$ALLOW_REWRITE" != "1" ]; then
      tlog "  Rewrite disabled for this run (judge-only/--only-stage default). FAIL without invoking tribunal-writer."
      write_stage_progress "$post_file" "$stage_key" "fail" "$score_json" "$runner_label" "$attempt"
      rm -f "$score_tmp"
      return 1
    fi

    # ── Rewrite: invoke tribunal-writer (timeout 900s / 15 min) ──────────────
    tlog "  Invoking tribunal-writer for rewrite (timeout 900s)..."

    local writer_prompt writer_out writer_rc en_existed_before
    if [ -f "src/content/posts/en-$post_file" ]; then
      en_existed_before=1
    else
      en_existed_before=0
    fi
    local pre_rewrite_post_snapshot pre_rewrite_en_snapshot
    pre_rewrite_post_snapshot="$(mktemp)"
    cp "src/content/posts/$post_file" "$pre_rewrite_post_snapshot"
    pre_rewrite_en_snapshot=""
    if [ -f "src/content/posts/en-$post_file" ]; then
      pre_rewrite_en_snapshot="$(mktemp)"
      cp "src/content/posts/en-$post_file" "$pre_rewrite_en_snapshot"
    fi

    writer_prompt="$(cat <<PROMPT
You are the tribunal-writer for gu-log. The $label judge reviewed this post and it FAILED.

## Repo root
$ROOT_DIR

## Post to rewrite
$ROOT_DIR/src/content/posts/$post_file

## EN counterpart, if present
$ROOT_DIR/src/content/posts/en-$post_file

## Judge Feedback (JSON)
$score_json

## Scoring Standard (SSOT — read this carefully before rewriting)
$ssot_content

## Task
1. Use absolute paths under the Repo root above; this Codex process runs from a temp directory, not the repo root.
2. Read $ROOT_DIR/src/content/posts/$post_file and $ROOT_DIR/GU-LOG_WRITER_PROMPT.md.
3. Read the judge feedback JSON above — identify every dimension that scored below 8.
4. Rewrite the post to fix those specific failures. Write it back in-place.
5. Also rewrite the EN counterpart at $ROOT_DIR/src/content/posts/en-$post_file if it exists and the same fix applies.
6. Inspect your diff before finishing. Do not run tribunal, judge agents, or any quota-burning model calls from inside this rewrite.

Follow $ROOT_DIR/GU-LOG_WRITER_PROMPT.md and $ROOT_DIR/CONTRIBUTING.md frontmatter schema.
Do NOT change frontmatter fields (title, ticketId, dates, sourceUrl). Preserve MDX components, URLs, source attribution, and already-passing dimensions unless the judge feedback explicitly targets them.
PROMPT
)"
    writer_out="$(mktemp)"
    writer_rc=0

    # Writer reads the full post + judge feedback + scoring SSOT through Codex.
    # Spawn from tmp work-dir to keep prompt context isolated.
    local rewrite_work_dir
    rewrite_work_dir="$(tribunal_llm_work_dir)"
    tribunal_codex_exec "$rewrite_work_dir" "tribunal-writer" "$writer_prompt" > "$writer_out" 2>&1 || writer_rc=$?
    rm -rf "$rewrite_work_dir"

    if [ "$writer_rc" -ne 0 ]; then
      tlog "  WARN: tribunal-writer exited with code $writer_rc"
    fi
    rm -f "$writer_out"

    restore_scores_block_from_snapshot "$pre_rewrite_post_snapshot" "src/content/posts/$post_file"
    if [ -n "$pre_rewrite_en_snapshot" ]; then
      restore_scores_block_from_snapshot "$pre_rewrite_en_snapshot" "src/content/posts/en-$post_file"
    fi
    rm -f "$pre_rewrite_post_snapshot"
    if [ -n "$pre_rewrite_en_snapshot" ]; then
      rm -f "$pre_rewrite_en_snapshot"
    fi

    # ── Cheap validation after rewrite (full build is deferred to final gate) ─
    if ! cheap_validate_writer_rewrite "$post_file" "$en_existed_before"; then
      tlog "  ERROR: cheap validation failed after writer rewrite. Reverting changes."
      revert_writer_rewrite_files "$post_file"
    fi

    # Loop: re-score on next iteration
  done

  # Should never reach here (while condition handles all exits), but just in case:
  write_stage_progress "$post_file" "$stage_key" "fail" "null" "$runner_label" "$attempt"
  rm -f "$score_tmp"
  return 1
}

# ─── Commit Progress ──────────────────────────────────────────────────────────
# Phase 2 (tribunal-safe-parallelism):
#   - Serialized by push_lock so 2 workers don't race while staging/committing.
#   - Honors TRIBUNAL_MAIN_REPO env var: workers running in their own isolated
#     worktrees can update the coordinator repo's shared runtime ledger (flock
#     coordinates the read-modify-write; this function coordinates target-post
#     materialization + local git commit). Push is opt-in and direct main pushes
#     are refused.
commit_progress() {
  local msg="$1"
  if [ "${TRIBUNAL_NO_COMMIT:-0}" = "1" ]; then
    tlog "  TRIBUNAL_NO_COMMIT=1; skipping commit_progress: $msg"
    return 0
  fi
  local repo_dir="${TRIBUNAL_MAIN_REPO:-$ROOT_DIR}"
  (
    flock -x 10
    cd "$repo_dir" || { tlog "WARN: commit_progress cd $repo_dir failed"; exit 0; }

    # Workers rewrite posts and write score frontmatter inside their isolated
    # worktree ($ROOT_DIR). Publish those target post artifacts into the main
    # repo before staging, otherwise PASS commits only contain content-free
    # metadata and production content never changes.
    if [ -n "${POST_FILE:-}" ]; then
      bash "$SCRIPT_DIR/tribunal-publish-worker-changes.sh" "$ROOT_DIR" "$repo_dir" "$POST_FILE" >> "$LOG_FILE" 2>&1 || {
        tlog "ERROR: failed to publish worker post artifacts for $POST_FILE"
        exit 1
      }
    fi

    git add "$PROGRESS_FILE" 2>/dev/null || true
    if [ -n "${POST_FILE:-}" ]; then
      git add "src/content/posts/$POST_FILE" 2>/dev/null || true
      git add "src/content/posts/en-$POST_FILE" 2>/dev/null || true
    fi
    if git diff --cached --quiet; then
      exit 0  # nothing to commit
    fi
    if [[ "$msg" == *"all 4 stages PASS + final build"* ]]; then
      if ! bash "$SCRIPT_DIR/tribunal-assert-pass-artifacts.sh" "$repo_dir" "$POST_FILE" --staged >> "$LOG_FILE" 2>&1; then
        tlog "ERROR: Tribunal PASS artifact postcondition failed for $POST_FILE. Refusing progress-only PASS commit."
        exit 1
      fi
    fi
    git commit -m "$msg" >> "$LOG_FILE" 2>&1 || exit 0

    if [ "${TRIBUNAL_ALLOW_PUSH:-0}" != "1" ]; then
      tlog "  TRIBUNAL_ALLOW_PUSH is not set; leaving Tribunal commit local (no push)."
      exit 0
    fi

    local branch
    branch="$(git branch --show-current)"
    if [ "$branch" = "main" ]; then
      tlog "ERROR: refusing to direct-push main from Tribunal automation. Push a feature branch/PR instead."
      exit 1
    fi

    git push >> "$LOG_FILE" 2>&1 || tlog "WARN: git push failed (will retry on next run)"
  ) 10>>"$RC_PUSH_LOCK"
}

# ─── Prerequisites ────────────────────────────────────────────────────────────
for _cmd in jq python3 pnpm git flock timeout; do
  if ! command -v "$_cmd" >/dev/null 2>&1; then
    echo "ERROR: Required command missing: $_cmd" >&2
    exit 1
  fi
done
if ! tribunal_codex_cmd >/dev/null 2>&1; then
  echo "ERROR: Required Codex CLI missing: install codex or provide the bundled node entrypoint" >&2
  exit 70
fi
CODEX_VERSION="$(tribunal_codex_version || true)"
MIN_CODEX_VERSION="0.128.0"
if [ -z "$CODEX_VERSION" ] || ! tribunal_codex_version_at_least "$CODEX_VERSION" "$MIN_CODEX_VERSION"; then
  echo "ERROR: Codex CLI version $CODEX_VERSION is older than required $MIN_CODEX_VERSION; check tribunal service PATH" >&2
  exit 70
fi

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "ERROR: Git repository is mid-rebase. Resolve manually first." >&2
  exit 1
fi

ensure_score_dirs
ensure_progress_file
init_article_progress "$POST_FILE"

tlog "=== tribunal.sh: $POST_FILE ==="

# ─── Tribunal v8 Sequential Loop ──────────────────────────────────────────────
# Format: stage_key:agent_name:validate_name:label:max_loops:runner_label:fm_judge_key
# fm_judge_key = frontmatter scores key (used by frontmatter-scores.mjs)
declare -a STAGES=(
  "factChecker:fact-checker:fact-checker:FactChecker:2:codex-gpt-5.5-medium:factCheck"
  "librarian:librarian:librarian:Librarian:2:codex-gpt-5.5-medium:librarian"
  "freshEyes:fresh-eyes:fresh-eyes:FreshEyes:2:codex-gpt-5.5-medium:freshEyes"
  "vibe:vibe-opus-scorer:vibe-opus-scorer:VibeScorer:3:codex-gpt-5.5-medium:vibe"
)

for stage_def in "${STAGES[@]}"; do
  IFS=':' read -r stage_key agent_name validate_name label max_loops runner_label fm_judge_key <<< "$stage_def"

  if [ -n "$ONLY_STAGE" ] && [ "$stage_key" != "$ONLY_STAGE" ]; then
    tlog "  Skipping stage '$label' due to --only-stage=$ONLY_STAGE."
    continue
  fi

  stage_rc=0
  run_stage \
    "$stage_key" "$agent_name" "$validate_name" "$label" \
    "$max_loops" "$runner_label" "$POST_FILE" "$fm_judge_key" || stage_rc=$?
  if [ "$stage_rc" -eq 70 ]; then
    tlog "=== RUNNER ERROR at stage: $label ==="
    commit_progress "tribunal(${POST_FILE%.mdx}): RUNNER_ERROR at $label stage"
    exit 70
  elif [ "$stage_rc" -ne 0 ]; then
    tlog "=== FAILED at stage: $label ==="
    mark_article_failed "$POST_FILE" "$stage_key"
    commit_progress "tribunal(${POST_FILE%.mdx}): FAILED at $label stage"
    exit 1
  fi
done

if [ -n "$ONLY_STAGE" ]; then
  tlog "=== ONLY STAGE PASSED: $ONLY_STAGE for $POST_FILE ==="
  commit_progress "tribunal(${POST_FILE%.mdx}): ${ONLY_STAGE} stage PASS"
  tlog "Done. Log: $LOG_FILE"
  exit 0
fi

tlog "=== ALL 4 STAGES PASSED: $POST_FILE ==="
if ! run_final_build_gate "$POST_FILE"; then
  tlog "=== FAILED at final build gate: $POST_FILE ==="
  mark_article_failed "$POST_FILE" "finalBuild"
  commit_progress "tribunal(${POST_FILE%.mdx}): FAILED at final build gate"
  exit 1
fi

mark_article_passed "$POST_FILE"
commit_progress "tribunal(${POST_FILE%.mdx}): all 4 stages PASS + final build"
tlog "Done. Log: $LOG_FILE"
