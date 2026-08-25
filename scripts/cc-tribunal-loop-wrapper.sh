#!/bin/bash
# cc-tribunal-loop-wrapper.sh — Thin systemd wrapper for tribunal-quota-loop.sh
#
# Install: ExecStart in ~/.config/systemd/user/tribunal-loop.service

set -euo pipefail
export TZ=Asia/Taipei
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
export TRIBUNAL_RUNTIME_PROFILE="${TRIBUNAL_RUNTIME_PROFILE:-legacy}"
export GP_WRITER_MODE="${GP_WRITER_MODE:-codex}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GU_LOG_DIR="${GU_LOG_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$GU_LOG_DIR"

if [ "$TRIBUNAL_RUNTIME_PROFILE" = "vm-codex" ]; then
  detected_identity="$(
    bash "$SCRIPT_DIR/detect-env.sh" --runtime codex --identity 2>/dev/null || true
  )"
  if [ "$detected_identity" != "vm-codex" ]; then
    printf 'vm-codex profile rejected on detected identity: %s\n' \
      "${detected_identity:-unknown}" >&2
    exit 78
  fi
fi

if [ "${1:-}" = "--doctor" ]; then
  if [ "$#" -gt 2 ]; then
    printf 'Usage: %s --doctor [--live-probe]\n' "$0" >&2
    exit 64
  fi
  case "${2:-}" in
    "") live_probe=0 ;;
    --live-probe) live_probe=1 ;;
    *)
      printf 'Usage: %s --doctor [--live-probe]\n' "$0" >&2
      exit 64
      ;;
  esac
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$SCRIPT_DIR/tribunal-helpers.sh"
  unit_environment="$(systemctl --user show tribunal-loop -p Environment --value 2>/dev/null || true)"
  export TRIBUNAL_STRICT_ROLE_PROVIDERS
  TRIBUNAL_STRICT_ROLE_PROVIDERS="$(tribunal_effective_runtime_value \
    "$unit_environment" TRIBUNAL_STRICT_ROLE_PROVIDERS "${TRIBUNAL_STRICT_ROLE_PROVIDERS:-1}")"
  export GP_WRITER_MODE
  GP_WRITER_MODE="$(tribunal_effective_runtime_value \
    "$unit_environment" GP_WRITER_MODE "${GP_WRITER_MODE:-codex}")"
  failed=0
  unit_enabled="$(systemctl --user is-enabled tribunal-loop 2>/dev/null || true)"
  [ -n "$unit_enabled" ] || unit_enabled="unknown"
  printf 'unit_enabled=%s\n' "$unit_enabled"
  [ "$unit_enabled" = "enabled" ] || failed=1
  if command -v loginctl >/dev/null 2>&1; then
    linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)"
    [ -n "$linger" ] || linger="unknown"
    printf 'linger=%s\n' "$linger"
    [ "$linger" = "yes" ] || failed=1
  else
    printf 'linger=unknown\n'
    failed=1
  fi
  printf 'writer_mode=%s\n' "$(tribunal_writer_mode)"
  printf 'strict_role_providers=%s\n' "$TRIBUNAL_STRICT_ROLE_PROVIDERS"
  if tribunal_validate_deployed_systemd_contract >/dev/null; then
    printf 'systemd_containment=passed slice=tribunal-runtime.slice\n'
  else
    printf 'systemd_containment=failed slice=tribunal-runtime.slice\n'
    failed=1
  fi
  read_service_contract_snapshot() {
    local fragment_property need_reload_property drop_ins_property
    fragment_property="$(
      systemctl --user show tribunal-loop.service \
        -p FragmentPath 2>/dev/null
    )" || return 1
    need_reload_property="$(
      systemctl --user show tribunal-loop.service \
        -p NeedDaemonReload 2>/dev/null
    )" || return 1
    drop_ins_property="$(
      systemctl --user show tribunal-loop.service \
        -p DropInPaths 2>/dev/null
    )" || return 1
    case "$fragment_property" in
      FragmentPath=*) service_fragment="${fragment_property#FragmentPath=}" ;;
      *) return 1 ;;
    esac
    case "$need_reload_property" in
      NeedDaemonReload=*) service_need_reload="${need_reload_property#NeedDaemonReload=}" ;;
      *) return 1 ;;
    esac
    case "$drop_ins_property" in
      DropInPaths=*) service_drop_ins="${drop_ins_property#DropInPaths=}" ;;
      *) return 1 ;;
    esac
    [ -n "$service_fragment" ] && [ -n "$service_need_reload" ]
  }

  expected_service_fragment="$HOME/.config/systemd/user/tribunal-loop.service"
  service_fragment=""
  service_need_reload=""
  service_drop_ins=""
  if ! read_service_contract_snapshot; then
    printf 'systemd_service_contract=failed unit=tribunal-loop.service reason=query-failed\n'
    failed=1
  elif [ "$service_fragment" != "$expected_service_fragment" ] ||
       [ -L "$service_fragment" ] ||
       [ ! -f "$service_fragment" ] ||
       [ ! -r "$service_fragment" ] ||
       [ ! -f "$SCRIPT_DIR/tribunal-loop.service" ] ||
       [ ! -r "$SCRIPT_DIR/tribunal-loop.service" ]; then
    printf 'systemd_service_contract=failed unit=tribunal-loop.service reason=fragment-mismatch FragmentPath=%s ExpectedFragmentPath=%s\n' \
      "${service_fragment:-unknown}" "$expected_service_fragment"
    failed=1
  elif [ "$service_need_reload" != "no" ] || [ -n "$service_drop_ins" ]; then
    printf 'systemd_service_contract=failed unit=tribunal-loop.service reason=unreviewed-drift NeedDaemonReload=%s DropInPaths=%s\n' \
      "${service_need_reload:-unknown}" "${service_drop_ins:-<none>}"
    failed=1
  elif ! cmp -s -- "$SCRIPT_DIR/tribunal-loop.service" "$service_fragment"; then
    printf 'systemd_service_contract=failed unit=tribunal-loop.service reason=fragment-mismatch FragmentPath=%s\n' \
      "${service_fragment:-unknown}"
    failed=1
  else
    service_fragment_before="$service_fragment"
    service_need_reload_before="$service_need_reload"
    service_drop_ins_before="$service_drop_ins"
    if ! read_service_contract_snapshot; then
      printf 'systemd_service_contract=failed unit=tribunal-loop.service reason=query-failed\n'
      failed=1
    elif [ "$service_fragment" != "$service_fragment_before" ] ||
         [ "$service_need_reload" != "$service_need_reload_before" ] ||
         [ "$service_drop_ins" != "$service_drop_ins_before" ]; then
      printf 'systemd_service_contract=failed unit=tribunal-loop.service reason=snapshot-changed\n'
      failed=1
    else
      printf 'systemd_service_contract=passed unit=tribunal-loop.service\n'
    fi
  fi
  if ! tribunal_validate_role_provider_contract >/dev/null; then
    printf 'role_provider_contract=failed\n'
    failed=1
  else
    printf 'role_provider_contract=passed\n'
  fi
  if [ "$live_probe" = "1" ]; then
    probe_output="$(tribunal_writer_preflight 2>/dev/null || true)"
    if [ "$probe_output" = "OK" ]; then
      printf 'writer_preflight=passed source=live result=OK\n'
    else
      printf 'writer_preflight=failed source=live\n'
      failed=1
    fi
  else
    state_file="$GU_LOG_DIR/.score-loop/state/writer-preflight.json"
    main_pid="$(systemctl --user show tribunal-loop -p MainPID --value 2>/dev/null || true)"
    [ -n "$main_pid" ] || main_pid=0
    state_status="$(jq -r '.status // empty' "$state_file" 2>/dev/null || true)"
    state_mode="$(jq -r '.mode // empty' "$state_file" 2>/dev/null || true)"
    state_pid="$(jq -r '.pid // 0' "$state_file" 2>/dev/null || true)"
    if [ "$state_status" = "passed" ] &&
       [ "$state_mode" = "$GP_WRITER_MODE" ] &&
       [ "$main_pid" -gt 0 ] 2>/dev/null &&
       [ "$state_pid" = "$main_pid" ]; then
      printf 'writer_preflight=passed source=state pid=%s\n' "$state_pid"
    else
      printf 'writer_preflight=failed source=state main_pid=%s state_pid=%s\n' \
        "$main_pid" "$state_pid"
      failed=1
    fi
  fi
  exit "$failed"
fi

exec bash scripts/tribunal-quota-loop.sh "$@"
