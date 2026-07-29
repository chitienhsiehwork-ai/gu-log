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
TRIAGE_EVENTS_FILE="${TRIAGE_EVENTS_FILE:-$(tribunal_triage_events_file "$ROOT_DIR")}"
POSTS_DIR="$ROOT_DIR/src/content/posts"
MODE="dry-run"
MAX_BATCH="${MAX_BATCH:-10}"
WORKTREE_PATH=""
BRANCH_NAME=""
KEEP_WORKTREE=0
PUSH_PR=0
SKIP_BUILD="${TRIBUNAL_PUBLISHER_SKIP_BUILD:-0}"
REPO="${GU_LOG_GITHUB_REPO:-chitienhsiehwork-ai/gu-log}"
GH_BIN="${GH_BIN:-gh}"
OPEN_PR_SNAPSHOT_FILE=""
INSTALL_LOG=""
BUILD_LOG=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/tribunal-publisher.sh --dry-run [--max N]
  bash scripts/tribunal-publisher.sh --status
  bash scripts/tribunal-publisher.sh --apply [--max N] [--branch NAME] [--worktree PATH] [--keep-worktree] [--push-pr]
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --status) MODE="status"; shift ;;
    --apply) MODE="apply"; shift ;;
    --max) MAX_BATCH="$2"; shift 2 ;;
    --branch) BRANCH_NAME="$2"; shift 2 ;;
    --worktree) WORKTREE_PATH="$2"; shift 2 ;;
    --keep-worktree) KEEP_WORKTREE=1; shift ;;
    --push-pr) PUSH_PR=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

tlog() {
  printf '[publisher] %s\n' "$*"
}

cleanup_open_pr_snapshot() {
  if [ -n "$OPEN_PR_SNAPSHOT_FILE" ]; then
    rm -f "$OPEN_PR_SNAPSHOT_FILE" "$OPEN_PR_SNAPSHOT_FILE.next"
  fi
}

cleanup_publisher_temp_files() {
  cleanup_open_pr_snapshot
  [ -z "$INSTALL_LOG" ] || rm -f "$INSTALL_LOG"
  [ -z "$BUILD_LOG" ] || rm -f "$BUILD_LOG"
}
trap cleanup_publisher_temp_files EXIT

ensure_runtime_files() {
  validate_tribunal_runtime_json_file "$PUBLISHER_STATE_FILE" "publisher state"
  validate_tribunal_runtime_json_file "$TRIAGE_EVENTS_FILE" "triage events"
  ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"
  ensure_tribunal_runtime_json_file \
    "$PUBLISHER_STATE_FILE" \
    "publisher state" \
    '{schemaVersion: 1, entries: {}, batches: {}}'
  ensure_tribunal_runtime_json_file \
    "$TRIAGE_EVENTS_FILE" \
    "triage events" \
    '{schemaVersion: 1, events: {}}'
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

publisher_gh() {
  local token_file="${GU_LOG_GH_TOKEN_FILE:-$HOME/.config/github-tokens/gu-log-operator.token}"
  local out rc token_out token_rc
  if [ -n "${GU_LOG_GH_TOKEN:-}" ]; then
    GH_TOKEN="$GU_LOG_GH_TOKEN" "$GH_BIN" "$@"
    return
  fi
  out=$("$GH_BIN" "$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$out"
    return 0
  fi
  if [ -f "$token_file" ]; then
    token_out=$(GH_TOKEN="$(cat "$token_file")" "$GH_BIN" "$@" 2>&1)
    token_rc=$?
    if [ "$token_rc" -eq 0 ]; then
      printf '%s\n' "$token_out"
      return 0
    fi
  fi
  printf '%s\n' "$out" >&2
  if [ -n "${token_out:-}" ]; then
    printf '%s\n' "$token_out" >&2
  fi
  return "$rc"
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
    if [ "$state" = "ready_for_batch" ] && ! article_has_blocking_event "$article"; then
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

collect_blocking_event_articles() {
  local kind="$1"
  jq -r --arg kind "$kind" '
    .events
    | to_entries
    | map(select(.value.kind == $kind))
    | map(select((.value.state // "") == "open" or (.value.state // "") == "agent_review" or (.value.state // "") == "awaiting_human" or (.value.state // "") == "deferred"))
    | map(.value.article)
    | unique
    | .[]
  ' "$TRIAGE_EVENTS_FILE"
}

article_has_blocking_event() {
  local article="$1"
  jq -e --arg article "$article" '
    any(
      .events[]?;
      .article == $article and ((.state // "") == "open" or (.state // "") == "agent_review" or (.state // "") == "awaiting_human" or (.state // "") == "deferred")
    )
  ' "$TRIAGE_EVENTS_FILE" >/dev/null 2>&1
}

event_id_for() {
  local kind="$1" article="$2" fingerprint="$3"
  printf '%s|%s|%s\n' "$kind" "$article" "$fingerprint" | sha1sum | awk '{print substr($1,1,16)}'
}

record_event() {
  local kind="$1" article="$2" fingerprint="$3" targets_json="$4" summary="$5" options_json="$6"
  local event_id ts tmp
  event_id="$(event_id_for "$kind" "$article" "$fingerprint")"
  ts="$(TZ=Asia/Taipei date -Iseconds)"
  tmp="$(mktemp)"
  jq \
    --arg id "$event_id" \
    --arg kind "$kind" \
    --arg article "$article" \
    --arg fingerprint "$fingerprint" \
    --arg summary "$summary" \
    --arg updatedAt "$ts" \
    --argjson targets "$targets_json" \
    --argjson options "$options_json" '
      .events[$id] = (
        .events[$id] // {
          eventId: $id,
          kind: $kind,
          article: $article,
          state: "open",
          resolution: null,
          createdAt: $updatedAt
        }
      )
      | .events[$id].kind = $kind
      | .events[$id].article = $article
      | .events[$id].state = "open"
      | .events[$id].summary = $summary
      | .events[$id].fingerprint = $fingerprint
      | .events[$id].comparisonTargets = $targets
      | .events[$id].decisionOptions = $options
      | .events[$id].updatedAt = $updatedAt
    ' "$TRIAGE_EVENTS_FILE" > "$tmp"
  mv "$tmp" "$TRIAGE_EVENTS_FILE"
  printf '%s\n' "$event_id"
}

prepare_open_pr_snapshot() {
  local prs_json prs_stream files_json files_stream pr_number fixture_list fixture_files
  fixture_list="${TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE:-}"
  fixture_files="${TRIBUNAL_PUBLISHER_PR_FILES_DIR:-}"
  OPEN_PR_SNAPSHOT_FILE="$(mktemp)"

  if [ "${TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN:-0}" = "1" ]; then
    printf '{"prs":[],"files":{}}\n' > "$OPEN_PR_SNAPSHOT_FILE"
    return 0
  fi

  if [ -z "$fixture_list" ] && [ -n "$fixture_files" ]; then
    echo "ERROR: unable to build GitHub conflict snapshot: files fixture directory requires a PR list fixture" >&2
    return 1
  fi

  if [ -n "$fixture_list" ]; then
    if [ ! -f "$fixture_list" ]; then
      echo "ERROR: unable to build GitHub conflict snapshot: missing PR list fixture: $fixture_list" >&2
      return 1
    fi
    prs_json="$(cat "$fixture_list")"
  else
    if ! prs_stream="$(
      publisher_gh api --paginate \
        "repos/$REPO/pulls?state=open&per_page=100" \
        --jq '.[] | {number, title, headRefName: .head.ref, labels: (.labels // [])}'
    )"; then
      echo "ERROR: unable to build GitHub conflict snapshot: open PR list request failed" >&2
      return 1
    fi
    if ! prs_json="$(jq -s '.' <<<"$prs_stream")"; then
      echo "ERROR: unable to build GitHub conflict snapshot: open PR list request returned invalid JSON" >&2
      return 1
    fi
  fi

  if ! jq -e '
    type == "array"
    and all(.[];
      (.number | type == "number" and . >= 1 and floor == .)
      and ((.title // "") | type == "string")
      and ((.headRefName // "") | type == "string")
      and ((.labels // []) | type == "array")
      and all((.labels // [])[]?; ((.name // "") | type == "string"))
    )
  ' <<<"$prs_json" >/dev/null 2>&1; then
    echo "ERROR: unable to build GitHub conflict snapshot: open PR list is invalid JSON or has an unexpected shape" >&2
    return 1
  fi

  printf '%s\n' "$prs_json" | jq '{prs: ., files: {}}' > "$OPEN_PR_SNAPSHOT_FILE"

  while IFS= read -r pr_number; do
    [ -n "$pr_number" ] || continue
    if [ -n "$fixture_list" ]; then
      if [ -z "$fixture_files" ] || [ ! -f "$fixture_files/$pr_number.json" ]; then
        echo "ERROR: unable to build GitHub conflict snapshot: missing files fixture for PR #$pr_number" >&2
        return 1
      fi
      files_json="$(cat "$fixture_files/$pr_number.json")"
    else
      if ! files_stream="$(
        publisher_gh api --paginate \
          "repos/$REPO/pulls/$pr_number/files?per_page=100" \
          --jq '.[] | {path: .filename}'
      )"; then
        echo "ERROR: unable to build GitHub conflict snapshot: files request failed for PR #$pr_number" >&2
        return 1
      fi
      if ! files_json="$(jq -s '{files: .}' <<<"$files_stream")"; then
        echo "ERROR: unable to build GitHub conflict snapshot: files request for PR #$pr_number returned invalid JSON" >&2
        return 1
      fi
    fi

    if ! jq -e '
      type == "object"
      and (.files | type == "array")
      and all(.files[]; (.path | type == "string"))
    ' <<<"$files_json" >/dev/null 2>&1; then
      echo "ERROR: unable to build GitHub conflict snapshot: files for PR #$pr_number are invalid JSON or have an unexpected shape" >&2
      return 1
    fi

    jq --arg number "$pr_number" --argjson files "$files_json" \
      '.files[$number] = $files' \
      "$OPEN_PR_SNAPSHOT_FILE" > "$OPEN_PR_SNAPSHOT_FILE.next"
    mv "$OPEN_PR_SNAPSHOT_FILE.next" "$OPEN_PR_SNAPSHOT_FILE"
  done < <(
    jq -r '
      .[]
      | select(((.headRefName // "") | startswith("publisher/")) | not)
      | select((any((.labels // [])[]?; (.name // "") == "tribunal-publisher")) | not)
      | .number
    ' <<<"$prs_json"
  )
}

article_conflict_targets_json() {
  local article="$1"
  local rels_json
  rels_json="$(post_relpaths_for_article "$article" | jq -R . | jq -s .)"
  python3 - "$article" "$rels_json" "$OPEN_PR_SNAPSHOT_FILE" <<'PY'
import json, sys
article = sys.argv[1]
rels = json.loads(sys.argv[2])
with open(sys.argv[3], "r", encoding="utf-8") as fh:
    snapshot = json.load(fh)
targets = []
for pr in snapshot["prs"]:
    labels = pr.get("labels", []) or []
    if (pr.get("headRefName", "") or "").startswith("publisher/"):
        continue
    if any((label.get("name", "") == "tribunal-publisher") for label in labels):
        continue
    num = pr["number"]
    files_json = snapshot["files"][str(num)]
    paths = [f["path"] for f in files_json.get("files", [])]
    overlap = [p for p in paths if p in rels]
    if overlap:
        targets.append({
            "id": f"pr:{num}",
            "number": num,
            "title": pr.get("title", ""),
            "headRefName": pr.get("headRefName", ""),
            "paths": overlap,
        })
print(json.dumps(targets))
PY
}

refresh_conflict_events() {
  local article targets_json fingerprint summary options_json
  options_json='["keep_current","accept_tribunal","agent_merge","requeue","defer","no_action"]'
  while IFS= read -r article; do
    [ -n "$article" ] || continue
    targets_json="$(article_conflict_targets_json "$article")"
    if [ "$(jq 'length' <<<"$targets_json")" -gt 0 ]; then
      fingerprint="$(jq -c 'map(.id)' <<<"$targets_json")"
      summary="Open editorial PR already touches publishable Tribunal paths."
      record_event "conflict" "$article" "$fingerprint" "$targets_json" "$summary" "$options_json" >/dev/null
    fi
  done < <(collect_articles_by_status "PASS")
}

mark_entry_publish_state() {
  local article="$1" state="$2"
  local batch_id="${3:-}"
  local tmp ts
  ts="$(TZ=Asia/Taipei date -Iseconds)"
  tmp="$(mktemp)"
  jq \
    --arg article "$article" \
    --arg state "$state" \
    --arg batchId "$batch_id" \
    --arg updatedAt "$ts" '
      .entries[$article] = ((.entries[$article] // {}) + {
        publishState: $state,
        batchId: (if $batchId == "" then (.entries[$article].batchId // null) else $batchId end),
        updatedAt: $updatedAt
      })
    ' "$PUBLISHER_STATE_FILE" > "$tmp"
  mv "$tmp" "$PUBLISHER_STATE_FILE"
}

validate_candidate_batch() {
  local article
  local args=()
  for article in "$@"; do
    args+=("$article")
    if [ -f "$POSTS_DIR/en-$article" ]; then
      args+=("en-$article")
    fi
  done
  node "$ROOT_DIR/scripts/validate-posts.mjs" "${args[@]}"
}

validate_candidate_article() {
  local article="$1"
  if [ -n "${TRIBUNAL_PUBLISHER_VALIDATE_HOOK:-}" ]; then
    "${TRIBUNAL_PUBLISHER_VALIDATE_HOOK}" "$article"
    return
  fi
  validate_candidate_batch "$article"
}

record_validation_blocked() {
  local article="$1" reason="$2"
  local options_json targets_json fingerprint
  options_json='["validation_fix","requeue","defer","no_action"]'
  targets_json="$(post_relpaths_for_article "$article" | jq -R '{path: .}' | jq -s .)"
  fingerprint="$(printf '%s' "$reason" | sha1sum | awk '{print substr($1,1,16)}')"
  record_event "validation_blocked" "$article" "$fingerprint" "$targets_json" "$reason" "$options_json" >/dev/null
}

prepare_batch_logs() {
  INSTALL_LOG="$(mktemp "${TMPDIR:-/tmp}/tribunal-publisher-install.XXXXXX")" || return 1
  if ! BUILD_LOG="$(mktemp "${TMPDIR:-/tmp}/tribunal-publisher-build.XXXXXX")"; then
    rm -f "$INSTALL_LOG"
    INSTALL_LOG=""
    return 1
  fi
}

log_publisher_failure_tail() {
  local log_file="$1"
  tail -30 "$log_file" 2>/dev/null |
    while IFS= read -r line; do
      tlog "    $line"
    done
}

batch_dependencies_are_reusable() {
  local batch_dir="$1"
  local manifest
  [ -d "$ROOT_DIR/node_modules" ] || return 1
  [ ! -L "$ROOT_DIR/node_modules" ] || return 1
  [ -x "$ROOT_DIR/node_modules/.bin/astro" ] || return 1
  [ -f "$ROOT_DIR/node_modules/.pnpm/lock.yaml" ] || return 1
  cmp -s "$ROOT_DIR/pnpm-lock.yaml" "$ROOT_DIR/node_modules/.pnpm/lock.yaml" || return 1
  for manifest in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
    [ -f "$ROOT_DIR/$manifest" ] || return 1
    [ -f "$batch_dir/$manifest" ] || return 1
    cmp -s "$ROOT_DIR/$manifest" "$batch_dir/$manifest" || return 1
  done
}

prepare_batch_dependencies() {
  local batch_dir="$1"
  local install_rc=0
  if batch_dependencies_are_reusable "$batch_dir" &&
     ln -s "$ROOT_DIR/node_modules" "$batch_dir/node_modules"; then
    tlog "Reusing exact runtime dependencies: $ROOT_DIR/node_modules"
    return 0
  fi

  tlog "Installing clean-worktree dependencies."
  (
    cd "$batch_dir"
    pnpm install --frozen-lockfile --prefer-offline
  ) >"$INSTALL_LOG" 2>&1 || install_rc=$?
  if [ "$install_rc" -ne 0 ]; then
    tlog "Dependency install failed; publisher will retry (rc=$install_rc, log=$INSTALL_LOG)."
    log_publisher_failure_tail "$INSTALL_LOG"
    return "$install_rc"
  fi
}

remove_reused_dependency_link() {
  local batch_dir="$1"
  local dependency_path="$batch_dir/node_modules"
  [ -L "$dependency_path" ] || return 0
  [ "$(readlink "$dependency_path")" = "$ROOT_DIR/node_modules" ] || return 1
  rm -f "$dependency_path"
}

render_report() {
  refresh_conflict_events
  local publishable failed exhausted runner_error batched published conflicted validation_blocked
  mapfile -t publishable < <(collect_publishable_passes)
  mapfile -t failed < <(collect_articles_by_status "FAILED")
  mapfile -t exhausted < <(collect_articles_by_status "EXHAUSTED")
  mapfile -t runner_error < <(collect_articles_by_status "RUNNER_ERROR")
  mapfile -t batched < <(collect_state_articles "batch_selected")
  mapfile -t published < <(collect_state_articles "published")
  mapfile -t conflicted < <(collect_blocking_event_articles "conflict")
  mapfile -t validation_blocked < <(collect_blocking_event_articles "validation_blocked")

  tlog "publishable PASS: ${#publishable[@]}"
  for article in "${publishable[@]:0:$MAX_BATCH}"; do
    tlog "  ready  $article"
  done
  tlog "conflicted: ${#conflicted[@]}"
  tlog "validation_blocked: ${#validation_blocked[@]}"
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
  refresh_conflict_events
  mapfile -t selected < <(collect_publishable_passes | head -n "$MAX_BATCH")
  if [ "${#selected[@]}" -eq 0 ]; then
    tlog "No publishable PASS artifacts."
    return 0
  fi

  local validated=()
  if [ -z "${TRIBUNAL_PUBLISHER_VALIDATE_HOOK:-}" ] &&
     validate_candidate_batch "${selected[@]}"; then
    validated=("${selected[@]}")
  else
    for article in "${selected[@]}"; do
      if validate_candidate_article "$article"; then
        validated+=("$article")
      else
        record_validation_blocked "$article" "validate-posts failed for candidate artifact"
        tlog "  validation_blocked $article"
      fi
    done
  fi

  if [ "${#validated[@]}" -eq 0 ]; then
    tlog "No valid publishable PASS artifacts after candidate validation."
    return 0
  fi

  batch_id="tribunal-batch-$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)"
  branch_name="${BRANCH_NAME:-publisher/$batch_id}"
  batch_dir="${WORKTREE_PATH:-$ROOT_DIR/.score-loop/publisher/$batch_id}"

  if ! tribunal_fetch_origin_main "$ROOT_DIR" /dev/null; then
    echo "ERROR: unable to refresh origin/main; refusing to publish from a cached ref" >&2
    return 1
  fi

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    echo "ERROR: branch already exists locally: $branch_name" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$batch_dir")"
  git worktree add -b "$branch_name" "$batch_dir" origin/main >/dev/null

  for article in "${validated[@]}"; do
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
  if [ "$SKIP_BUILD" != "1" ]; then
    if ! prepare_batch_logs; then
      tlog "Unable to create private publisher logs; publisher will retry."
      git worktree remove "$batch_dir" --force
      git branch -D "$branch_name" >/dev/null 2>&1 || true
      return 1
    fi
    if ! prepare_batch_dependencies "$batch_dir"; then
      git worktree remove "$batch_dir" --force
      git branch -D "$branch_name" >/dev/null 2>&1 || true
      return 1
    fi

    local build_rc=0
    (
      cd "$batch_dir"
      pnpm run build
    ) >"$BUILD_LOG" 2>&1 || build_rc=$?
    if ! remove_reused_dependency_link "$batch_dir"; then
      tlog "Dependency link cleanup failed; preserving publisher worktree for recovery."
      return 1
    fi
    if [ "$build_rc" -ne 0 ]; then
      local actionable_count=0
      log_publisher_failure_tail "$BUILD_LOG"
      for article in "${validated[@]}"; do
        if [ "$(tribunal_classify_build_failure "$build_rc" "$BUILD_LOG" "$article")" = "actionable" ]; then
          record_validation_blocked "$article" "whole-site build identified target-post content failure"
          actionable_count=$((actionable_count + 1))
        fi
      done
      if [ "$actionable_count" -gt 0 ]; then
        tlog "Batch build failed; blocked $actionable_count target article(s) (rc=$build_rc, log=$BUILD_LOG)."
      else
        tlog "Batch build failed; publisher will retry (rc=$build_rc, log=$BUILD_LOG)."
      fi
      git worktree remove "$batch_dir" --force
      git branch -D "$branch_name" >/dev/null 2>&1 || true
      return 1
    fi
  fi
  if ! git -C "$batch_dir" commit -m "publisher: materialize Tribunal batch $batch_id"; then
    tlog "Batch commit failed; cleaning disposable worktree=$batch_dir branch=$branch_name for retry."
    if ! git worktree remove --force -- "$batch_dir"; then
      tlog "ERROR: batch commit worktree cleanup failed; manual recovery required: worktree=$batch_dir branch=$branch_name"
      return 1
    fi
    if ! git branch -D -- "$branch_name" >/dev/null; then
      tlog "ERROR: batch commit branch cleanup failed; manual recovery required: branch=$branch_name"
      return 1
    fi
    return 1
  fi

  reserve_batch_state "$batch_id" "$branch_name" "${validated[@]}"

  tlog "batch_id=$batch_id"
  tlog "branch=$branch_name"
  tlog "worktree=$batch_dir"
  for article in "${validated[@]}"; do
    tlog "  selected $article"
  done

  if [ "$PUSH_PR" = "1" ]; then
    git -C "$batch_dir" push -u origin "$branch_name" >/dev/null
    for article in "${validated[@]}"; do
      mark_entry_publish_state "$article" "branch_pushed" "$batch_id"
    done
    local pr_url
    pr_url="$(publisher_gh pr create --draft --repo "$REPO" --base main --head "$branch_name" --title "Tribunal publisher batch $batch_id" --body "Automated Tribunal publisher batch." 2>/dev/null || true)"
    if [ -n "$pr_url" ]; then
      local pr_number
      pr_number="$(basename "$pr_url")"
      publisher_gh pr edit "$pr_number" --repo "$REPO" --add-label tribunal-publisher >/dev/null 2>&1 || true
      for article in "${validated[@]}"; do
        mark_entry_publish_state "$article" "pr_open" "$batch_id"
      done
      tlog "pr=$pr_url"
    fi
  fi

  if [ "$KEEP_WORKTREE" = "1" ]; then
    tlog "worktree kept at $batch_dir for inspection"
  else
    git worktree remove "$batch_dir"
    tlog "worktree removed: $batch_dir"
  fi
}

prepare_open_pr_snapshot
ensure_runtime_files

case "$MODE" in
  dry-run) render_report ;;
  status) render_report ;;
  apply) apply_batch ;;
  *) usage; exit 2 ;;
esac
