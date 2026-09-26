# Proposal

## Why

ShroomDog 在 2026-09-26 拍板：「目前前沿模型裡，只有 Claude 寫得出 gu-log 等級的繁體中文。」gu-log 的文章由 Mogu 撰寫，Claude 是 Mogu 背後使用的 AI 模型；但目前 VM runtime profile 仍讓 Grok 模型翻 GP 正文、產生 MoguNote 候選與英文 sidecar，讓 Codex 模型改 GP 字句；本機寫作 chain 在沒有 `claude` 時也會退回 Codex，Tribunal 背景改寫則由 `GP_WRITER_MODE=grok|codex` 決定使用哪個模型。這些路徑和 owner 的品質判斷直接衝突，而且散在 config、Go dispatcher、shell executor 與 spec，沒有單一規範能擋住回流。

這個 change 明確推翻 2026-07-28 `codex-only-deployed-tribunal` 的決定：當時為了讓部署版只依賴 Codex、不綁 Claude 憑證，Tribunal VM 的評審與改寫全部改走 Codex。依 owner 2026-09-26 的決定，文章改寫回到 Claude 模型。取捨是 daemon 的評審仍用 Codex、寫作改用 Claude，部署版從此同時依賴兩個供應端；Claude 登入失效或額度用完時，改寫會停下來（fail closed），不會退回 Codex 或其他模型。

## What Changes

- **BREAKING**：Mogu 撰寫與改寫文章時，一律使用 Claude 模型；Grok、Codex 不再用於產生或改寫文章內容。Model 只來自既有的 Claude 模型 pin SSOT。受影響的步驟：
  - GP 正文翻譯（translator）、GP bounded corrector、MoguNote commentary 候選。
  - 英文 sidecar 翻譯、MP write／refine（含 `write`／`refine`／`translate` 子命令）。
  - Tribunal 評審不過的背景改寫與 final-build 修復（`GP_WRITER_MODE=claude`，含 systemd unit、wrapper 與 gp-pipeline wrapper 預設）。
- **BREAKING**：退役用 Codex／Grok 模型寫文章的路徑：`GP_WRITER_PROVIDER=codex`、`GP_WRITER_MODE=codex|grok` 會在呼叫任何模型前明確失敗；本機寫作 chain 不再在缺少 `claude` 時退回 Codex；`.codex/agents/tribunal-writer.toml` 不再綁定 Codex model。
- **BREAKING**：已經沒有可達入口的 `GP_WRITER_MODE=subagent`（writer broker）與舊版 `cli` 寫手模式一併退役並刪除 code；兩者跟 `codex`、`grok` 一樣回「已退役」錯誤。非部署版的相容路徑只剩 CCC 評審的供應端備援。
- VM runtime profile 不再另列 `requiredProviders`：需要 preflight 的供應端由各步驟設定的 provider 推導。`scripts/tribunal-model-router.sh` 是判定「哪些是寫作步驟」的唯一位置，雙向檢查寫作步驟一定用 Claude、Claude 也只用在寫作步驟；Claude 的 preflight 驗證 CLI 登入與模型 pin。沒有任何步驟再使用 Grok，因此刪除 Grok 供應端與只為 Grok 寫作步驟存在的額度政策；`GP_WRITER_MODE=grok` 保留已退役的錯誤。
- 呼叫 Claude 模型撰寫文章時改為最小權限：只回 JSON 的步驟不給任何工具並用 structured output；需要寫檔的步驟只有檔案工具，編修只限該步驟的私有工作目錄；不載入主機的 settings 與 MCP server；部署版 Tribunal 改寫沿用暫態 systemd service 與寫入 canary。VM 上的 Claude CLI 只用 `claude auth login` 的登入狀態認證，API key、改變計費端點的變數與 OAuth token 環境變數一律清掉。
- Claude CLI 的錯誤分成額度與登入兩類，以目前 CLI 實際輸出的訊息當回歸樣本；`is_error` 結果一律視為失敗並帶出 `errors[]`。額度錯誤只看 Claude 回報的重置時間（無法解析時採保守預設），不讀 Codex 額度資料；Tribunal 改寫撞到額度時暫停派送到重置時間，登入失效時停止領新文章並提示執行 `claude auth login`，兩者都還原文章、不重評、不計失敗或改寫次數。
- Tribunal 允許改寫但寫手模式不是 `claude` 時，在第一位評審前就失敗；部署版寫手 preflight 失敗時，服務至少間隔 10 分鐘才重試。
- GP 獨立性規則從「翻譯、修正、語感評審三個不同 model」改成「寫作步驟與 gate 評審不共用 model」，因為所有寫作步驟依規定共用同一個 Claude 模型 pin。
- 只打分或審查、不寫文章字句的評審（Tribunal 四位評審、eval、review、GP source reviewer、natural-zh vibe gate）維持原本的模型。

## Capabilities

### New Capabilities

- `claude-prose-writing-runtime`：規範「Mogu 撰寫與改寫文章時一律使用 Claude 模型；Grok、Codex 不再用於產生或改寫文章內容」，涵蓋受影響的步驟、模型來源、退役供應端的封閉失敗，以及呼叫 Claude 模型時的最小權限、乾淨輸出與錯誤分類。

### Modified Capabilities

- `codex-exec-writing-runtime`：整個 capability 退役（文章不再用 Codex 模型撰寫），由 `claude-prose-writing-runtime` 取代。
- `gp-source-preservation`：`GP text roles MUST use independent models and contracts` 改成 GP 寫作步驟使用 Claude 模型 pin、gate 評審不得與寫作步驟共用 model。
- `tribunal-24-7-operations`：部署版改寫與寫入 canary 改用 Claude 模型；Tribunal 改寫遇到 Claude 額度錯誤時以 unknown 暫停並讓 daemon 暫停派送到 Claude 回報的重置時間，登入失效時停止領新文章；寫手前置檢查失敗後至少退避 10 分鐘；控制器仍只讀 Codex 額度。
- `codex-tribunal-runtime`：評審仍全用 Codex 模型，Tribunal 寫手改用受限的 Claude 執行器；VM runtime profile 的評審 model 來源寫回 spec。

## Impact

- 設定：`config/llm-pipeline.json` 的 vm-codex profile（寫作步驟改用 Claude，刪除 `requiredProviders` 與 Grok 額度區塊）。
- Go：`tools/gp-pipeline/internal/llm`（Claude provider、Claude 錯誤分類與額度等待、runtime routing、GP profile 驗證、寫作 chain；刪除 Grok provider）、GP run 的 sidecar dispatcher、corrector structured output、doctor。
- Shell：`scripts/tribunal-model-router.sh`、`scripts/tribunal-helpers.sh`、`scripts/tribunal.sh`、quota loop、batch runner、systemd unit（重啟退避）、wrapper、gp-pipeline wrapper；刪除 `scripts/tribunal-grok-provider.sh` 與 `scripts/writer-broker-wait.sh`。
- 測試：Go routing／profile／provider 測試與 Tribunal shell 合約測試。
- 文件：runbook、gp-pipeline README／SKILL、playbooks、ShroomDog 回饋紀錄。
- VM：需要安裝 Claude Code CLI 並以跑 daemon 的使用者執行 `claude auth login`、重新安裝 systemd unit 並 `daemon-reload`；Claude 額度成為背景改寫的新耗用來源。
