# gu-log

> AI / Tech 繁中翻譯與原創 blog；production：<https://gu-log.vercel.app/>。

這是所有 agent 共讀的 Tier-0：只放每次都會影響行為的邊界與路由。具體做法、版本、門檻、工具與事故紀錄放在程式碼、`OpenSpec` 或下列操作手冊；不要在這裡複製衍生事實。

## 啟動與使用者意圖

- 先明確帶執行環境跑 `./scripts/detect-env.sh --runtime <codex|claude-code> --identity`，再讀 [`playbooks/local-agent-playbook.md`](playbooks/local-agent-playbook.md) 或 [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md)。不要從環境變數猜身份。
- 分支名稱只是不具語意的識別碼；任務意圖以使用者對話為準，不得從分支名稱推測。
- 使用者可能使用語音輸入。整理明顯轉錄錯字與口頭贅詞，可延續上下文明確暗示的想法，但不得補造需求；有重要歧義時，先用「我理解成……」向使用者確認。
- `issue this: <想法>` 代表只處理 issue：先查最新程式碼與開啟、已關閉的 issue 和 PR，再把整理後的標題、範圍、驗收條件與 `Autonomy: safe-autonomous | needs-human` 給使用者確認。完全重複就補充主要 issue；相關但不同才另開並互相連結。建立或更新 issue 後停止，不得接著實作。
- `safe-autonomous` 只用於可回退、可測試，且不含產品方向、編輯品味、權限或對外承諾決策的工作；其餘標 `needs-human`。

## 語言

- 跟使用者對話一律用自然的台灣繁中；識別字、路徑、指令、設定鍵、model ID、`UI` 原文標籤與必要專有名詞保留原文。
- 儲存庫內 `.md` 散文預設繁中；完整語言與術語規則見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 共通硬邊界

- 不得用 `--no-verify`、`--no-gpg-sign` 或其他方式繞過 repo gates；hook 壞了就修 hook。只有 user 當次明確授權才可例外。
- 預設用功能分支 + PR；commit、範圍、審查、CI、合併與失敗處理全部以當前執行環境的操作手冊為準。
- 開 PR 後由 agent 自己追 CI。內容發布任務若使用者沒有限縮範圍，完成定義是合併、生產環境部署、冒煙測試與可點的生產環境連結。
- 使用者明確指定 `issue-only`、`read-only`、`no push`、`no merge` 或其他窄範圍時，以該範圍為準，不得被一般自治或發布流程蓋過。

## 任務路由

- 寫作、翻譯、`ticketId`、`frontmatter`、來源評估、事實查核：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 寫作風格、人設、術語、正文與註解邊界：[`GU-LOG_WRITER_PROMPT.md`](GU-LOG_WRITER_PROMPT.md)
- 使用者只貼 URL、GP / MP pipeline：[`tools/gp-pipeline/SKILL.md`](tools/gp-pipeline/SKILL.md)
- 品質門檻與正式規格：[`CONTRIBUTING.md`](CONTRIBUTING.md) + [`openspec/specs/`](openspec/specs/)
- `Tribunal` 執行與評分：[`docs/tribunal-runbook.md`](docs/tribunal-runbook.md) + [`scripts/vibe-scoring-standard.md`](scripts/vibe-scoring-standard.md)
- 開發、建置、架構：[`docs/dev-reference.md`](docs/dev-reference.md)
- `OpenSpec` 變更：[`.agents/openspec-sdlc.md`](.agents/openspec-sdlc.md)
- SSOT、摩擦、agent 自治邊界：[`docs/agent-discipline.md`](docs/agent-discipline.md)
- 新機制或非小型 refactor 的價值審查：[`docs/value-review-runbook.md`](docs/value-review-runbook.md)
- 編輯回饋語料庫：[`docs/shroomdog-editorial-feedback.md`](docs/shroomdog-editorial-feedback.md)
- Obsidian 草稿匯入：[`OBSIDIAN_SETUP.md`](OBSIDIAN_SETUP.md)

## 維護這份 Tier-0

- 新增或修改敘述前，先用 `git log` / `git blame` 查它何時、為何出現，再比對最新程式碼、設定、`OpenSpec` 與權威文件。
- 程式碼、設定、`OpenSpec` 是權威端；本檔與操作手冊只提供路由與政策。會變的數字、model ID、工具名稱、環境快照與操作步驟只放權威端，本檔只留指標。
- 修改 agent 規則時做安全審查與 `Keep / Simplify / Drop` 精簡審查；能用既有指標表達，就不要新增散文。
