#!/bin/bash
# .claude/hooks/session-start.sh — auto-provision CCC sandbox at session start
#
# 為什麼存在：CCC 每次都是全新 sandbox（fresh clone，node_modules 沒裝、git
# hooks 沒掛、sp-pipeline 還沒 compile）。以前每個 CCC 開場都要記得手動補，
# 忘了就踩「hook 沒跑就 commit」這類本該擋掉的問題。這支 hook 在 session 一
# 開始就把環境補好，未來 CCC 一醒來就能直接開工。
#
# 只在 Claude Code on the web（CCC）跑——mac-CC 自己管 local env，不要插手。
set -uo pipefail

# 非 remote（= mac-CC / local）直接跳過，零干擾。
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# --fix 會補 deps（node_modules 缺才裝）+ 掛 git hooks，全程 idempotent。
# smoke test 任何 check 沒過會 exit 1，但 SessionStart 不該因此卡住 session，
# 所以吞掉非零 exit——report 已經印出來，agent 開場自己會看到要修什麼。
bash scripts/ccc-smoke-test.sh --fix || true
