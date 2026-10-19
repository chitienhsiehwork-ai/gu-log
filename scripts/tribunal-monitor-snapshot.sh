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

invalid_deploy_env() {
  echo "Invalid $deploy_env; follow docs/tribunal-runbook.md" >&2
  exit 78
}

# This is a read-only diagnostic, so treat tribunal.env as data rather than
# sourcing executable shell. The deploy bootstrap writes either bare values or
# single-quoted values with embedded single quotes forbidden.
GU_LOG_DIR=""
unset USAGE_MONITOR
QUOTA_FLOOR=""
GP_WRITER_MODE=""
TRIBUNAL_STRICT_ROLE_PROVIDERS=""
declare -A deploy_env_seen=()
while IFS= read -r deploy_env_line || [ -n "$deploy_env_line" ]; do
  case "$deploy_env_line" in
    GU_LOG_DIR=* | USAGE_MONITOR=* | QUOTA_FLOOR=* | GP_WRITER_MODE=* | \
      TRIBUNAL_STRICT_ROLE_PROVIDERS=*) ;;
    # EnvironmentFile may grow comments, syntax, or settings that this
    # monitor does not consume. Ignore those lines as opaque data.
    *) continue ;;
  esac
  if [[ ! "$deploy_env_line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    invalid_deploy_env
  fi
  deploy_env_key="${BASH_REMATCH[1]}"
  deploy_env_value="${BASH_REMATCH[2]}"
  case "$deploy_env_key" in
    GU_LOG_DIR | USAGE_MONITOR | QUOTA_FLOOR | GP_WRITER_MODE | \
      TRIBUNAL_STRICT_ROLE_PROVIDERS) ;;
    *) invalid_deploy_env ;;
  esac
  if [ -n "${deploy_env_seen[$deploy_env_key]:-}" ]; then
    invalid_deploy_env
  fi
  deploy_env_seen["$deploy_env_key"]=1
  if [[ "$deploy_env_value" == \'* ]]; then
    if [[ "$deploy_env_value" != *\' ]] || [ "${#deploy_env_value}" -lt 2 ]; then
      invalid_deploy_env
    fi
    deploy_env_value="${deploy_env_value:1:${#deploy_env_value}-2}"
    [[ "$deploy_env_value" != *\'* ]] || invalid_deploy_env
  elif [[ "$deploy_env_value" == \"* ]]; then
    if [[ "$deploy_env_value" != *\" ]] || [ "${#deploy_env_value}" -lt 2 ]; then
      invalid_deploy_env
    fi
    deploy_env_value="${deploy_env_value:1:${#deploy_env_value}-2}"
    [[ "$deploy_env_value" != *\"* ]] || invalid_deploy_env
  elif [[ "$deploy_env_value" == *\'* ]]; then
    invalid_deploy_env
  fi
  printf -v "$deploy_env_key" '%s' "$deploy_env_value"
done < "$deploy_env"
unset deploy_env_line deploy_env_key deploy_env_value deploy_env_seen

if [ -z "$GU_LOG_DIR" ] || [[ "$GU_LOG_DIR" != /* ]]; then
  echo "Missing GU_LOG_DIR in $deploy_env" >&2
  exit 78
fi
if ! cd "$GU_LOG_DIR"; then
  echo "Invalid GU_LOG_DIR in $deploy_env" >&2
  exit 78
fi

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

unit_file_state() {
  local tracked="$1" installed="$2" expected_fragment="$3"
  local manager_ok="$4" fragment="$5" need_reload="$6"
  if [ ! -r "$tracked" ]; then
    echo "tracked_missing"
  elif [ ! -e "$installed" ]; then
    echo "missing"
  elif ! cmp -s "$tracked" "$installed"; then
    echo "stale"
  elif [ "$manager_ok" != "true" ]; then
    echo "manager_unknown"
  elif [ -z "$fragment" ]; then
    echo "not_loaded"
  elif [ "$fragment" != "$expected_fragment" ]; then
    echo "wrong_fragment"
  elif [ "$need_reload" = "yes" ]; then
    echo "reload_needed"
  elif [ "$need_reload" = "no" ]; then
    echo "current"
  else
    echo "manager_unknown"
  fi
}

systemctl_property() {
  local unit="$1" property="$2"
  systemctl --user show "$unit" -p "$property" --value 2>/dev/null
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
unit_environment_available=false
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user status tribunal-loop 2>&1 | head -15 || true
  if unit_environment="$(
    systemctl --user show tribunal-loop -p Environment --value 2>/dev/null
  )"; then
    unit_environment_available=true
  else
    unit_environment=""
  fi
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

echo "══════ PASS AUDIT ══════"
user_unit_dir="$HOME/.config/systemd/user"
audit_service="tribunal-pass-audit.service"
audit_timer="tribunal-pass-audit.timer"
if command -v systemctl >/dev/null 2>&1; then
  audit_service_manager_ok=true
  audit_timer_manager_ok=true
  if ! audit_service_fragment="$(
    systemctl_property "$audit_service" FragmentPath
  )"; then
    audit_service_manager_ok=false
    audit_service_fragment=""
  fi
  if ! audit_timer_fragment="$(
    systemctl_property "$audit_timer" FragmentPath
  )"; then
    audit_timer_manager_ok=false
    audit_timer_fragment=""
  fi
  if ! audit_service_need_reload="$(
    systemctl_property "$audit_service" NeedDaemonReload
  )"; then
    audit_service_manager_ok=false
    audit_service_need_reload=""
  fi
  if ! audit_timer_need_reload="$(
    systemctl_property "$audit_timer" NeedDaemonReload
  )"; then
    audit_timer_manager_ok=false
    audit_timer_need_reload=""
  fi
  audit_timer_enabled="$(
    systemctl --user is-enabled "$audit_timer" 2>/dev/null || true
  )"
  audit_timer_active="$(
    systemctl --user is-active "$audit_timer" 2>/dev/null || true
  )"
  if ! audit_timer_next="$(
    systemctl_property "$audit_timer" NextElapseUSecRealtime
  )"; then
    audit_timer_next="unknown"
  fi
  if ! audit_timer_last_trigger="$(
    systemctl_property "$audit_timer" LastTriggerUSec
  )"; then
    audit_timer_last_trigger="unknown"
  fi
  if ! audit_service_result="$(
    systemctl_property "$audit_service" Result
  )"; then
    audit_service_result="unknown"
  fi
  if ! audit_service_exit_status="$(
    systemctl_property "$audit_service" ExecMainStatus
  )"; then
    audit_service_exit_status="unknown"
  fi
  if ! audit_service_active_state="$(
    systemctl_property "$audit_service" ActiveState
  )"; then
    audit_service_active_state="unknown"
  fi
  if ! audit_service_sub_state="$(
    systemctl_property "$audit_service" SubState
  )"; then
    audit_service_sub_state="unknown"
  fi
  if ! audit_service_start_timestamp="$(
    systemctl_property "$audit_service" ExecMainStartTimestamp
  )"; then
    audit_service_start_timestamp="unknown"
  fi
  if ! audit_service_exit_timestamp="$(
    systemctl_property "$audit_service" ExecMainExitTimestamp
  )"; then
    audit_service_exit_timestamp="unknown"
    audit_service_run_state="unknown"
  elif [ "$audit_service_active_state" = "active" ] ||
    [ "$audit_service_active_state" = "activating" ]; then
    audit_service_exit_timestamp="pending"
    audit_service_run_state="running"
    audit_service_result="unavailable"
    audit_service_exit_status="unavailable"
  elif [ "$audit_service_active_state" = "failed" ] &&
    [ -z "$audit_service_exit_timestamp" ]; then
    audit_service_exit_timestamp="unavailable"
    audit_service_run_state="failed_before_completion"
  elif [ -n "$audit_service_exit_timestamp" ]; then
    audit_service_run_state="observed"
  elif [ -z "$audit_service_start_timestamp" ]; then
    audit_service_start_timestamp="never"
    audit_service_exit_timestamp="never"
    audit_service_run_state="never_run"
    audit_service_result="unavailable"
    audit_service_exit_status="unavailable"
  else
    audit_service_exit_timestamp="unavailable"
    audit_service_run_state="incomplete"
  fi
  if ! audit_service_drop_ins="$(
    systemctl_property "$audit_service" DropInPaths
  )"; then
    audit_service_drop_ins="unknown"
  fi
  if ! audit_timer_drop_ins="$(
    systemctl_property "$audit_timer" DropInPaths
  )"; then
    audit_timer_drop_ins="unknown"
  fi
else
  audit_service_manager_ok=false
  audit_timer_manager_ok=false
  audit_service_fragment=""
  audit_timer_fragment=""
  audit_service_need_reload=""
  audit_timer_need_reload=""
  audit_timer_enabled="unknown"
  audit_timer_active="unknown"
  audit_timer_next="unknown"
  audit_timer_last_trigger="unknown"
  audit_service_active_state="unknown"
  audit_service_sub_state="unknown"
  audit_service_start_timestamp="unknown"
  audit_service_run_state="unknown"
  audit_service_exit_timestamp="unknown"
  audit_service_result="unknown"
  audit_service_exit_status="unknown"
  audit_service_drop_ins="unknown"
  audit_timer_drop_ins="unknown"
fi
echo "service_unit_file=$(
  unit_file_state \
    "$GU_LOG_DIR/scripts/$audit_service" \
    "$user_unit_dir/$audit_service" \
    "$user_unit_dir/$audit_service" \
    "$audit_service_manager_ok" \
    "$audit_service_fragment" \
    "$audit_service_need_reload"
)"
echo "timer_unit_file=$(
  unit_file_state \
    "$GU_LOG_DIR/scripts/$audit_timer" \
    "$user_unit_dir/$audit_timer" \
    "$user_unit_dir/$audit_timer" \
    "$audit_timer_manager_ok" \
    "$audit_timer_fragment" \
    "$audit_timer_need_reload"
)"
[ -n "$audit_timer_enabled" ] || audit_timer_enabled="unknown"
[ -n "$audit_timer_active" ] || audit_timer_active="unknown"
[ -n "$audit_timer_next" ] || audit_timer_next="unavailable"
[ -n "$audit_timer_last_trigger" ] || audit_timer_last_trigger="never"
[ -n "$audit_service_active_state" ] || audit_service_active_state="unknown"
[ -n "$audit_service_sub_state" ] || audit_service_sub_state="unknown"
[ -n "$audit_service_start_timestamp" ] ||
  audit_service_start_timestamp="never"
[ -n "$audit_service_run_state" ] || audit_service_run_state="unknown"
[ -n "$audit_service_exit_timestamp" ] ||
  audit_service_exit_timestamp="unknown"
[ -n "$audit_service_result" ] || audit_service_result="unavailable"
[ -n "$audit_service_exit_status" ] || audit_service_exit_status="unavailable"
[ -n "$audit_service_drop_ins" ] || audit_service_drop_ins="none"
[ -n "$audit_timer_drop_ins" ] || audit_timer_drop_ins="none"
echo "timer_enabled=$audit_timer_enabled"
echo "timer_active=$audit_timer_active"
echo "timer_next=$audit_timer_next"
echo "timer_last_trigger=$audit_timer_last_trigger"
echo "service_active_state=$audit_service_active_state"
echo "service_sub_state=$audit_service_sub_state"
echo "service_run_state=$audit_service_run_state"
echo "service_last_started_at=$audit_service_start_timestamp"
echo "service_last_finished_at=$audit_service_exit_timestamp"
echo "service_last_result=$audit_service_result"
echo "service_last_exit_status=$audit_service_exit_status"
echo "service_drop_ins=$audit_service_drop_ins"
echo "timer_drop_ins=$audit_timer_drop_ins"
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

if [ "$unit_environment_available" = "true" ]; then
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
  configured_floor="${effective_quota_floor}%"
else
  configured_floor="unavailable"
  effective_writer_mode="unavailable"
  effective_strict_roles="unavailable"
fi

echo "══════ QUOTA ══════"
echo "configured_floor=$configured_floor"
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
