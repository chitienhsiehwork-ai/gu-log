# gu-log Agent Skills

這個資料夾放 gu-log 專用的 repo-local skills，給在這個 repo 工作的 agents 使用。
這些檔案描述可重複執行的工作流程，目標是讓不同 agent 進來時不用重新摸索同一套操作。
如果某個流程只跟本機暫存或個人偏好有關，不應該放在這裡；如果它會影響文章來源擷取、審稿、UI 驗證或長期維護，就適合收進 repo。

## 來源擷取

- `chatgpt-share-fetch` — 在寫作或轉換前，先把 `chatgpt.com/share/...` 對話內容抓到 `sources/chatgpt/...`。
- `sp-source-fetch` — 在跑 SP/CP pipeline 前，先抓完整 X/Twitter post 或 X Article 內文。

## 內容與審查工作流

- `tribunal-monitor` — 檢查 `clawd-vm` 上的 tribunal daemon，包含 service health、quota、git sync、最近 judge results。
- `uiux-auditor` — 視覺變更 ship 前，檢查 gu-log dark / light theme 的 UI 狀態。

## OpenSpec / source-command 輔助工具

- `openspec-*` — propose、explore、apply、archive OpenSpec changes。
- `source-command-opsx-*` — migrated source-command workflows，處理 opsx proposal、exploration、application、archive steps。
