# GitHub token lane smoke test — 2026-05-07

這份文件是低風險的 GitHub token lane smoke test，只用來確認 clawd-vm 能正常：

- push feature branch
- 開 draft PR
- 觸發 CI
- 保持 main、`.github/**`、repo secrets / variables / rulesets / branch protection 不被修改

## 範圍

- 只新增這份文件。
- 不改應用程式碼。
- 不改 GitHub workflow 或 repo 設定。

## 驗收

- branch push 成功。
- draft PR 建立成功。
- CI 有正常排隊或執行。
- auto-merge 不應該在 draft PR 上啟用。
