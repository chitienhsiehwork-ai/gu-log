#!/bin/bash
# PreToolUse(Bash) guard — gu-log 禁止 git hook-bypass flags（--no-verify / --no-gpg-sign）。
# 為什麼：hook 失敗 = 修 hook 或修 code，不准跳（見 AGENTS.md〈共通硬邊界〉）。
# CI（branch protection + ci-passed）是承重牆；這個 hook 補「直推 main」CI 蓋不到的洞 + fail-fast。
# 設計：先剝掉引號內容（含跨行 heredoc 的外層雙引號），再比對——所以 commit message 裡
#       「提到」--no-verify 不會誤殺，只擋真的當 flag 傳給 git 的情況。

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# perl -0777 = slurp（跨行）；\x27 = 單引號，避免在 bash 單引號參數裡塞字面單引號
STRIPPED=$(printf '%s' "$COMMAND" | perl -0777 -pe 's/"(?:[^"\\]|\\.)*"//g; s/\x27[^\x27]*\x27//g' 2>/dev/null || printf '%s' "$COMMAND")

if printf '%s' "$STRIPPED" | grep -qE '(^|[[:space:]])(--no-verify|--no-gpg-sign)([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "gu-log 禁止 --no-verify / --no-gpg-sign（繞過 pre-commit/pre-push hook）。hook 失敗就修 hook 或修 code，不准跳。見 AGENTS.md〈共通硬邊界〉。"
    }
  }'
fi

# 非匹配：exit 0 無輸出 → 正常 permission flow
exit 0
