#!/bin/bash
# .claude/hooks/session-start.sh — auto-provision CCC sandbox at session start
#
# 為什麼存在：CCC 每次都是全新 sandbox（fresh clone，node_modules 沒裝、git
# hooks 沒掛、gp-pipeline 還沒 compile）。以前每個 CCC 開場都要記得手動補，
# 忘了就踩「hook 沒跑就 commit」這類本該擋掉的問題。這支 hook 在 session 一
# 開始就把環境補好，未來 CCC 一醒來就能直接開工。
#
# 所有 Claude Code session 都先注入 compact identity context；只有 CCC 才做
# provisioning。SessionStart stdout 會進 Claude context，所以失敗時必須給可執行的
# fallback，不能只把錯誤丟到 debug log。
set -uo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-.}"
if ! cd "$project_dir"; then
  printf '\nWARNING: gu-log SessionStart 無法進入 CLAUDE_PROJECT_DIR=%s。\n' "$project_dir"
  printf 'Fallback: 先讀 AGENTS.md，再跑 ./scripts/detect-env.sh --runtime claude-code --context。\n'
  exit 0
fi

context_status=0
bash scripts/detect-env.sh --runtime claude-code --context || context_status=$?
if [ "$context_status" -ne 0 ]; then
  printf '\nWARNING: gu-log SessionStart context unavailable (exit %s)。\n' "$context_status"
  printf 'Fallback: 先讀 AGENTS.md，再跑 ./scripts/detect-env.sh --runtime claude-code --context。\n'
fi

# 非 remote（= mac-CC / local）只需要 context，不插手本機環境。
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# --fix 會補 deps（node_modules 缺才裝）+ 掛 git hooks + 背景非同步下載
# Playwright chromium（CCC sandbox 不預裝，~100MB，不擋開場），全程 idempotent。
# smoke test 任何 check 沒過會 exit 1，但 SessionStart 不該因此卡住 session，
# 所以吞掉非零 exit——report 已經印出來，agent 開場自己會看到要修什麼。
bash scripts/ccc-smoke-test.sh --fix || true
