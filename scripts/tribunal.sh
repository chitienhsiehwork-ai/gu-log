#!/usr/bin/env bash
# tribunal.sh — Sequential Tribunal runner
#
# Stages (in order):
#   1. Fact Check  — source/commentary + fact gates, max 2 loops
#   2. Librarian   — corpus/glossary/source gate,     max 2 loops
#   3. Fresh Eyes  — first-reader gate,               max 2 loops
#   4. Vibe Scorer — taste/rhythm gate,               max 3 loops
#
# Provider/model routing is resolved at runtime and recorded per stage. This
# header is an overview, not selector configuration.
#
# Usage:
#   bash scripts/tribunal.sh [--only-stage <factChecker|librarian|freshEyes|vibe>] [--allow-rewrite] [--no-commit] <filename.mdx>
#   bash scripts/tribunal.sh --score-only --only-stage vibe <filename.mdx>
#
# Standalone mode: bash scripts/tribunal.sh gp-123-date-slug.mdx
# Single-stage mode is judge-only by default: it scores and may update progress,
# but it will not invoke tribunal-writer unless --allow-rewrite is explicit.
# --score-only is fully non-mutating: no rewrite, no frontmatter, no commit.
# On crash resume: re-run same command; completed stages are skipped.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
TRIBUNAL_RESUME_COMMAND="$(printf '%q ' "$0" "$@")"
export TRIBUNAL_RESUME_COMMAND="${TRIBUNAL_RESUME_COMMAND% }"

# shellcheck source=scripts/score-helpers.sh
source "$SCRIPT_DIR/score-helpers.sh"

# shellcheck source=scripts/tribunal-helpers.sh
source "$SCRIPT_DIR/tribunal-helpers.sh"

# Graceful stop helpers — file-flag only channel (no traps here; parent
# loop owns signals and writes the flag file on stop).
export RC_ROOT_DIR="$ROOT_DIR"
# shellcheck source=scripts/tribunal-run-control.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/tribunal-run-control.sh"

if ! TRIBUNAL_VERSION="$(node "$SCRIPT_DIR/tribunal-version.mjs" current 2>/dev/null)"; then
  echo "ERROR: invalid Tribunal version: could not read scripts/tribunal-version.mjs" >&2
  exit 78
fi
case "$TRIBUNAL_VERSION" in
  ''|*[!0-9]*)
    echo "ERROR: invalid Tribunal version: ${TRIBUNAL_VERSION:-<empty>}" >&2
    exit 78
    ;;
esac
if [ "$TRIBUNAL_VERSION" -lt 1 ]; then
  echo "ERROR: invalid Tribunal version: $TRIBUNAL_VERSION" >&2
  exit 78
fi

# ─── Args ─────────────────────────────────────────────────────────────────────
ONLY_STAGE=""
POST_FILE=""
ALLOW_REWRITE=""
WRITE_FRONTMATTER=1
SCORE_ONLY=0
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
  local msg
  msg="[$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z')] [tribunal] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Lock ─────────────────────────────────────────────────────────────────────
# Exit code 75 = skipped (another instance is already running this article).
# Callers (batch-runner, quota-loop, Phase 2 supervisor) must treat this as
# "skipped", NOT as "passed" — otherwise stats are misleading. Chosen value:
# 75 matches sysexits.h EX_TEMPFAIL ("temporary failure, retry later") which
# is the closest stdlib semantic match.
ARTICLE_LOCK_DIR_IS_DEFAULT=0
if [ -n "${TRIBUNAL_ARTICLE_LOCK_DIR:-}" ]; then
  ARTICLE_LOCK_DIR="$TRIBUNAL_ARTICLE_LOCK_DIR"
else
  if [ -z "${HOME:-}" ]; then
    echo "[tribunal] HOME is required to resolve the private article lock directory (rc=70)." >&2
    exit 70
  fi
  ARTICLE_LOCK_DIR="$HOME/.local/state/gu-log/tribunal/article-locks"
  ARTICLE_LOCK_DIR_IS_DEFAULT=1
fi

tribunal_lock_path_uid() {
  if stat -c '%u' "$1" >/dev/null 2>&1; then
    stat -c '%u' "$1"
  else
    stat -f '%u' "$1"
  fi
}

tribunal_lock_path_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

if [ -L "$ARTICLE_LOCK_DIR" ]; then
  echo "[tribunal] article lock directory must not be a symbolic link: $ARTICLE_LOCK_DIR (rc=70)." >&2
  exit 70
fi
if ! (umask 077 && mkdir -p "$ARTICLE_LOCK_DIR"); then
  echo "[tribunal] cannot create article lock directory: $ARTICLE_LOCK_DIR (rc=70)." >&2
  exit 70
fi
if [ -L "$ARTICLE_LOCK_DIR" ] || [ ! -d "$ARTICLE_LOCK_DIR" ]; then
  echo "[tribunal] article lock path is not a safe directory: $ARTICLE_LOCK_DIR (rc=70)." >&2
  exit 70
fi
ARTICLE_LOCK_UID="$(tribunal_lock_path_uid "$ARTICLE_LOCK_DIR" 2>/dev/null || true)"
CURRENT_UID="$(id -u)"
if [ "$ARTICLE_LOCK_UID" != "$CURRENT_UID" ]; then
  echo "[tribunal] article lock directory must be owned by uid $CURRENT_UID: $ARTICLE_LOCK_DIR (rc=70)." >&2
  exit 70
fi
if [ "$ARTICLE_LOCK_DIR_IS_DEFAULT" -eq 1 ]; then
  if ! chmod 700 "$ARTICLE_LOCK_DIR"; then
    echo "[tribunal] cannot secure article lock directory: $ARTICLE_LOCK_DIR (rc=70)." >&2
    exit 70
  fi
else
  ARTICLE_LOCK_MODE="$(tribunal_lock_path_mode "$ARTICLE_LOCK_DIR" 2>/dev/null || true)"
  if [ -z "$ARTICLE_LOCK_MODE" ] || (( (8#$ARTICLE_LOCK_MODE) & 0022 )); then
    echo "[tribunal] article lock directory must not be group/world-writable: $ARTICLE_LOCK_DIR (rc=70)." >&2
    exit 70
  fi
fi

LOCK_FILE="$ARTICLE_LOCK_DIR/tribunal-${POST_FILE}.lock"
if [ -L "$LOCK_FILE" ] || { [ -e "$LOCK_FILE" ] && [ ! -f "$LOCK_FILE" ]; }; then
  echo "[tribunal] article lock path is not a safe regular file: $LOCK_FILE (rc=70)." >&2
  exit 70
fi
if [ -e "$LOCK_FILE" ]; then
  ARTICLE_LOCK_FILE_UID="$(tribunal_lock_path_uid "$LOCK_FILE" 2>/dev/null || true)"
  if [ "$ARTICLE_LOCK_FILE_UID" != "$CURRENT_UID" ]; then
    echo "[tribunal] article lock file must be owned by uid $CURRENT_UID: $LOCK_FILE (rc=70)." >&2
    exit 70
  fi
fi
ARTICLE_LOCK_UMASK="$(umask)"
umask 077
if ! { exec 200>>"$LOCK_FILE"; }; then
  umask "$ARTICLE_LOCK_UMASK"
  echo "[tribunal] cannot open article lock file: $LOCK_FILE (rc=70)." >&2
  exit 70
fi
umask "$ARTICLE_LOCK_UMASK"
if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || ! chmod 600 "$LOCK_FILE"; then
  echo "[tribunal] article lock file failed safety validation: $LOCK_FILE (rc=70)." >&2
  exit 70
fi
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
    PROGRESS_FILE="$(mktemp "${TMPDIR:-/tmp}/tribunal-score-only-progress.XXXXXX")"
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
# article before we give up. Prevents gp-94-style 11-round FactChecker burn
# where quota-loop kept re-picking a FAILED article until it happened to pass.
MAX_TOP_ATTEMPTS=5

init_article_progress() {
  local article="$1"
  local article_progress_result="continue"
  # Entire init + attempts increment + cap check runs under a single
  # flock so two workers can't both see attempts=N and both bump to N+1.
  {
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
      article_progress_result="exhausted"
    fi
  } 9>>"$RC_PROGRESS_LOCK"

  # The result is invocation-local: a concurrent article must never consume
  # another article's EXHAUSTED result after the shared progress lock releases.
  if [ "$article_progress_result" = "exhausted" ]; then
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

ensure_article_runner_error_checkpoint() {
  local article="$1" failed_stage="$2" model="$3" attempts="$4" reason="$5"
  local existing_status existing_stage_status
  existing_status="$(jq -r --arg a "$article" '.[$a].status // empty' "$PROGRESS_FILE")"
  existing_stage_status="$(
    jq -r --arg a "$article" --arg s "$failed_stage" \
      '.[$a].stages[$s].status // empty' "$PROGRESS_FILE"
  )"
  if [ "$existing_status" != "RUNNER_ERROR" ] ||
     [ "$existing_stage_status" != "runner_error" ]; then
    if ! mark_article_runner_error \
      "$article" "$failed_stage" "$model" "$attempts" "$reason"; then
      tlog "  ERROR: failed to persist the fallback RUNNER_ERROR checkpoint."
      return 1
    fi
  fi
  if ! jq -e --arg a "$article" --arg s "$failed_stage" \
    '.[$a].status == "RUNNER_ERROR"
     and .[$a].stages[$s].status == "runner_error"' \
    "$PROGRESS_FILE" >/dev/null; then
    tlog "  ERROR: RUNNER_ERROR ledger postcondition failed."
    return 1
  fi
  tlog "  RUNNER_ERROR is durable in $PROGRESS_FILE; article artifacts are intentionally not published."
  return 0
}

mark_article_quota_suspended() {
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
       '.[$a].status = "QUOTA_SUSPENDED"
        | .[$a].failedStage = $s
        | .[$a].finishedAt = $ts
        | .[$a].tribunalVersion = $tribunalVersion
        | .[$a].topLevelAttempts = (.[$a].topLevelAttempts // 0)
        | .[$a].stages[$s] = {
            status: "quota_suspended",
            score: null,
            model: $model,
            attempts: $attempts,
            tribunalVersion: $tribunalVersion,
            error: $reason
          }' \
       "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  ) 9>>"$RC_PROGRESS_LOCK"
}

quota_status_summary() {
  local file="$1"
  if [ ! -s "$file" ]; then
    printf 'quota exhausted; resume with: %s' "${TRIBUNAL_RESUME_COMMAND:-rerun the same tribunal command}"
    return 0
  fi
  local provider tier reset_seconds reason resume
  provider="$(sed -n 's/^provider=//p' "$file" | head -1)"
  tier="$(sed -n 's/^tier=//p' "$file" | head -1)"
  reset_seconds="$(sed -n 's/^reset_seconds=//p' "$file" | head -1)"
  reason="$(sed -n 's/^reason=//p' "$file" | head -1)"
  resume="$(sed -n 's/^resume_command=//p' "$file" | head -1)"
  printf 'provider=%s tier=%s reset_seconds=%s reason=%s resume=%s' \
    "${provider:-unknown}" "${tier:-unknown}" "${reset_seconds:-0}" \
    "${reason:-quota exhausted}" "${resume:-${TRIBUNAL_RESUME_COMMAND:-rerun the same tribunal command}}"
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
  # VALIDATE_PARTIAL_SCORES=1: mid-tribunal the later stages (freshEyes/vibe)
  # have not scored yet, so block *presence* must not fail cheap validation.
  # Present blocks are still fully structure-checked; the deploy gate stays strict.
  if ! VALIDATE_PARTIAL_SCORES=1 node scripts/validate-posts.mjs "${validate_paths[@]}" >> "$LOG_FILE" 2>&1; then
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

cheap_validate_writer_candidate() {
  local candidate_dir="$1" post_file="$2" en_existed_before="$3"
  local candidate_zh="$candidate_dir/$post_file"
  local candidate_en="$candidate_dir/en-$post_file"
  local validate_paths=("$candidate_zh")
  if [ "$en_existed_before" = "1" ]; then
    validate_paths+=("$candidate_en")
  fi

  tlog "  Validating isolated writer candidate before canonical apply..."
  if ! VALIDATE_PARTIAL_SCORES=1 \
    node scripts/validate-posts.mjs "${validate_paths[@]}" \
      >>"$LOG_FILE" 2>&1; then
    tlog "  ERROR: validate-posts rejected the isolated writer candidate."
    return 1
  fi
  return 0
}

discard_writer_rewrite_snapshot() {
  local snapshot_token="$1"
  if ! tribunal_post_pair_snapshot_discard "$snapshot_token"; then
    tlog "  WARN: could not remove the successful writer rewrite snapshot."
  fi
}

restore_writer_rewrite_snapshot() {
  local post_path="$1"
  local snapshot_token="$2"
  local expected_candidate_token="$3"

  if ! tribunal_post_pair_candidate_rollback \
    "$post_path" "$snapshot_token" "$expected_candidate_token"; then
    local durable_recovery_path
    durable_recovery_path="$(
      tribunal_post_pair_snapshot_persist_recovery "$snapshot_token" || true
    )"
    WRITER_TRANSACTION_RECOVERY_PATH="$durable_recovery_path"
    if [ -n "$durable_recovery_path" ]; then
      tlog "  ERROR: writer rewrite CAS rollback failed; canonical edit preserved; durable recovery token: $durable_recovery_path"
    else
      tlog "  ERROR: writer rewrite CAS rollback failed; canonical edit preserved; durable token persistence also failed."
    fi
    return 70
  fi
  discard_writer_rewrite_snapshot "$snapshot_token"
  return 0
}

WRITER_TRANSACTION_SNAPSHOT_TOKEN=""
WRITER_TRANSACTION_CANDIDATE_TOKEN=""
WRITER_TRANSACTION_EN_EXISTED=0
WRITER_TRANSACTION_RECOVERY_PATH=""
WRITER_TRANSACTION_APPLY_UNCERTAIN=0

# Run the routed writer against private candidate files, never the canonical
# post paths. The subprocess gets a workspace-write sandbox rooted at its temp
# workdir; the parent then reads stable candidate bytes and applies them only
# if the canonical bilingual pair still exactly matches the captured baseline.
run_writer_candidate_transaction() {
  local post_path="$1"
  local post_file="$2"
  local stage="$3"
  local attempt="$4"
  local prompt_template="$5"
  local writer_out="$6"
  local quota_status_file="$7"
  local snapshot_token snapshot_rc writer_work_dir writer_prompt writer_rc
  local candidate_token candidate_capture_rc validation_work_dir apply_rc
  local actual_provider_file actual_writer_provider actual_writer_model
  local actual_writer_runner

  WRITER_TRANSACTION_SNAPSHOT_TOKEN=""
  WRITER_TRANSACTION_CANDIDATE_TOKEN=""
  WRITER_TRANSACTION_EN_EXISTED=0
  WRITER_TRANSACTION_RECOVERY_PATH=""
  WRITER_TRANSACTION_APPLY_UNCERTAIN=0

  case "$(tribunal_writer_mode)" in
    codex|grok) ;;
    *)
      tlog "  RUNNER ERROR: isolated writer transactions require GP_WRITER_MODE=codex or grok."
      return 70
      ;;
  esac
  if [ -f "$ROOT_DIR/src/content/posts/en-$post_file" ]; then
    WRITER_TRANSACTION_EN_EXISTED=1
  fi

  snapshot_rc=0
  snapshot_token="$(tribunal_post_pair_snapshot_create "$post_path")" ||
    snapshot_rc=$?
  if [ "$snapshot_rc" -ne 0 ] || [ -z "$snapshot_token" ]; then
    tlog "  RUNNER ERROR: could not snapshot the validated post state before isolated writer execution."
    return 70
  fi

  writer_work_dir="$(tribunal_writer_work_dir)"
  if ! tribunal_post_pair_candidate_materialize \
    "$writer_work_dir" "$snapshot_token" >>"$writer_out" 2>&1; then
    tlog "  RUNNER ERROR: could not materialize the private writer candidate."
    discard_writer_rewrite_snapshot "$snapshot_token"
    rm -rf "$writer_work_dir"
    return 70
  fi

  writer_prompt="${prompt_template//TRIBUNAL_CANDIDATE_ZH_PATH/$writer_work_dir/$post_file}"
  writer_prompt="${writer_prompt//TRIBUNAL_CANDIDATE_EN_PATH/$writer_work_dir/en-$post_file}"
  actual_provider_file="$(mktemp)"
  writer_rc=0
  TRIBUNAL_QUOTA_STATUS_FILE="$quota_status_file" \
    TRIBUNAL_ACTUAL_PROVIDER_FILE="$actual_provider_file" \
    TRIBUNAL_WRITER_POST_FILE="$post_file" \
    TRIBUNAL_WRITER_STAGE="$stage" \
    TRIBUNAL_WRITER_ATTEMPT="$attempt" \
    tribunal_writer_exec \
      "$writer_work_dir" "tribunal-writer" "$writer_prompt" \
      >>"$writer_out" 2>&1 || writer_rc=$?

  if [ "$writer_rc" -ne 0 ]; then
    discard_writer_rewrite_snapshot "$snapshot_token"
    rm -rf "$writer_work_dir"
    rm -f "$actual_provider_file"
    return "$writer_rc"
  fi
  actual_writer_provider="$(
    sed -n 's/^provider=//p' "$actual_provider_file" | head -1
  )"
  actual_writer_model="$(
    sed -n 's/^model_id=//p' "$actual_provider_file" | head -1
  )"
  actual_writer_runner="$(
    sed -n 's/^runner_label=//p' "$actual_provider_file" | head -1
  )"
  rm -f "$actual_provider_file"
  if [ "$actual_writer_provider" != "codex" ] ||
     [ -z "$actual_writer_model" ] ||
     [ -z "$actual_writer_runner" ]; then
    tlog "  RUNNER ERROR: tribunal-writer did not record complete Codex provider/model provenance."
    discard_writer_rewrite_snapshot "$snapshot_token"
    rm -rf "$writer_work_dir"
    return 70
  fi
  tlog "  Actual writer provider: $actual_writer_provider (runtime model '$actual_writer_model', runner '$actual_writer_runner')"

  candidate_capture_rc=0
  candidate_token="$(
    tribunal_post_pair_candidate_capture \
      "$writer_work_dir" "$snapshot_token" 2>>"$writer_out"
  )" || candidate_capture_rc=$?
  rm -rf "$writer_work_dir"
  if [ "$candidate_capture_rc" -ne 0 ] || [ -z "$candidate_token" ]; then
    tlog "  ERROR: could not capture a stable isolated writer candidate."
    discard_writer_rewrite_snapshot "$snapshot_token"
    return 1
  fi

  # Validate and apply a parent-materialized copy of the captured bytes. Any
  # setsid-escaped writer descendant only knows the now-removed writer path and
  # cannot race this immutable parent handoff.
  validation_work_dir="$(tribunal_writer_work_dir)"
  if ! tribunal_post_pair_candidate_materialize \
    "$validation_work_dir" "$candidate_token" >>"$writer_out" 2>&1; then
    discard_writer_rewrite_snapshot "$snapshot_token"
    rm -rf "$validation_work_dir"
    return 70
  fi
  if ! cheap_validate_writer_candidate \
    "$validation_work_dir" "$post_file" "$WRITER_TRANSACTION_EN_EXISTED"; then
    discard_writer_rewrite_snapshot "$snapshot_token"
    rm -rf "$validation_work_dir"
    return 1
  fi

  apply_rc=0
  WRITER_TRANSACTION_APPLY_UNCERTAIN=1
  tribunal_post_pair_candidate_apply \
    "$post_path" "$validation_work_dir" "$snapshot_token" \
    >>"$writer_out" 2>&1 || apply_rc=$?
  rm -rf "$validation_work_dir"
  if [ "$apply_rc" -ne 0 ]; then
    # The apply helper may have rejected a concurrent canonical edit before
    # writing, or failed after a partial filesystem replacement. Never guess
    # which state is authoritative and never overwrite it here. Persist the
    # self-contained parent token for deterministic operator recovery.
    WRITER_TRANSACTION_RECOVERY_PATH="$(
      tribunal_post_pair_snapshot_persist_recovery "$snapshot_token" \
        2>>"$writer_out" || true
    )"
    if [ -n "$WRITER_TRANSACTION_RECOVERY_PATH" ]; then
      tlog "  RUNNER ERROR: candidate apply failed; durable recovery token: $WRITER_TRANSACTION_RECOVERY_PATH"
    else
      tlog "  RUNNER ERROR: candidate apply failed and durable recovery token persistence also failed."
    fi
    return 70
  fi
  WRITER_TRANSACTION_APPLY_UNCERTAIN=0

  WRITER_TRANSACTION_SNAPSHOT_TOKEN="$snapshot_token"
  WRITER_TRANSACTION_CANDIDATE_TOKEN="$candidate_token"
  return 0
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
  local evidence writer_prompt writer_out writer_rc en_existed_before writer_quota_status_file
  FINAL_BUILD_REPAIR_QUOTA_REASON=""
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

## Writable zh-tw candidate
TRIBUNAL_CANDIDATE_ZH_PATH

## Writable English candidate, if present
TRIBUNAL_CANDIDATE_EN_PATH

## Build failure evidence (tail)
$evidence

## Task
1. The Repo root is read-only reference material. Never edit a path under it.
2. Fix only content-actionable problems in TRIBUNAL_CANDIDATE_ZH_PATH.
3. Also update TRIBUNAL_CANDIDATE_EN_PATH if it exists and the same issue applies.
4. Inspect your diff before finishing. Do not run tribunal, judge agents, or any quota-burning model calls from inside this repair.
5. Do not rewrite unrelated content and do not change stable frontmatter fields unless the build error specifically requires it.
PROMPT
)"
  local writer_mode
  writer_mode="$(tribunal_writer_mode)"
  if [ "$writer_mode" = "none" ]; then
    tlog "  Rewrite skipped (GP_WRITER_MODE=none) during final build repair; failing without invoking tribunal-writer."
    return 1
  fi
  writer_out="$(mktemp)"
  writer_quota_status_file="$(mktemp)"
  writer_rc=0
  run_writer_candidate_transaction \
    "$ROOT_DIR/src/content/posts/$post_file" \
    "$post_file" "finalBuild" "$repair_attempt" "$writer_prompt" \
    "$writer_out" "$writer_quota_status_file" || writer_rc=$?
  if [ "$writer_rc" -eq 75 ]; then
    local writer_quota_reason
    writer_quota_reason="$(quota_status_summary "$writer_quota_status_file")"
    tlog "  QUOTA SUSPEND during final build repair writer: $writer_quota_reason"
    FINAL_BUILD_REPAIR_QUOTA_REASON="$writer_quota_reason"
    rm -f "$writer_out" "$writer_quota_status_file"
    return 75
  fi
  if [ "$writer_rc" -ne 0 ]; then
    tlog "  WARN: final build repair writer exited with code $writer_rc"
    tail -10 "$writer_out" | while IFS= read -r line; do tlog "    $line"; done
    rm -f "$writer_out" "$writer_quota_status_file"
    if [ "$writer_rc" -eq 70 ]; then
      return 70
    fi
    return 1
  fi
  rm -f "$writer_out" "$writer_quota_status_file"

  if cheap_validate_writer_rewrite "$post_file" "$en_existed_before"; then
    discard_writer_rewrite_snapshot "$WRITER_TRANSACTION_SNAPSHOT_TOKEN"
    return 0
  fi
  if ! restore_writer_rewrite_snapshot \
    "$ROOT_DIR/src/content/posts/$post_file" \
    "$WRITER_TRANSACTION_SNAPSHOT_TOKEN" \
    "$WRITER_TRANSACTION_CANDIDATE_TOKEN"; then
    return 70
  fi
  return 1
}

run_final_build_gate() {
  local post_file="$1"
  local post_path="$ROOT_DIR/src/content/posts/$post_file"
  local max_repairs=2
  local repair_attempt=0
  local build_log build_rc classification
  local repair_snapshot_token repair_snapshot_rc repair_current_token
  FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_snapshot_or_restore_failed"
  FINAL_BUILD_RUNNER_ERROR_ATTEMPT=0
  build_log="$(mktemp "${TMPDIR:-/tmp}/tribunal-final-build.XXXXXX")"
  repair_snapshot_token=""
  repair_current_token=""

  while true; do
    : > "$build_log"
    build_rc=0
    run_final_build_once "$build_log" || build_rc=$?
    if [ "$build_rc" -eq 0 ]; then
      if [ -n "$repair_snapshot_token" ]; then
        discard_writer_rewrite_snapshot "$repair_snapshot_token"
      fi
      rm -f "$build_log"
      return 0
    fi

    classification="$(tribunal_classify_build_failure "$build_rc" "$build_log" "$post_file")"
    tlog "Final build failure classified as: $classification (rc=$build_rc)"
    if [ "$classification" = "operational" ]; then
      tlog "Final build failed due to likely operational/resource issue; not invoking writer repair."
      if [ -n "$repair_snapshot_token" ] &&
         ! restore_writer_rewrite_snapshot \
           "$post_path" "$repair_snapshot_token" "$repair_current_token"; then
        FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_restore_failed"
        FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
        rm -f "$build_log"
        return 70
      fi
      rm -f "$build_log"
      return 1
    fi
    if [ "$classification" != "actionable" ]; then
      tlog "Final build failure is not clearly content-actionable; failing safely without PASS."
      if [ -n "$repair_snapshot_token" ] &&
         ! restore_writer_rewrite_snapshot \
           "$post_path" "$repair_snapshot_token" "$repair_current_token"; then
        FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_restore_failed"
        FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
        rm -f "$build_log"
        return 70
      fi
      rm -f "$build_log"
      return 1
    fi
    if [ "$repair_attempt" -ge "$max_repairs" ]; then
      tlog "Final build repair attempts exhausted ($max_repairs); failing without PASS."
      if [ -n "$repair_snapshot_token" ] &&
         ! restore_writer_rewrite_snapshot \
           "$post_path" "$repair_snapshot_token" "$repair_current_token"; then
        FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_restore_failed"
        FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
        rm -f "$build_log"
        return 70
      fi
      rm -f "$build_log"
      return 1
    fi

    if [ -z "$repair_snapshot_token" ]; then
      repair_snapshot_rc=0
      repair_snapshot_token="$(tribunal_post_pair_snapshot_create "$post_path")" ||
        repair_snapshot_rc=$?
      if [ "$repair_snapshot_rc" -ne 0 ] || [ -z "$repair_snapshot_token" ]; then
        tlog "Final build repair snapshot creation failed; refusing writer repair."
        FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_snapshot_failed"
        rm -f "$build_log"
        return 70
      fi
      repair_current_token="$repair_snapshot_token"
    fi

    repair_attempt=$((repair_attempt + 1))
    local repair_rc=0
    repair_final_build_failure "$post_file" "$build_log" "$repair_attempt" || repair_rc=$?
    if [ "$repair_rc" -eq 75 ]; then
      if ! restore_writer_rewrite_snapshot \
        "$post_path" "$repair_snapshot_token" "$repair_current_token"; then
        FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_restore_failed"
        FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
        rm -f "$build_log"
        return 70
      fi
      if ! mark_article_quota_suspended \
        "$post_file" "finalBuild" "tribunal-writer" "$repair_attempt" \
        "writer: ${FINAL_BUILD_REPAIR_QUOTA_REASON:-quota exhausted}"; then
        tlog "  RUNNER ERROR: failed to persist final-build quota suspension after restoring the post pair."
        FINAL_BUILD_RUNNER_ERROR_REASON="quota_suspension_persistence_failed"
        FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
        rm -f "$build_log"
        return 70
      fi
      rm -f "$build_log"
      return 75
    fi
    if [ "$repair_rc" -eq 70 ]; then
      FINAL_BUILD_RUNNER_ERROR_REASON="writer_candidate_transaction_failed"
      FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
      if [ "${WRITER_TRANSACTION_APPLY_UNCERTAIN:-0}" = "0" ]; then
        # This attempt failed before an uncertain canonical apply. Earlier
        # repair attempts may still have changed the pair, so CAS-restore the
        # one outer baseline only over the exact last known candidate.
        if ! restore_writer_rewrite_snapshot \
          "$post_path" "$repair_snapshot_token" "$repair_current_token"; then
          FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_restore_failed"
        fi
      fi
      rm -f "$build_log"
      return 70
    fi
    if [ "$repair_rc" -ne 0 ]; then
      tlog "Final build repair attempt $repair_attempt failed cheap validation; failing without PASS."
      if ! restore_writer_rewrite_snapshot \
        "$post_path" "$repair_snapshot_token" "$repair_current_token"; then
        FINAL_BUILD_RUNNER_ERROR_REASON="rewrite_restore_failed"
        FINAL_BUILD_RUNNER_ERROR_ATTEMPT="$repair_attempt"
        rm -f "$build_log"
        return 70
      fi
      rm -f "$build_log"
      return 1
    fi
    repair_current_token="$WRITER_TRANSACTION_CANDIDATE_TOKEN"
  done
}

# A PASS ledger is resumable only when its reader-visible score artifact still
# exists in every current artifact (including a tracked English sidecar) and
# matches the exact dimensions/score that earned the ledger PASS. Worker
# bootstrap may reset/delete uncommitted artifacts while retaining the shared
# runtime ledger; blindly skipping then would create a progress-only PASS that
# the final artifact gate must reject much later.
tracked_english_post_state() {
  local post_file="$1"
  local tracked_en="src/content/posts/en-$post_file"
  local rc=0
  git -C "$ROOT_DIR" ls-files --error-unmatch -- "$tracked_en" \
    >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) return 1 ;;
    *) return 70 ;;
  esac
}

stage_pass_artifacts_present() {
  local post_file="$1" stage_key="$2" fm_judge_key="$3"
  if [ "$WRITE_FRONTMATTER" -ne 1 ] || [ -z "$fm_judge_key" ]; then
    return 0
  fi

  local expected_score
  expected_score="$(
    jq -c --arg a "$post_file" --arg s "$stage_key" \
      '.[$a].stages[$s].score // empty' "$PROGRESS_FILE"
  )"
  if [ -z "$expected_score" ] || [ "$expected_score" = "null" ]; then
    return 1
  fi

  local post_path="$ROOT_DIR/src/content/posts/$post_file"
  local en_path="$ROOT_DIR/src/content/posts/en-$post_file"
  local artifact_path artifact_json tracked_en_rc
  local -a artifact_paths=("$post_path")
  tracked_en_rc=0
  tracked_english_post_state "$post_file" || tracked_en_rc=$?
  if [ "$tracked_en_rc" -eq 70 ]; then
    return 1
  fi
  if [ "$tracked_en_rc" -eq 0 ] && [ ! -f "$en_path" ]; then
    return 1
  fi
  if [ "$tracked_en_rc" -eq 0 ] || [ -f "$en_path" ]; then
    artifact_paths+=("$en_path")
  fi
  for artifact_path in "${artifact_paths[@]}"; do
    artifact_json="$(
      node "$SCRIPT_DIR/frontmatter-scores.mjs" \
        get "$artifact_path" "$fm_judge_key"
    )"
    if [ -z "$artifact_json" ] ||
       ! jq -e --argjson expected "$expected_score" \
         '.score == $expected.score and .dimensions == $expected.dimensions' \
         <<<"$artifact_json" >/dev/null; then
      return 1
    fi
  done
  return 0
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
      # Dimension ownership is version-aware (SSOT: src/lib/tribunal-v2/pass-bar.ts).
      # At tribunalVersion >= 9 `clarity` moves Vibe → Fresh Eyes, joining the
      # composite AND becoming a non-compensating hard gate.
      python3 - "$json_file" "$TRIBUNAL_VERSION" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
version = int(sys.argv[2])
dims = data.get('dimensions', {})
keys = ('readability', 'firstImpression', 'payoffDensity', 'lengthFit')
if version >= 9:
    keys = keys + ('clarity',)
vals = [dims.get(k, 0) for k in keys]
composite = math.floor(sum(vals) / len(vals))
# FreshEyes length/readability dimensions are non-compensating: a flashy hook
# must not hide low payoff density or bad length fit.
ok = composite >= 8 and dims.get('payoffDensity', 0) >= 8 and dims.get('lengthFit', 0) >= 8
if version >= 9:
    ok = ok and dims.get('clarity', 0) >= 8
sys.exit(0 if ok else 1)
PY
      ;;
    vibe-opus-scorer)
      # one dim ≥ 9 AND rest ≥ 8 (no dim < 8). Dimension set is version-aware
      # (SSOT: src/lib/tribunal-v2/pass-bar.ts): at tribunalVersion >= 9 `clarity`
      # leaves Vibe for Fresh Eyes, so the composite spans 4 dims, not 5. Keeping
      # the legacy 5-dim list here made the absent clarity default to 0, dragging
      # composite below 8 and wrongly failing every v9 post.
      python3 - "$json_file" "$TRIBUNAL_VERSION" <<'PY'
import json, sys, math
data = json.load(open(sys.argv[1]))
version = int(sys.argv[2])
dims = data.get('dimensions', {})
keys = ('persona', 'moguNote', 'vibe', 'narrative') if version >= 9 \
    else ('persona', 'moguNote', 'vibe', 'clarity', 'narrative')
vals = [dims.get(k, 0) for k in keys]
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
# Args: stage_key, agent_name, validate_name, label, max_loops, post_file
# Returns: 0 = stage passed, 1 = stage failed (max loops exhausted)
run_stage() {
  local stage_key="$1"    # progress key: librarian, factChecker, freshEyes, vibe
  local agent_name="$2"   # agent name: librarian, fact-checker, fresh-eyes, vibe-opus-scorer
  local validate_name="$3" # validate name: librarian, fact-checker, fresh-eyes, vibe-opus-scorer
  local label="$4"        # human label: Librarian, FactChecker, FreshEyes, VibeScorer
  local max_loops="$5"    # 2 or 3
  local post_file="$6"
  local fm_judge_key="${7:-}" # frontmatter scores key: librarian, factCheck, freshEyes, vibe

  local post_path="$ROOT_DIR/src/content/posts/$post_file"

  # Tribunal executes every stage through the provider resolved for that judge.
  # Agent specs are prompt contracts; the runtime model id (stamped into
  # progress + frontmatter) comes from the provider-specific selector.
  local model_id
  if ! model_id="$(tribunal_llm_model_id "$agent_name")"; then
    tlog "ERROR: could not resolve runtime model for '$agent_name'."
    return 70
  fi

  # Provider-aware runner label for the progress ledger / stage logs /
  # runner-error records. Derived from the same provider resolution as model_id
  # so the internal ledger matches the reader-visible frontmatter.
  local runner_label
  if ! runner_label="$(tribunal_runner_label "$agent_name")"; then
    tlog "ERROR: could not resolve runner label for '$agent_name'."
    return 70
  fi

  # A tracked bilingual artifact cannot be repaired by writing a score to the
  # remaining zh-tw file. Stop before invoking a judge so the old PASS cannot
  # be silently replaced by another incomplete PASS.
  if [ "$WRITE_FRONTMATTER" -eq 1 ] && [ -n "$fm_judge_key" ]; then
    local tracked_en_rc=0
    tracked_english_post_state "$post_file" || tracked_en_rc=$?
    if [ "$tracked_en_rc" -eq 70 ]; then
      tlog "  RUNNER ERROR: could not resolve tracked English artifact state."
      mark_article_runner_error \
        "$post_file" "$stage_key" "$runner_label" 0 \
        "tracked_english_state_unavailable"
      return 70
    fi
    if [ "$tracked_en_rc" -eq 0 ] &&
       [ ! -f "$ROOT_DIR/src/content/posts/en-$post_file" ]; then
      tlog "  RUNNER ERROR: tracked English artifact is missing; refusing a partial resume."
      mark_article_runner_error \
        "$post_file" "$stage_key" "$runner_label" 0 \
        "tracked_english_artifact_missing"
      return 70
    fi
  fi

  # ── Crash resume: skip already-passed stages ──
  local existing_status
  existing_status="$(get_stage_status "$post_file" "$stage_key")"
  if [ "$existing_status" = "pass" ]; then
    if stage_pass_artifacts_present "$post_file" "$stage_key" "$fm_judge_key"; then
      tlog "  Stage '$label' already PASS with matching frontmatter artifacts (crash resume). Skipping."
      return 0
    fi
    tlog "  Stage '$label' ledger says PASS but frontmatter artifacts are missing or drifted; rerunning."
  fi

  tlog "=== Stage $label ($runner_label) | max_loops=$max_loops ==="

  # Load scoring SSOT once (included in writer prompt)
  local ssot_content
  ssot_content="$(cat "$ROOT_DIR/scripts/vibe-scoring-standard.md")"

  local score_tmp
  score_tmp="$(mktemp "${TMPDIR:-/tmp}/tribunal-${stage_key}.XXXXXX")"

  local attempt=0
  while [ "$attempt" -lt "$max_loops" ]; do
    attempt=$((attempt + 1))
    tlog "  $label attempt $attempt/$max_loops..."
    : > "$score_tmp"

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
    tlog "  Invoking agent-spec '$agent_name' via $(tribunal_judge_provider "$agent_name") (runtime model '$model_id', timeout ${stage_timeout}s)..."

    local judge_rc=0 judge_task librarian_packet
    judge_task="Score this post: $ROOT_DIR/src/content/posts/$post_file
Write your JSON result to: SCORE_PATH_PLACEHOLDER"
    local calibration_ref
    calibration_ref="$ROOT_DIR/.codex/agents/references/gp-187-v7-false-positive.md"
    if [ -f "$calibration_ref" ]; then
      judge_task="$(cat <<PROMPT
$judge_task

## Tribunal calibration reference
Read this if the current stage is Librarian, FreshEyes, Vibe, or Writer-adjacent reasoning:
$calibration_ref

It records the exact git commit/blob for the rejected GP-187 false-positive sample and MP-179 overlap target. Use it to calibrate responsibility boundaries; do not treat it as a request to rewrite unless the runner explicitly enables rewrite.
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
    local judge_work_dir actual_provider_file quota_status_file
    judge_work_dir="$(tribunal_llm_work_dir)"
    actual_provider_file="$(mktemp)"
    quota_status_file="$(mktemp)"
    local judge_score_in_work="$judge_work_dir/score.json"
    # Grok's minimal writer tool edits existing files; the trusted harness
    # creates this placeholder before any untrusted article text reaches it.
    printf '{}\n' > "$judge_score_in_work"
    judge_task="${judge_task/SCORE_PATH_PLACEHOLDER/$judge_score_in_work}"
    TRIBUNAL_CODEX_TIMEOUT_SEC="$stage_timeout" \
      TRIBUNAL_ACTUAL_PROVIDER_FILE="$actual_provider_file" \
      TRIBUNAL_QUOTA_STATUS_FILE="$quota_status_file" \
      tribunal_llm_exec_watchdog "$judge_work_dir" "$agent_name" "$judge_task" "$judge_out" "$judge_score_in_work" || judge_rc=$?

    if [ -s "$actual_provider_file" ]; then
      local actual_provider actual_model actual_runner
      actual_provider="$(sed -n 's/^provider=//p' "$actual_provider_file" | head -1)"
      actual_model="$(sed -n 's/^model_id=//p' "$actual_provider_file" | head -1)"
      actual_runner="$(sed -n 's/^runner_label=//p' "$actual_provider_file" | head -1)"
      if [ -n "$actual_provider" ] && [ -n "$actual_model" ] && [ -n "$actual_runner" ]; then
        model_id="$actual_model"
        runner_label="$actual_runner"
        tlog "  Actual judge provider: $actual_provider (runtime model '$model_id', runner '$runner_label')"
      fi
    fi

    if [ -f "$judge_score_in_work" ]; then
      mv "$judge_score_in_work" "$score_tmp"
    fi
    rm -rf "$judge_work_dir"

    if [ "$judge_rc" -eq 75 ]; then
      local quota_reason
      quota_reason="$(quota_status_summary "$quota_status_file")"
      tlog "  QUOTA SUSPEND: $quota_reason"
      mark_article_quota_suspended "$post_file" "$stage_key" "$runner_label" "$attempt" "$quota_reason"
      rm -f "$judge_out" "$actual_provider_file" "$quota_status_file" "$score_tmp"
      return 75
    fi

    if [ "$judge_rc" -eq 124 ]; then
      tlog "  [tribunal-watchdog] idle timeout: no output/score-file progress; normalizing stalled judge to runner error."
      mark_article_runner_error "$post_file" "$stage_key" "$runner_label" "$attempt" "watchdog_idle_timeout"
      rm -f "$judge_out" "$actual_provider_file" "$quota_status_file" "$score_tmp"
      return 70
    fi

    if [ "$judge_rc" -eq 70 ]; then
      tlog "  RUNNER ERROR: Agent '$agent_name' could not preserve runtime provenance."
      if [ -s "$judge_out" ]; then
        head -5 "$judge_out" | while IFS= read -r line; do tlog "    $line"; done
      fi
      mark_article_runner_error "$post_file" "$stage_key" "$runner_label" "$attempt" "runner_or_provenance_error"
      rm -f "$judge_out" "$quota_status_file" "$score_tmp"
      rm -rf "$actual_provider_file"
      return 70
    fi

    if [ "$judge_rc" -ne 0 ]; then
      tlog "  WARN: Agent '$agent_name' exited with code $judge_rc"
      if [ -s "$judge_out" ]; then
        head -5 "$judge_out" | while IFS= read -r line; do tlog "    $line"; done
      fi
    fi
    rm -f "$judge_out" "$actual_provider_file" "$quota_status_file"

    # ── Validate score JSON ───────────────────────────────────────────────────
    if ! validate_judge_score_json "$validate_name" "$score_tmp" "$TRIBUNAL_VERSION"; then
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
          if ! mark_article_runner_error "$post_file" "$stage_key" "$runner_label" "$attempt" "frontmatter_persistence_failed"; then
            tlog "  ERROR: Failed to persist RUNNER_ERROR after frontmatter failure."
          fi
          rm -f "$score_tmp"
          return 70
        fi
      fi

      if ! write_stage_progress "$post_file" "$stage_key" "pass" "$score_json" "$runner_label" "$attempt"; then
        tlog "  ERROR: Failed to persist resumable PASS for $stage_key."
        if ! mark_article_runner_error "$post_file" "$stage_key" "$runner_label" "$attempt" "stage_pass_persistence_failed"; then
          tlog "  ERROR: Failed to persist RUNNER_ERROR after stage PASS ledger failure."
        fi
        rm -f "$score_tmp"
        return 70
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

    local writer_prompt writer_out writer_rc en_existed_before writer_quota_status_file
    local rewrite_snapshot_token rewrite_candidate_token
    if [ -f "src/content/posts/en-$post_file" ]; then
      en_existed_before=1
    else
      en_existed_before=0
    fi
    writer_prompt="$(cat <<PROMPT
You are the tribunal-writer for gu-log. The $label judge reviewed this post and it FAILED.

## Repo root
$ROOT_DIR

## Writable zh-tw candidate
TRIBUNAL_CANDIDATE_ZH_PATH

## Writable English candidate, if present
TRIBUNAL_CANDIDATE_EN_PATH

## Judge Feedback (JSON)
$score_json

## Scoring Standard (SSOT — read this carefully before rewriting)
$ssot_content

## Task
1. The Repo root is read-only reference material. Never edit a path under it.
2. Read TRIBUNAL_CANDIDATE_ZH_PATH and $ROOT_DIR/GU-LOG_WRITER_PROMPT.md.
3. Read the judge feedback JSON above — identify every dimension that scored below 8.
4. Rewrite TRIBUNAL_CANDIDATE_ZH_PATH to fix those specific failures.
5. Also rewrite TRIBUNAL_CANDIDATE_EN_PATH if it exists and the same fix applies.
6. Inspect your diff before finishing. Do not run tribunal, judge agents, or any quota-burning model calls from inside this rewrite.

Follow $ROOT_DIR/GU-LOG_WRITER_PROMPT.md and $ROOT_DIR/CONTRIBUTING.md frontmatter schema.
Do NOT change frontmatter fields (title, ticketId, dates, sourceUrl). Preserve MDX components, URLs, source attribution, and already-passing dimensions unless the judge feedback explicitly targets them.
PROMPT
)"
    local writer_mode
    writer_mode="$(tribunal_writer_mode)"
    if [ "$writer_mode" = "none" ]; then
      tlog "  Rewrite skipped (GP_WRITER_MODE=none); failing score-only without invoking tribunal-writer."
      write_stage_progress "$post_file" "$stage_key" "fail" "$score_json" "$runner_label" "$attempt"
      rm -f "$score_tmp"
      return 1
    fi

    writer_out="$(mktemp)"
    writer_quota_status_file="$(mktemp)"
    writer_rc=0
    run_writer_candidate_transaction \
      "$post_path" "$post_file" "$stage_key" "$attempt" "$writer_prompt" \
      "$writer_out" "$writer_quota_status_file" || writer_rc=$?

    if [ "$writer_rc" -eq 75 ]; then
      local writer_quota_reason
      writer_quota_reason="$(quota_status_summary "$writer_quota_status_file")"
      tlog "  QUOTA SUSPEND during tribunal-writer rewrite: $writer_quota_reason"
      if ! mark_article_quota_suspended \
        "$post_file" "$stage_key" "$runner_label" "$attempt" \
        "writer: $writer_quota_reason"; then
        tlog "  RUNNER ERROR: failed to persist writer quota suspension after leaving canonical posts unchanged."
        if ! mark_article_runner_error \
          "$post_file" "$stage_key" "$runner_label" "$attempt" \
          "quota_suspension_persistence_failed"; then
          tlog "  ERROR: failed to persist RUNNER_ERROR after writer quota ledger failure."
        fi
        rm -f "$writer_out" "$writer_quota_status_file" "$score_tmp"
        return 70
      fi
      rm -f "$writer_out" "$writer_quota_status_file" "$score_tmp"
      return 75
    fi

    if [ "$writer_rc" -eq 70 ]; then
      tlog "  RUNNER ERROR: isolated writer candidate transaction failed."
      tail -15 "$writer_out" | while IFS= read -r line; do tlog "    $line"; done
      if ! mark_article_runner_error \
        "$post_file" "$stage_key" "$runner_label" "$attempt" \
        "writer_candidate_transaction_failed"; then
        tlog "  ERROR: failed to persist RUNNER_ERROR after candidate transaction failure."
      fi
      rm -f "$writer_out" "$writer_quota_status_file" "$score_tmp"
      return 70
    fi

    if [ "$writer_rc" -ne 0 ]; then
      tlog "  WARN: tribunal-writer exited with code $writer_rc"
      # Surface the writer's own output so a non-quota failure (e.g. a permission
      # rejection, a CLI error) is diagnosable instead of silently discarded.
      # Mirrors the final-build repair path's dump.
      tail -15 "$writer_out" | while IFS= read -r line; do tlog "    $line"; done
      rm -f "$writer_out" "$writer_quota_status_file"
      continue
    fi
    rewrite_snapshot_token="$WRITER_TRANSACTION_SNAPSHOT_TOKEN"
    rewrite_candidate_token="$WRITER_TRANSACTION_CANDIDATE_TOKEN"
    rm -f "$writer_out" "$writer_quota_status_file"

    # ── Cheap validation after rewrite (full build is deferred to final gate) ─
    if ! cheap_validate_writer_rewrite "$post_file" "$en_existed_before"; then
      tlog "  ERROR: cheap validation failed after writer rewrite. Reverting changes."
      if ! restore_writer_rewrite_snapshot \
        "$post_path" "$rewrite_snapshot_token" "$rewrite_candidate_token"; then
        tlog "  RUNNER ERROR: could not restore the pre-writer post state after validation failure."
        if ! mark_article_runner_error \
          "$post_file" "$stage_key" "$runner_label" "$attempt" "rewrite_restore_failed"; then
          tlog "  ERROR: failed to persist RUNNER_ERROR after validation restore failure."
        fi
        rm -f "$score_tmp"
        return 70
      fi
    else
      discard_writer_rewrite_snapshot "$rewrite_snapshot_token"
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
# Provider gate: codex is the maintained runtime (VPS/mac). When codex is
# absent — the CCC / Claude Code on the web sandbox — fall back to claude so
# the tribunal can still score/rewrite rather than hard-failing. Codex, when
# present, must still meet the minimum version; claude has no version pin.
#
# NOTE: TRIBUNAL_PROVIDER is the *global primary* — used only for this preflight
# (availability + codex version) and the CCC-fallback log below. It is NOT the
# per-stage truth: providers are resolved per judge via tribunal_judge_provider,
# and each stage's real provider/model is recorded via actual_provider_file.
TRIBUNAL_PROVIDER="$(tribunal_llm_provider || true)"
if [ -z "$TRIBUNAL_PROVIDER" ]; then
  echo "ERROR: No tribunal LLM provider on PATH: install codex (preferred) or claude" >&2
  exit 70
fi
if [ "$TRIBUNAL_PROVIDER" = "codex" ]; then
  CODEX_VERSION="$(tribunal_codex_version || true)"
  MIN_CODEX_VERSION="0.128.0"
  if [ -z "$CODEX_VERSION" ] || ! tribunal_codex_version_at_least "$CODEX_VERSION" "$MIN_CODEX_VERSION"; then
    echo "ERROR: Codex CLI version $CODEX_VERSION is older than required $MIN_CODEX_VERSION; check tribunal service PATH" >&2
    exit 70
  fi
fi

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "ERROR: Git repository is mid-rebase. Resolve manually first." >&2
  exit 1
fi

ensure_score_dirs
ensure_progress_file
init_article_progress "$POST_FILE"

tlog "=== tribunal.sh: $POST_FILE ==="
if [ "$TRIBUNAL_PROVIDER" != "codex" ]; then
  tlog "  Provider: codex absent — using Claude fallback (CCC sandbox)"
fi

# ─── Sequential Tribunal Loop ─────────────────────────────────────────────────
# Format: stage_key:agent_name:validate_name:label:max_loops:fm_judge_key
# fm_judge_key = frontmatter scores key (used by frontmatter-scores.mjs)
# The runner_label is no longer a static column here: run_stage resolves it
# provider-aware via tribunal_runner_label so codex/claude are labelled honestly.
declare -a STAGES=(
  "factChecker:fact-checker:fact-checker:FactChecker:2:factCheck"
  "librarian:librarian:librarian:Librarian:2:librarian"
  "freshEyes:fresh-eyes:fresh-eyes:FreshEyes:2:freshEyes"
  "vibe:vibe-opus-scorer:vibe-opus-scorer:VibeScorer:3:vibe"
)

for stage_def in "${STAGES[@]}"; do
  IFS=':' read -r stage_key agent_name validate_name label max_loops fm_judge_key <<< "$stage_def"

  if [ -n "$ONLY_STAGE" ] && [ "$stage_key" != "$ONLY_STAGE" ]; then
    tlog "  Skipping stage '$label' due to --only-stage=$ONLY_STAGE."
    continue
  fi

  stage_rc=0
  run_stage \
    "$stage_key" "$agent_name" "$validate_name" "$label" \
    "$max_loops" "$POST_FILE" "$fm_judge_key" || stage_rc=$?
  if [ "$stage_rc" -eq 75 ]; then
    tlog "=== QUOTA SUSPENDED at stage: $label ==="
    commit_progress "tribunal(${POST_FILE%.mdx}): QUOTA_SUSPENDED at $label stage"
    exit 75
  elif [ "$stage_rc" -eq 70 ]; then
    tlog "=== RUNNER ERROR at stage: $label ==="
    if ! ensure_article_runner_error_checkpoint \
      "$POST_FILE" "$stage_key" "tribunal-runner" 0 "stage_runner_error"; then
      tlog "  ERROR: stage RUNNER_ERROR has no verified durable ledger checkpoint."
    fi
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
final_build_rc=0
run_final_build_gate "$POST_FILE" || final_build_rc=$?
if [ "$final_build_rc" -eq 70 ]; then
  tlog "=== RUNNER ERROR at final build gate: $POST_FILE ==="
  if ! ensure_article_runner_error_checkpoint \
    "$POST_FILE" "finalBuild" "tribunal-writer" \
    "${FINAL_BUILD_RUNNER_ERROR_ATTEMPT:-0}" \
    "${FINAL_BUILD_RUNNER_ERROR_REASON:-rewrite_snapshot_or_restore_failed}"; then
    tlog "  ERROR: final-build RUNNER_ERROR has no verified durable ledger checkpoint."
  fi
  exit 70
elif [ "$final_build_rc" -eq 75 ]; then
  tlog "=== QUOTA SUSPENDED at final build gate: $POST_FILE ==="
  commit_progress "tribunal(${POST_FILE%.mdx}): QUOTA_SUSPENDED at final build gate"
  exit 75
fi
if [ "$final_build_rc" -ne 0 ]; then
  tlog "=== FAILED at final build gate: $POST_FILE ==="
  mark_article_failed "$POST_FILE" "finalBuild"
  commit_progress "tribunal(${POST_FILE%.mdx}): FAILED at final build gate"
  exit 1
fi

mark_article_passed "$POST_FILE"
commit_progress "tribunal(${POST_FILE%.mdx}): all 4 stages PASS + final build"
tlog "Done. Log: $LOG_FILE"
