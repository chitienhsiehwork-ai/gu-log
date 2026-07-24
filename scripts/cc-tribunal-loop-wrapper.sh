#!/bin/bash
# cc-tribunal-loop-wrapper.sh — Thin systemd wrapper for tribunal-quota-loop.sh
#
# Loads CLAUDE_CODE_OAUTH_TOKEN from ~/.cc-cron-token before exec-ing the loop.
# Same pattern as cc-cron-tribunal.sh.
#
# Install: ExecStart in ~/.config/systemd/user/tribunal-loop.service

set -euo pipefail
export TZ=Asia/Taipei
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
export CLAUDE_CODE_OAUTH_TOKEN
CLAUDE_CODE_OAUTH_TOKEN=$(head -1 "$HOME/.cc-cron-token")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GU_LOG_DIR="${GU_LOG_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$GU_LOG_DIR"

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
    "$unit_environment" GP_WRITER_MODE "${GP_WRITER_MODE:-cli}")"
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
