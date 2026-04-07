#!/bin/bash
# cc-tribunal-loop-wrapper.sh — Thin systemd wrapper for tribunal-quota-loop.sh
#
# Loads CLAUDE_CODE_OAUTH_TOKEN from ~/.cc-cron-token before exec-ing the loop.
# Same pattern as cc-cron-tribunal.sh.
#
# Install: ExecStart in ~/.config/systemd/user/tribunal-loop.service

set -euo pipefail
export TZ=Asia/Taipei
export CLAUDE_CODE_OAUTH_TOKEN
CLAUDE_CODE_OAUTH_TOKEN=$(head -1 "$HOME/.cc-cron-token")

cd "$HOME/clawd/projects/gu-log"
exec bash scripts/tribunal-quota-loop.sh "$@"
