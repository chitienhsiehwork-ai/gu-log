#!/bin/bash
# cc-cron-tribunal.sh — VM cron entry for tribunal batch scoring
#
# Follows existing CC cron pattern (cc-cron-cp-writer.sh).
# Runs tribunal-batch-runner.sh which processes unscored articles newest→oldest.
#
# Install: add to crontab on the Tribunal VM. The wrapper loads GU_LOG_DIR and
# USAGE_MONITOR from the host-local tribunal.env provisioned by the runbook:
#   0 */2 * * * /path/to/gu-log/scripts/cc-cron-tribunal.sh

set -euo pipefail
export TZ=Asia/Taipei
export CLAUDE_CODE_OAUTH_TOKEN
CLAUDE_CODE_OAUTH_TOKEN=$(head -1 "$HOME/.cc-cron-token")

TRIBUNAL_ENV_FILE="${TRIBUNAL_ENV_FILE:-$HOME/.config/gu-log/tribunal.env}"
if [ ! -r "$TRIBUNAL_ENV_FILE" ]; then
  echo "Missing deployment config: $TRIBUNAL_ENV_FILE" >&2
  exit 78
fi
set -a
# shellcheck source=/dev/null
. "$TRIBUNAL_ENV_FILE"
set +a
: "${GU_LOG_DIR:?Missing GU_LOG_DIR in $TRIBUNAL_ENV_FILE}"
: "${USAGE_MONITOR:?Missing USAGE_MONITOR in $TRIBUNAL_ENV_FILE}"
if [ ! -x "$USAGE_MONITOR" ]; then
  echo "USAGE_MONITOR is not executable: $USAGE_MONITOR" >&2
  exit 78
fi

LOG="/tmp/tribunal-cron-$(date +%Y%m%d-%H%M).log"

cd "$GU_LOG_DIR"

# Pull latest before running
git pull --rebase origin main >> "$LOG" 2>&1 || true

echo "=== Tribunal cron started at $(date) ===" >> "$LOG"

# Process up to 3 articles per cron run (each takes ~25 min = ~75 min total)
# Leave 3% quota floor for CEO personal use
bash scripts/tribunal-batch-runner.sh \
  --max 3 \
  --floor 3 \
  >> "$LOG" 2>&1

echo "=== Tribunal cron finished at $(date) ===" >> "$LOG"

# Cleanup old cron logs (keep last 20)
ls -t /tmp/tribunal-cron-*.log 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null
