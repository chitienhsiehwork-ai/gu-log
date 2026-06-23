#!/bin/bash
# PreToolUse(AskUserQuestion) guard — CCC 環境停用 AskUserQuestion。
# 為什麼：AskUserQuestion 的 picker UX 在 CCC（web / cloud sandbox）不佳，user 明確要求停用。
# 只在 CCC 擋；mac-CC（本機互動式）UX 正常、不受影響——所以用 detect-env 判斷而非靜態 deny。
# 替代行為：CCC 要讓 user 選時，改用一般 chat 散文把選項列清楚讓 user 直接回字。

cat >/dev/null  # 吃掉 stdin（hook 協定要求），本 guard 只看 env 不看 tool_input

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true
mode="$(./scripts/detect-env.sh 2>/dev/null || echo unknown)"

if [ "$mode" = "CCC" ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "CCC 環境停用 AskUserQuestion（web/cloud 的結構化 picker UX 不佳，user 指定）。改用一般 chat 散文把選項列清楚、讓 user 直接回字。"
    }
  }'
fi

# 非 CCC：exit 0 無輸出 → 正常 permission flow（mac-CC 照常可用）
exit 0
