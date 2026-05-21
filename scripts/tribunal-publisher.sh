#!/usr/bin/env bash
# tribunal-publisher.sh — materialize publishable Tribunal PASS artifacts from
# the ignored runtime ledger into a clean origin/main-based batch worktree.

set -euo pipefail
export TZ=Asia/Taipei

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

source "$SCRIPT_DIR/tribunal-helpers.sh"

PROGRESS_FILE="${PROGRESS_FILE:-$(tribunal_progress_file_default "$ROOT_DIR")}"
PUBLISHER_STATE_FILE="${PUBLISHER_STATE_FILE:-$(tribunal_publisher_state_file "$ROOT_DIR")}"
POSTS_DIR="$ROOT_DIR/src/content/posts"
MODE="dry-run"
MAX_BATCH="${MAX_BATCH:-10}"
WORKTREE_PATH=""
BRANCH_NAME=""
KEEP_WORKTREE=0

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/tribunal-publisher.sh --dry-run [--max N]
  bash scripts/tribunal-publisher.sh --apply [--max N] [--branch NAME] [--worktree PATH] [--keep-worktree]
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --max) MAX_BATCH="$2"; shift 2 ;;
    --branch) BRANCH_NAME="$2"; shift 2 ;;
    --worktree) WORKTREE_PATH="$2"; shift 2 ;;
    --keep-worktree) KEEP_WORKTREE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

tlog() {
  printf '[publisher] %s\n' "$*"
}

ensure_runtime_files() {
  ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"
  mkdir -p "$(dirname "$PUBLISHER_STATE_FILE")"
  if [ ! -f "$PUBLISHER_STATE_FILE" ] || ! jq empty "$PUBLISHER_STATE_FILE" >/dev/null 2>&1; then
    jq -n '{schemaVersion: 1, entries: {}, batches: {}}' > "$PUBLISHER_STATE_FILE"
  fi
}

post_relpaths_for_article() {
  local article="$1"
  printf 'src/content/posts/%s\n' "$article"
  if [ -f "$POSTS_DIR/en-$article" ]; then
    printf 'src/content/posts/en-%s\n' "$article"
  fi
}

current_publish_state() {
  local article="$1"
  jq -r --arg a "$article" '.entries[$a].publishState // "ready_for_batch"' "$PUBLISHER_STATE_FILE"
}

current_batch_id() {
  local article="$1"
  jq -r --arg a "$article" '.entries[$a].batchId // ""' "$PUBLISHER_STATE_FILE"
}

collect_articles_by_status() {
  local status="$1"
  jq -r --arg s "$status" '
    to_entries
    | map(select((.value.status // "") == $s))
    | sort_by(.key)
    | .[].key
  ' "$PROGRESS_FILE"
}

collect_publishable_passes() {
  local article state
  while IFS= read -r article; do
    [ -n "$article" ] || continue
    state="$(current_publish_state "$article")"
    if [ "$state" = "ready_for_batch" ]; then
      printf '%s\n' "$article"
    fi
  done < <(collect_articles_by_status "PASS")
}

collect_state_articles() {
  local desired="$1"
  jq -r --arg desired "$desired" '
    .entries
    | to_entries
    | map(select((.value.publishState // "") == $desired))
    | sort_by(.key)
    | .[].key
  ' "$PUBLISHER_STATE_FILE"
}

render_report() {
  local publishable failed exhausted runner_error batched published
  mapfile -t publishable < <(collect_publishable_passes)
  mapfile -t failed < <(collect_articles_by_status "FAILED")
  mapfile -t exhausted < <(collect_articles_by_status "EXHAUSTED")
  mapfile -t runner_error < <(collect_articles_by_status "RUNNER_ERROR")
  mapfile -t batched < <(collect_state_articles "batch_selected")
  mapfile -t published < <(collect_state_articles "published")

  tlog "publishable PASS: ${#publishable[@]}"
  for article in "${publishable[@]:0:$MAX_BATCH}"; do
    tlog "  ready  $article"
  done
  tlog "FAILED metadata: ${#failed[@]}"
  tlog "EXHAUSTED metadata: ${#exhausted[@]}"
  tlog "RUNNER_ERROR metadata: ${#runner_error[@]}"
  tlog "already batched: ${#batched[@]}"
  tlog "already published: ${#published[@]}"
}

reserve_batch_state() {
  local batch_id="$1"
  local branch_name="$2"
  shift 2
  local selected_json
  selected_json="$(printf '%s\n' "$@" | jq -R . | jq -s .)"
  local ts
  ts="$(TZ=Asia/Taipei date -Iseconds)"
  local tmp
  tmp="$(mktemp)"
  jq \
    --arg batchId "$batch_id" \
    --arg branchName "$branch_name" \
    --arg updatedAt "$ts" \
    --argjson selected "$selected_json" '
      .batches[$batchId] = {
        batchId: $batchId,
        branch: $branchName,
        selectedAt: $updatedAt,
        entries: $selected
      }
      | reduce $selected[] as $article (.;
          .entries[$article] = {
            publishState: "batch_selected",
            batchId: $batchId,
            updatedAt: $updatedAt
          }
        )
    ' "$PUBLISHER_STATE_FILE" > "$tmp"
  mv "$tmp" "$PUBLISHER_STATE_FILE"
}

apply_batch() {
  local article batch_id branch_name batch_dir
  mapfile -t selected < <(collect_publishable_passes | head -n "$MAX_BATCH")
  if [ "${#selected[@]}" -eq 0 ]; then
    tlog "No publishable PASS artifacts."
    return 0
  fi

  batch_id="tribunal-batch-$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)"
  branch_name="${BRANCH_NAME:-publisher/$batch_id}"
  batch_dir="${WORKTREE_PATH:-$ROOT_DIR/.score-loop/publisher/$batch_id}"

  tribunal_fetch_origin_main "$ROOT_DIR" /dev/null || true

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    echo "ERROR: branch already exists locally: $branch_name" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$batch_dir")"
  git worktree add -b "$branch_name" "$batch_dir" origin/main >/dev/null

  for article in "${selected[@]}"; do
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      mkdir -p "$batch_dir/$(dirname "$rel")"
      cp "$ROOT_DIR/$rel" "$batch_dir/$rel"
    done < <(post_relpaths_for_article "$article")
  done

  git -C "$batch_dir" add src/content/posts
  if git -C "$batch_dir" diff --cached --quiet; then
    tlog "Selected artifacts produced no diff on origin/main; dropping empty batch."
    git worktree remove "$batch_dir" --force
    git branch -D "$branch_name" >/dev/null 2>&1 || true
    return 0
  fi
  git -C "$batch_dir" commit -m "publisher: materialize Tribunal batch $batch_id" >/dev/null

  reserve_batch_state "$batch_id" "$branch_name" "${selected[@]}"

  tlog "batch_id=$batch_id"
  tlog "branch=$branch_name"
  tlog "worktree=$batch_dir"
  for article in "${selected[@]}"; do
    tlog "  selected $article"
  done

  if [ "$KEEP_WORKTREE" != "1" ]; then
    tlog "worktree kept at $batch_dir for inspection"
  fi
}

ensure_runtime_files

case "$MODE" in
  dry-run) render_report ;;
  apply) apply_batch ;;
  *) usage; exit 2 ;;
esac
