# claude-prose-writing-runtime Specification

## Purpose
規範 Mogu 撰寫與改寫 gu-log 文章時一律使用 Claude 模型，Grok、Codex 不再用於產生或改寫文章內容，並定義呼叫 Claude 模型時的模型來源、最小權限與輸出擷取，讓其他模型不能回流到文章寫作。

## Requirements

### Requirement: Mogu 撰寫與改寫文章 SHALL 一律使用 Claude 模型

gu-log 的文章由 Mogu 撰寫；Claude 是 Mogu 背後使用的 AI 模型。凡是會產生或改寫讀者可見文章字句的自動化步驟，SHALL 一律呼叫 Claude 模型。範圍包含 GP 正文翻譯、GP bounded corrector、MoguNote commentary 候選、英文 sidecar 翻譯、MP write 與 refine，以及 Tribunal 評審不過後的背景改寫與 final-build 修復；同時會審查又會改字的步驟也屬於寫作步驟。

寫作步驟的 model SHALL 只來自 owner pin 的 Claude 模型 SSOT：gp-pipeline 的 `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:` frontmatter，兩者 SHALL 保持一致。Runtime 設定檔 SHALL NOT 為寫作步驟另存 model 或 reasoning 副本。

寫作步驟 SHALL NOT 使用 Codex、Grok 或其他模型，也 SHALL NOT 在 Claude 不可用、登入失效、額度不足或 pin 不一致時靜默改用其他模型或供應端；這些情況 SHALL 在寫入文章前明確失敗並保留可行動的錯誤。只打分或審查、不寫文章字句的評審（Tribunal 評審、eval、review、GP source reviewer、natural-zh vibe gate）不受本 requirement 約束。

#### Scenario: VM runtime profile 為寫作步驟選用 Claude 模型

- **WHEN** VM runtime profile 解析 writer、translator、corrector 或 commentary 步驟
- **THEN** provider SHALL 是 Claude，model SHALL 是 Claude 模型 pin
- **AND** 設定檔 SHALL NOT 為這些步驟宣告 model 或 reasoning effort
- **AND** 若設定把任一寫作步驟指向其他供應端，routing SHALL 在派送前封閉失敗

#### Scenario: 本機或 CCC 的寫作 chain 不退回 Codex

- **WHEN** 沒有 runtime profile 的 caller 執行 write、refine 或英文 sidecar 翻譯
- **THEN** pipeline SHALL 使用 pin 住的 Claude 模型
- **AND** `GP_WRITER_PROVIDER=codex` SHALL 在呼叫任何模型前被拒絕，並說明文章只使用 Claude 模型撰寫
- **AND** `claude` 不在 PATH 時 SHALL 以可行動的錯誤失敗，SHALL NOT 改用 Codex

#### Scenario: Tribunal 背景改寫只接受 Claude 模型

- **WHEN** Tribunal 需要評審不過後的改寫或 final-build 修復
- **THEN** 隔離候選交易 SHALL 只接受 `GP_WRITER_MODE=claude`
- **AND** `GP_WRITER_MODE=codex` 或 `grok` SHALL 在呼叫任何模型前以已退役的錯誤失敗
- **AND** 寫手來源紀錄 SHALL 記錄 Claude provider 與實際 pin model，其他供應端的來源紀錄 SHALL 被視為不完整
- **AND** Tribunal 允許改寫但寫手模式既不是 `claude`、也不是只評分的 `none` 時，SHALL 在第一位評審執行前就失敗，SHALL NOT 先花掉評審額度

#### Scenario: Claude 模型 pin 在兩個 SSOT 之間漂移

- **WHEN** `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:` 不一致
- **THEN** 回歸測試 SHALL 失敗
- **AND** VM runtime profile 的 Claude 路由 SHALL 在派送前封閉失敗，不得任選其中一個 model

#### Scenario: VM runtime profile 的供應端 preflight

- **WHEN** VM runtime profile 解析任一步驟
- **THEN** 需要 preflight 的供應端 SHALL 由各步驟設定的 provider 推導，設定檔 SHALL NOT 另外維護一份供應端清單
- **AND** 解析使用 Claude 模型的步驟時 SHALL 先驗證 Claude CLI 已登入且模型 pin 可解析
- **AND** 只解析使用 Codex 的評審時 SHALL NOT 呼叫 Claude CLI
- **AND** SHALL NOT 要求安裝、登入或查詢沒有任何步驟使用的供應端

#### Scenario: 評審與審查維持原本的模型

- **WHEN** Tribunal 評審、eval、review、GP source reviewer 或 natural-zh vibe gate 執行
- **THEN** 它們 SHALL 維持各自既有的模型路由
- **AND** 本 requirement SHALL NOT 要求這些評審改用 Claude 模型

### Requirement: 呼叫 Claude 模型撰寫文章 SHALL 以最小權限執行並擷取乾淨輸出

Runtime profile 與 Tribunal 部署路徑呼叫 Claude 模型撰寫文章時，SHALL 使用非互動、最小權限的呼叫方式，且 SHALL NOT 使用 bypass permissions 或同等的「全部放行」模式：

- 只回傳 JSON artifact 的寫作步驟（GP translator、corrector、commentary）SHALL 不提供任何工具，並 SHALL 以 structured output 取得符合該步驟 schema 的 JSON。
- 需要寫檔的寫作步驟（MP write／refine、英文 sidecar、Tribunal 改寫與寫入 canary）SHALL 只提供檔案讀寫工具；讀取 MAY 涵蓋 repo 參考文件，編修 SHALL 只在該步驟的私有工作目錄內被自動核准，SHALL NOT 提供執行指令或網路工具。
- 部署版 Tribunal 改寫與寫入 canary SHALL 共用同一個 Claude 執行器，並在暫態 systemd service 內執行。
- Pipeline SHALL 從 Claude CLI 的 JSON 結果擷取最終回覆或 structured output，SHALL NOT 把 CLI 雜訊、錯誤訊息或空的 structured output 當成文章內容。
- Claude 寫作呼叫 SHALL NOT 載入主機的使用者設定、權限規則或 MCP server，也 SHALL NOT 帶入 API key 或會改變計費端點的環境變數（例如 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`CLAUDE_CODE_USE_BEDROCK`），讓權限與計費都不受主機設定影響。

#### Scenario: JSON 寫作步驟沒有工具可用

- **WHEN** GP translator、corrector 或 commentary 透過 runtime profile 呼叫 Claude 模型
- **THEN** 該呼叫 SHALL 不提供任何工具，並帶上該步驟的 JSON schema
- **AND** Claude 結果缺少 structured output 時 SHALL 失敗，SHALL NOT 改讀一般文字回覆

#### Scenario: 注入的來源試圖寫出工作目錄

- **WHEN** 寫檔步驟處理的來源或文章要求模型執行指令或寫入工作目錄外的路徑
- **THEN** Claude session SHALL 沒有可執行指令的工具
- **AND** Claude session SHALL NOT 載入主機的使用者設定、權限規則或 MCP server
- **AND** 工作目錄外的寫入 SHALL 被拒絕，正式 repo 與 canonical 文章 SHALL 維持不變

#### Scenario: Claude CLI 回報錯誤

- **WHEN** Claude CLI 以非零結束碼或 `is_error` 結果回報模型、登入或額度錯誤（包含結束碼為 0、`result` 為空、錯誤細節只在 `errors[]` 的情況）
- **THEN** 呼叫 SHALL 以包含 CLI 錯誤訊息的錯誤失敗，讓額度分類可以辨識
- **AND** 該錯誤訊息 SHALL NOT 被寫成文章或 artifact 內容
- **AND** 錯誤分類 SHALL 能辨識目前 Claude CLI 實際輸出的額度、登入、帳號設定與暫時性錯誤訊息（包含 CLI 自己歸類為用量限制的各種訊息），把可以等待恢復的錯誤（額度、服務過載、逾時）和需要人處理的錯誤（登入、帳號設定、model pin 無法使用）分開；回歸測試 SHALL 以實際訊息為樣本
- **AND** 額度錯誤的等待時間 SHALL 只取自 Claude 回報的重置時間，無法解析時採保守預設，SHALL NOT 讀取 Codex 的額度資料
