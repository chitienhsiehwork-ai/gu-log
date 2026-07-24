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
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$SCRIPT_DIR/tribunal-helpers.sh"
  export TRIBUNAL_STRICT_ROLE_PROVIDERS="${TRIBUNAL_STRICT_ROLE_PROVIDERS:-1}"
  export GP_WRITER_MODE="${GP_WRITER_MODE:-cli}"
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
  if tribunal_validate_role_provider_contract >/dev/null &&
     tribunal_writer_preflight >/dev/null; then
    printf 'writer_preflight=passed\n'
  else
    printf 'writer_preflight=failed\n'
    failed=1
  fi
  exit "$failed"
fi

exec bash scripts/tribunal-quota-loop.sh "$@"
