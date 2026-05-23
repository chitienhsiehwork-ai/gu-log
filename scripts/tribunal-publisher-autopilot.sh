#!/usr/bin/env bash
# tribunal-publisher-autopilot.sh — advance publishable Tribunal PASS artifacts
# from runtime ledger into main/prod by driving publisher PR creation,
# ready-for-review transitions, guarded auto-merge, and merged-state
# reconciliation.

set -euo pipefail
export TZ=Asia/Taipei

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

source "$SCRIPT_DIR/tribunal-helpers.sh"

PUBLISHER_STATE_FILE="${PUBLISHER_STATE_FILE:-$(tribunal_publisher_state_file "$ROOT_DIR")}"
TRIAGE_EVENTS_FILE="${TRIAGE_EVENTS_FILE:-$(tribunal_triage_events_file "$ROOT_DIR")}"
REPO="${GU_LOG_GITHUB_REPO:-chitienhsiehwork-ai/gu-log}"
GH_BIN="${GH_BIN:-gh}"
MAX_BATCH="${MAX_BATCH:-10}"
SKIP_APPLY=0
DRY_RUN=0
LOCK_FILE="${TRIBUNAL_PUBLISHER_AUTOPILOT_LOCK_FILE:-$ROOT_DIR/.score-loop/locks/publisher-autopilot.lock}"
AUDIT_LOG="${TRIBUNAL_PUBLISHER_AUTOPILOT_AUDIT_LOG:-$ROOT_DIR/.score-loop/state/tribunal-publisher-autopilot.jsonl}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/tribunal-publisher-autopilot.sh [--max N] [--skip-apply] [--dry-run]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --max) MAX_BATCH="$2"; shift 2 ;;
    --skip-apply) SKIP_APPLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

tlog() {
  printf '[publisher-autopilot] %s\n' "$*"
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

ensure_runtime_files() {
  mkdir -p "$(dirname "$PUBLISHER_STATE_FILE")" "$(dirname "$TRIAGE_EVENTS_FILE")" "$(dirname "$LOCK_FILE")" "$(dirname "$AUDIT_LOG")"
  if [ ! -f "$PUBLISHER_STATE_FILE" ] || ! jq empty "$PUBLISHER_STATE_FILE" >/dev/null 2>&1; then
    jq -n '{schemaVersion: 1, entries: {}, batches: {}}' > "$PUBLISHER_STATE_FILE"
  fi
  if [ ! -f "$TRIAGE_EVENTS_FILE" ] || ! jq empty "$TRIAGE_EVENTS_FILE" >/dev/null 2>&1; then
    jq -n '{schemaVersion: 1, events: {}}' > "$TRIAGE_EVENTS_FILE"
  fi
}

audit_event() {
  local event="$1" detail="$2"
  jq -nc \
    --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
    --arg event "$event" \
    --arg detail "$detail" \
    '{timestamp: $ts, event: $event, detail: $detail}' >> "$AUDIT_LOG"
}

list_batch_ids() {
  jq -r '.batches | keys[]?' "$PUBLISHER_STATE_FILE"
}

batch_branch() {
  local batch_id="$1"
  jq -r --arg batch "$batch_id" '.batches[$batch].branch // ""' "$PUBLISHER_STATE_FILE"
}

batch_entries_json() {
  local batch_id="$1"
  jq -c --arg batch "$batch_id" '.batches[$batch].entries // []' "$PUBLISHER_STATE_FILE"
}

update_batch_state() {
  local batch_id="$1" state="$2" pr_number="$3" merge_commit="$4" merged_at="$5"
  local tmp ts entries_json
  ts="$(TZ=Asia/Taipei date -Iseconds)"
  entries_json="$(batch_entries_json "$batch_id")"
  tmp="$(mktemp)"
  jq \
    --arg batch "$batch_id" \
    --arg state "$state" \
    --arg updatedAt "$ts" \
    --arg prNumber "$pr_number" \
    --arg mergeCommit "$merge_commit" \
    --arg mergedAt "$merged_at" \
    --argjson entries "$entries_json" '
      .batches[$batch] = ((.batches[$batch] // {}) + {
        state: $state,
        prNumber: (if $prNumber == "" then (.batches[$batch].prNumber // null) else ($prNumber | tonumber) end),
        mergeCommit: (if $mergeCommit == "" then (.batches[$batch].mergeCommit // null) else $mergeCommit end),
        mergedAt: (if $mergedAt == "" then (.batches[$batch].mergedAt // null) else $mergedAt end),
        updatedAt: $updatedAt
      })
      | reduce $entries[] as $article (.;
          .entries[$article] = ((.entries[$article] // {}) + {
            publishState: $state,
            updatedAt: $updatedAt,
            prNumber: (if $prNumber == "" then (.entries[$article].prNumber // null) else ($prNumber | tonumber) end),
            mergeCommit: (if $mergeCommit == "" then (.entries[$article].mergeCommit // null) else $mergeCommit end),
            mergedAt: (if $mergedAt == "" then (.entries[$article].mergedAt // null) else $mergedAt end)
          })
        )
    ' "$PUBLISHER_STATE_FILE" > "$tmp"
  mv "$tmp" "$PUBLISHER_STATE_FILE"
}

pr_list_json() {
  local state="$1" branch="$2"
  local file_var=""
  if [ "$state" = "open" ]; then
    file_var="${TRIBUNAL_PUBLISHER_AUTOPILOT_OPEN_PRS_JSON_FILE:-}"
  elif [ "$state" = "merged" ]; then
    file_var="${TRIBUNAL_PUBLISHER_AUTOPILOT_MERGED_PRS_JSON_FILE:-}"
  fi
  if [ -n "$file_var" ]; then
    jq --arg branch "$branch" '[.[] | select((.headRefName // "") == $branch)]' "$file_var"
  else
    publisher_gh pr list --repo "$REPO" --state "$state" --head "$branch" --json number,url,isDraft,headRefName,state,mergedAt,mergeCommit
  fi
}

pr_create_for_branch() {
  local batch_id="$1" branch="$2"
  local out pr_number
  if [ -n "${TRIBUNAL_PUBLISHER_AUTOPILOT_CREATE_PR_HOOK:-}" ]; then
    out="$("${TRIBUNAL_PUBLISHER_AUTOPILOT_CREATE_PR_HOOK}" "$batch_id" "$branch")"
  else
    out="$(publisher_gh pr create --draft --repo "$REPO" --base main --head "$branch" --title "Tribunal publisher batch $batch_id" --body "Automated Tribunal publisher batch." 2>/dev/null || true)"
  fi
  [ -n "$out" ] || return 1
  pr_number="$(printf '%s' "$out" | awk 'match($0, /[0-9]+$/) {print substr($0, RSTART, RLENGTH)}')"
  [ -n "$pr_number" ] || return 1
  if [ -z "${TRIBUNAL_PUBLISHER_AUTOPILOT_CREATE_PR_HOOK:-}" ]; then
    publisher_gh pr edit "$pr_number" --repo "$REPO" --add-label tribunal-publisher >/dev/null 2>&1 || true
  fi
  printf '%s\n' "$pr_number"
}

pr_mark_ready() {
  local pr_number="$1"
  if [ -n "${TRIBUNAL_PUBLISHER_AUTOPILOT_READY_HOOK:-}" ]; then
    "${TRIBUNAL_PUBLISHER_AUTOPILOT_READY_HOOK}" "$pr_number"
  elif [ "$DRY_RUN" = "1" ]; then
    tlog "DRY-RUN ready pr=$pr_number"
  else
    publisher_gh pr ready "$pr_number" --repo "$REPO" >/dev/null
  fi
}

run_merge_guard() {
  local pr_number="$1"
  if [ -n "${TRIBUNAL_PUBLISHER_AUTOPILOT_MERGE_GUARD_HOOK:-}" ]; then
    "${TRIBUNAL_PUBLISHER_AUTOPILOT_MERGE_GUARD_HOOK}" "$pr_number"
  elif [ "$DRY_RUN" = "1" ]; then
    tlog "DRY-RUN merge-guard pr=$pr_number"
  else
    bash "$SCRIPT_DIR/gu-log-auto-merge-guard.sh" --pr "$pr_number"
  fi
}

reconcile_merged_batches() {
  local batch_id branch merged_json pr_number merge_commit merged_at
  while IFS= read -r batch_id; do
    [ -n "$batch_id" ] || continue
    branch="$(batch_branch "$batch_id")"
    [ -n "$branch" ] || continue
    merged_json="$(pr_list_json merged "$branch")"
    if [ "$(jq 'length' <<<"$merged_json")" -gt 0 ]; then
      pr_number="$(jq -r '.[0].number // ""' <<<"$merged_json")"
      merge_commit="$(jq -r '.[0].mergeCommit.oid // ""' <<<"$merged_json")"
      merged_at="$(jq -r '.[0].mergedAt // ""' <<<"$merged_json")"
      update_batch_state "$batch_id" "published" "$pr_number" "$merge_commit" "$merged_at"
      tlog "published batch=$batch_id pr=$pr_number"
      audit_event "published" "batch=$batch_id pr=$pr_number branch=$branch"
    fi
  done < <(list_batch_ids)
}

advance_open_batches() {
  local batch_id branch open_json pr_number is_draft current_state
  while IFS= read -r batch_id; do
    [ -n "$batch_id" ] || continue
    branch="$(batch_branch "$batch_id")"
    [ -n "$branch" ] || continue
    open_json="$(pr_list_json open "$branch")"
    if [ "$(jq 'length' <<<"$open_json")" -eq 0 ]; then
      current_state="$(jq -r --arg batch "$batch_id" '.batches[$batch].state // ""' "$PUBLISHER_STATE_FILE")"
      if [ "$current_state" = "branch_pushed" ] || jq -e --arg batch "$batch_id" '.batches[$batch].entries[]? as $a | (.entries[$a].publishState // "") == "branch_pushed"' "$PUBLISHER_STATE_FILE" >/dev/null 2>&1; then
        if pr_number="$(pr_create_for_branch "$batch_id" "$branch" 2>/dev/null)"; then
          update_batch_state "$batch_id" "pr_open" "$pr_number" "" ""
          tlog "recovered pr batch=$batch_id pr=$pr_number"
          audit_event "pr_recovered" "batch=$batch_id pr=$pr_number branch=$branch"
        fi
      fi
      continue
    fi

    pr_number="$(jq -r '.[0].number // ""' <<<"$open_json")"
    is_draft="$(jq -r '.[0].isDraft // false' <<<"$open_json")"
    update_batch_state "$batch_id" "pr_open" "$pr_number" "" ""
    if [ "$is_draft" = "true" ]; then
      pr_mark_ready "$pr_number" || tlog "WARN: failed to ready pr=$pr_number"
      audit_event "pr_ready" "batch=$batch_id pr=$pr_number branch=$branch"
    fi

    if run_merge_guard "$pr_number"; then
      tlog "merge-guard allow pr=$pr_number"
      audit_event "merge_guard_allow" "batch=$batch_id pr=$pr_number"
    else
      rc=$?
      tlog "merge-guard defer pr=$pr_number rc=$rc"
      audit_event "merge_guard_defer" "batch=$batch_id pr=$pr_number rc=$rc"
    fi
  done < <(list_batch_ids)
}

apply_new_batches() {
  if [ "$SKIP_APPLY" = "1" ]; then
    return 0
  fi
  if [ -n "${TRIBUNAL_PUBLISHER_AUTOPILOT_APPLY_HOOK:-}" ]; then
    "${TRIBUNAL_PUBLISHER_AUTOPILOT_APPLY_HOOK}" "$MAX_BATCH"
    return 0
  fi
  bash "$SCRIPT_DIR/tribunal-publisher.sh" --apply --max "$MAX_BATCH" --push-pr || return $?
}

run_once() {
  ensure_runtime_files
  reconcile_merged_batches
  advance_open_batches
  apply_new_batches
  advance_open_batches
  reconcile_merged_batches
}

ensure_runtime_files
exec 9>>"$LOCK_FILE"
flock -n 9 || { tlog "lock busy; skipping"; exit 0; }
run_once
