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

ensure_runtime_files() {
  ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"
  mkdir -p "$(dirname "$PUBLISHER_STATE_FILE")"
  if [ ! -f "$PUBLISHER_STATE_FILE" ] || ! jq empty "$PUBLISHER_STATE_FILE" >/dev/null 2>&1; then
    jq -n '{schemaVersion: 1, entries: {}, batches: {}}' > "$PUBLISHER_STATE_FILE"
  fi
  if [ ! -f "$TRIAGE_EVENTS_FILE" ] || ! jq empty "$TRIAGE_EVENTS_FILE" >/dev/null 2>&1; then
    jq -n '{schemaVersion: 1, events: {}}' > "$TRIAGE_EVENTS_FILE"
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

publisher_gh() {
  local token_file="${GU_LOG_GH_TOKEN_FILE:-$HOME/.config/github-tokens/gu-log-operator.token}"
  if [ -n "${GU_LOG_GH_TOKEN:-}" ]; then
    GH_TOKEN="$GU_LOG_GH_TOKEN" "$GH_BIN" "$@"
    return
  fi
  if [ -f "$token_file" ]; then
    GH_TOKEN="$(cat "$token_file")" "$GH_BIN" "$@"
    return
  fi
  "$GH_BIN" "$@"
}

publisher_has_gh_auth() {
  local token_file="${GU_LOG_GH_TOKEN_FILE:-$HOME/.config/github-tokens/gu-log-operator.token}"
  [ -n "${GU_LOG_GH_TOKEN:-}" ] && return 0
  [ -f "$token_file" ] && return 0
  "$GH_BIN" auth status >/dev/null 2>&1
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

publisher_label_on_pr() {
  local pr_json="$1"
  jq -e 'any(.labels[]?; (.name // "") == "tribunal-publisher")' <<<"$pr_json" >/dev/null 2>&1
}

open_pr_list_json() {
  if [ "${TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN:-0}" = "1" ]; then
    printf '[]\n'
  elif [ -n "${TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE:-}" ]; then
    cat "$TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE"
  elif ! publisher_has_gh_auth; then
    printf '[]\n'
  else
    publisher_gh pr list --repo "$REPO" --state open --limit 200 --json number,title,headRefName,labels
  fi
}

open_pr_files_json() {
  local pr_number="$1"
  if [ "${TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN:-0}" = "1" ]; then
    printf '{"files":[]}\n'
  elif [ -n "${TRIBUNAL_PUBLISHER_PR_FILES_DIR:-}" ] && [ -f "$TRIBUNAL_PUBLISHER_PR_FILES_DIR/$pr_number.json" ]; then
    cat "$TRIBUNAL_PUBLISHER_PR_FILES_DIR/$pr_number.json"
  elif ! publisher_has_gh_auth; then
    printf '{"files":[]}\n'
  else
    publisher_gh pr view "$pr_number" --repo "$REPO" --json files
  fi
}

article_conflict_targets_json() {
  local article="$1"
  local rels_json prs_json
  rels_json="$(post_relpaths_for_article "$article" | jq -R . | jq -s .)"
  prs_json="$(open_pr_list_json)"
  python3 - "$article" "$rels_json" "$prs_json" <<'PY'
import json, os, subprocess, sys
article = sys.argv[1]
rels = json.loads(sys.argv[2])
prs = json.loads(sys.argv[3])
targets = []
for pr in prs:
    labels = pr.get("labels", []) or []
    if (pr.get("headRefName", "") or "").startswith("publisher/"):
        continue
    if any((label.get("name", "") == "tribunal-publisher") for label in labels):
        continue
    num = pr["number"]
    files_dir = os.environ.get("TRIBUNAL_PUBLISHER_PR_FILES_DIR")
    if files_dir and os.path.isfile(os.path.join(files_dir, f"{num}.json")):
        with open(os.path.join(files_dir, f"{num}.json"), "r", encoding="utf-8") as fh:
            files_json = json.load(fh)
    else:
        gh_bin = os.environ.get("GH_BIN", "gh")
        repo = os.environ.get("GU_LOG_GITHUB_REPO", "chitienhsiehwork-ai/gu-log")
        token = os.environ.get("GU_LOG_GH_TOKEN")
        token_file = os.environ.get("GU_LOG_GH_TOKEN_FILE", os.path.expanduser("~/.config/github-tokens/gu-log-operator.token"))
        env = os.environ.copy()
        if not token and os.path.isfile(token_file):
            with open(token_file, "r", encoding="utf-8") as fh:
                env["GH_TOKEN"] = fh.read().strip()
        elif token:
            env["GH_TOKEN"] = token
        out = subprocess.check_output([gh_bin, "pr", "view", str(num), "--repo", repo, "--json", "files"], env=env)
        files_json = json.loads(out)
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
    targets_json="$(article_conflict_targets_json "$article" <<<"$(open_pr_list_json)")"
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

validate_candidate_article() {
  local article="$1"
  if [ -n "${TRIBUNAL_PUBLISHER_VALIDATE_HOOK:-}" ]; then
    "${TRIBUNAL_PUBLISHER_VALIDATE_HOOK}" "$article"
    return
  fi
  local args=("$article")
  if [ -f "$POSTS_DIR/en-$article" ]; then
    args+=("en-$article")
  fi
  node "$ROOT_DIR/scripts/validate-posts.mjs" "${args[@]}" >/tmp/tribunal-publisher-validate.out 2>&1
}

record_validation_blocked() {
  local article="$1" reason="$2"
  local options_json targets_json fingerprint
  options_json='["validation_fix","requeue","defer","no_action"]'
  targets_json="$(post_relpaths_for_article "$article" | jq -R '{path: .}' | jq -s .)"
  fingerprint="$(printf '%s' "$reason" | sha1sum | awk '{print substr($1,1,16)}')"
  record_event "validation_blocked" "$article" "$fingerprint" "$targets_json" "$reason" "$options_json" >/dev/null
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
  for article in "${selected[@]}"; do
    if validate_candidate_article "$article"; then
      validated+=("$article")
    else
      record_validation_blocked "$article" "validate-posts failed for candidate artifact"
      tlog "  validation_blocked $article"
    fi
  done

  if [ "${#validated[@]}" -eq 0 ]; then
    tlog "No valid publishable PASS artifacts after candidate validation."
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
    if ! (cd "$batch_dir" && pnpm run build >/tmp/tribunal-publisher-build.out 2>&1); then
      local reason="whole-site build failed for batch"
      for article in "${validated[@]}"; do
        record_validation_blocked "$article" "$reason"
      done
      tlog "Batch build failed; emitted validation_blocked events."
      git worktree remove "$batch_dir" --force
      git branch -D "$branch_name" >/dev/null 2>&1 || true
      return 1
    fi
  fi
  git -C "$batch_dir" commit -m "publisher: materialize Tribunal batch $batch_id" >/dev/null

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

  if [ "$KEEP_WORKTREE" != "1" ]; then
    tlog "worktree kept at $batch_dir for inspection"
  fi
}

ensure_runtime_files

case "$MODE" in
  dry-run) render_report ;;
  status) render_report ;;
  apply) apply_batch ;;
  *) usage; exit 2 ;;
esac
