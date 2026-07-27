#!/usr/bin/env bash
# tribunal-monitor-snapshot.sh — stateless, read-only Tribunal diagnostics
#
# This script is streamed from the caller's current checkout over SSH. It
# deliberately reads runtime state without installing files, advancing a
# journal cursor, updating git refs, or changing the systemd unit.

set -uo pipefail
export LC_ALL=C

deploy_env="$HOME/.config/gu-log/tribunal.env"
if [ ! -r "$deploy_env" ]; then
  echo "Missing $deploy_env; follow docs/tribunal-runbook.md" >&2
  exit 78
fi

set -a
# shellcheck source=/dev/null
if ! . "$deploy_env"; then
  set +a
  echo "Invalid $deploy_env; follow docs/tribunal-runbook.md" >&2
  exit 78
fi
set +a
if [ -z "${GU_LOG_DIR:-}" ]; then
  echo "Missing GU_LOG_DIR in $deploy_env" >&2
  exit 78
fi
cd "$GU_LOG_DIR" || exit 78

generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

unit_environment_value() {
  local environment="$1" key="$2"
  printf '%s\n' "$environment" |
    tr ' ' '\n' |
    sed -n "s/^${key}=//p" |
    tail -1
}

effective_runtime_value() {
  local environment="$1" key="$2" fallback="$3"
  local unit_value
  unit_value="$(unit_environment_value "$environment" "$key")"
  if [ -n "$unit_value" ]; then
    printf '%s\n' "$unit_value"
  else
    printf '%s\n' "$fallback"
  fi
}

print_json_file() {
  local file="$1" label="$2"
  if ! command -v jq >/dev/null 2>&1; then
    echo "(unavailable: jq is not installed; cannot validate $label)"
  elif [ ! -r "$file" ]; then
    echo "(unavailable: no $label)"
  elif ! jq empty "$file" >/dev/null 2>&1; then
    echo "(unavailable: invalid $label)"
  else
    jq . "$file"
  fi
}

most_recent_supervisor_log() {
  local candidate latest=""
  for candidate in .score-loop/logs/tribunal-quota-loop-[0-9]*.log; do
    [ -f "$candidate" ] || continue
    if [ -z "$latest" ] || [[ "$candidate" -nt "$latest" ]]; then
      latest="$candidate"
    fi
  done
  printf '%s\n' "$latest"
}

echo "generated_at=$generated_at"
echo "snapshot_semantics=read_only_last_observed"
echo

echo "══════ SERVICE ══════"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user status tribunal-loop 2>&1 | head -15 || true
  unit_environment="$(systemctl --user show tribunal-loop -p Environment --value 2>/dev/null || true)"
  unit_enabled="$(systemctl --user is-enabled tribunal-loop 2>/dev/null || true)"
  [ -n "$unit_enabled" ] || unit_enabled="unknown"
else
  echo "(unavailable: systemctl is not installed)"
  unit_environment=""
  unit_enabled="unknown"
fi
runtime_user="${USER:-}"
if [ -z "$runtime_user" ] && command -v id >/dev/null 2>&1; then
  runtime_user="$(id -un 2>/dev/null || true)"
fi
if [ -n "$runtime_user" ] && command -v loginctl >/dev/null 2>&1; then
  linger="$(loginctl show-user "$runtime_user" -p Linger --value 2>/dev/null || true)"
else
  linger="unknown"
fi
[ -n "$linger" ] || linger="unknown"
echo "unit_enabled=$unit_enabled"
echo "linger=$linger"
echo

echo "══════ RUNTIME STATE ══════"
print_json_file ".score-loop/state/runtime.json" "runtime.json"
echo

echo "══════ STOP FLAG ══════"
if [ -f .score-loop/control/stop-graceful ]; then
  echo "⚠ stop-graceful flag EXISTS — service will not dispatch new articles"
else
  echo "✓ no stop flag"
fi
echo

effective_quota_floor="$(
  effective_runtime_value "$unit_environment" QUOTA_FLOOR "${QUOTA_FLOOR:-10}"
)"
effective_writer_mode="$(
  effective_runtime_value "$unit_environment" GP_WRITER_MODE "${GP_WRITER_MODE:-none}"
)"
effective_strict_roles="$(
  effective_runtime_value \
    "$unit_environment" \
    TRIBUNAL_STRICT_ROLE_PROVIDERS \
    "${TRIBUNAL_STRICT_ROLE_PROVIDERS:-0}"
)"

echo "══════ QUOTA ══════"
echo "configured_floor=${effective_quota_floor}%"
print_json_file ".score-loop/state/quota-controller.json" "quota-controller.json"
echo

echo "══════ WRITER PREFLIGHT ══════"
echo "writer_mode=${effective_writer_mode}"
echo "strict_role_providers=${effective_strict_roles}"
print_json_file ".score-loop/state/writer-preflight.json" "writer-preflight.json"
echo

supervisor_log="$(most_recent_supervisor_log)"

echo "══════ LATEST CONTROLLER DECISIONS (most recently updated supervisor log, max 5) ══════"
if [ -z "$supervisor_log" ]; then
  echo "(unavailable: no supervisor log)"
else
  echo "source=$supervisor_log"
  controller_lines="$(
    grep -E \
      '^[[][^]]+[]] [[]quota-loop[]] CONTROLLER:' \
      "$supervisor_log" 2>/dev/null |
      tail -5 || true
  )"
  if [ -n "$controller_lines" ]; then
    printf '%s\n' "$controller_lines"
  else
    echo "(no controller observation in selected supervisor log)"
  fi
fi
echo

echo "══════ QUEUE COUNT (last observed in most recently updated supervisor log) ══════"
if [ -z "$supervisor_log" ]; then
  echo "status=unavailable reason=no_supervisor_log"
else
  queue_line="$(
    grep -E \
      '^[[][^]]+[]] [[]quota-loop[]] ([0-9]+ unscored articles remaining[.]|No unscored articles and no workers in-flight[.])' \
      "$supervisor_log" 2>/dev/null |
      tail -1 || true
  )"
  if [ -z "$queue_line" ]; then
    echo "status=unavailable reason=no_observation source=$supervisor_log"
  else
    observed_at="${queue_line#\[}"
    observed_at="${observed_at%%]*}"
    if [[ "$queue_line" == *"No unscored articles and no workers in-flight"* ]]; then
      queue_count=0
    else
      queue_count="$(
        printf '%s\n' "$queue_line" |
          sed -nE \
            's/^[[][^]]+[]] [[]quota-loop[]] ([0-9]+) unscored articles remaining[.].*/\1/p'
      )"
    fi
    if [[ "$queue_count" =~ ^[0-9]+$ ]]; then
      echo "status=observed semantics=last_observed count=$queue_count observed_at=$observed_at source=$supervisor_log"
    else
      echo "status=unavailable reason=invalid_observation source=$supervisor_log"
    fi
  fi
fi
echo

echo "══════ RECENT FINISHED ATTEMPTS (runtime ledger, max 15) ══════"
progress_file=".score-loop/state/tribunal-progress.json"
if ! command -v jq >/dev/null 2>&1; then
  echo "(unavailable: jq is not installed; cannot validate runtime ledger)"
elif [ ! -r "$progress_file" ]; then
  echo "(unavailable: no runtime ledger)"
elif ! jq empty "$progress_file" >/dev/null 2>&1; then
  echo "(unavailable: invalid runtime ledger)"
elif ! jq -e 'type == "object"' "$progress_file" >/dev/null 2>&1; then
  echo "(unavailable: invalid runtime ledger schema)"
else
  if recent_results="$(
    jq -c '
      to_entries
      | map(select(
          (.value | type) == "object"
          and (.value.finishedAt | type) == "string"
          and (.value.finishedAt | length) > 0
          and (.value.status | type) == "string"
        ))
      | sort_by(.value.finishedAt)
      | reverse
      | .[:15]
      | .[]
      | {
          article: .key,
          status: .value.status,
          failedStage: (.value.failedStage // null),
          finishedAt: .value.finishedAt
        }
    ' "$progress_file" 2>/dev/null
  )"; then
    if [ -n "$recent_results" ]; then
      printf '%s\n' "$recent_results"
    else
      echo "(no finished attempts recorded)"
    fi
  else
    echo "(unavailable: runtime ledger query failed)"
  fi
fi
echo

echo "══════ SUPERVISOR CHECKOUT (live read-only) ══════"
if supervisor_head="$(
  git -C "$GU_LOG_DIR" rev-parse --verify HEAD 2>/dev/null
)" && [ -n "$supervisor_head" ]; then
  echo "status=observed semantics=live_read_only head=$supervisor_head"
else
  echo "status=unavailable reason=git_head_unreadable"
fi
echo

echo "══════ RUNTIME GIT OBSERVATION (last daemon tick) ══════"
print_json_file ".score-loop/state/runtime-git.json" "runtime-git.json"
echo

echo "══════ MEMORY (peak) ══════"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user show tribunal-loop --property=MemoryPeak 2>/dev/null || echo "(unavailable)"
else
  echo "(unavailable: systemctl is not installed)"
fi
echo

echo "══════ WORKER WORKTREES ══════"
worker_parent="$(dirname "$GU_LOG_DIR")"
found_worker=false
for worktree in "$worker_parent"/gu-log-worker-*; do
  if [ -d "$worktree" ]; then
    found_worker=true
    worktree_head="$(git -C "$worktree" rev-parse --short HEAD 2>/dev/null || echo "?")"
    echo "  $(basename "$worktree"): $worktree_head"
  fi
done
[ "$found_worker" = true ] || echo "  (no worker worktrees found)"
