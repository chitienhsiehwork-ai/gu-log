#!/bin/bash
# cc-cron-tribunal.sh — VM cron entry for tribunal batch scoring
#
# Follows existing CC cron pattern (cc-cron-cp-writer.sh).
# Runs tribunal-batch-runner.sh which processes unscored articles newest→oldest.
#
# Install: Add to crontab on VM
#   0 */2 * * * /home/clawd/clawd/projects/gu-log/scripts/cc-cron-tribunal.sh

set -euo pipefail
export TZ=Asia/Taipei
export CLAUDE_CODE_OAUTH_TOKEN
CLAUDE_CODE_OAUTH_TOKEN=$(head -1 "$HOME/.cc-cron-token")

GU_LOG_DIR="$HOME/clawd/projects/gu-log"
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
