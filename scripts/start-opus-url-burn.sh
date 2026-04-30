#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .score-loop/logs .score-loop/opus-url-burn
STAMP="$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)"
LOG=".score-loop/logs/opus-url-burn-${STAMP}.log"
nohup python3 scripts/opus-url-burn-runner.py --deadline midnight --candidate-limit 30 --parallel 3 --budget 12 --timeout-sec 2400 > "$LOG" 2>&1 &
PID=$!
echo "$PID" > ".score-loop/logs/opus-url-burn-${STAMP}.pid"
echo "PID=$PID"
echo "LOG=$PWD/$LOG"
sleep 2
sed -n '1,40p' "$LOG" || true
