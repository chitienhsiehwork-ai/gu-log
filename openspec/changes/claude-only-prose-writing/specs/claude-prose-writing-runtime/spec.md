## Purpose

規範 gu-log 所有會產生或改寫讀者可見文章字句的自動化角色一律使用 Claude，並定義 Claude 寫作呼叫的 model 來源、最小權限與輸出擷取，讓 Codex、Grok 或其他供應端不能回流到文章寫作。

## ADDED Requirements

### Requirement: 文章內容的撰寫與改寫角色 SHALL 一律使用 Claude

凡是會產生或改寫讀者可見文章字句的自動化角色，SHALL 一律透過 Claude 執行。範圍包含 GP 正文翻譯、GP bounded corrector、MoguNote commentary 候選、英文 sidecar 翻譯、MP write 與 refine，以及 Tribunal 評審不過後的背景改寫與 final-build 修復；同時會審查又會改字的角色也屬於寫作角色。

寫作角色的 model SHALL 只來自 owner pin 的 Claude 寫手 SSOT：gp-pipeline 的 `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:` frontmatter，兩者 SHALL 保持一致。Runtime 設定檔 SHALL NOT 為寫作角色另存 model 或 reasoning 副本。

寫作角色 SHALL NOT 使用 Codex、Grok 或其他供應端，也 SHALL NOT 在 Claude 不可用、登入失效、額度不足或 pin 不一致時靜默改派給其他供應端、model 或角色；這些情況 SHALL 在寫入文章前明確失敗並保留可行動的錯誤。只打分或審查、不寫文章字句的角色（Tribunal 評審、eval、review、GP source reviewer、natural-zh vibe gate）不受本 requirement 約束。

#### Scenario: VM runtime profile 把寫作角色路由到 Claude

- **WHEN** VM runtime profile 解析 writer、translator、corrector 或 commentary 角色
- **THEN** provider SHALL 是 Claude，model SHALL 是 Claude 寫手 pin
- **AND** 設定檔 SHALL NOT 為這些角色宣告 model 或 reasoning effort
- **AND** 若設定把任一寫作角色路由到其他供應端，routing SHALL 在派送前封閉失敗

#### Scenario: 本機或 CCC 的寫作 chain 不退回 Codex

- **WHEN** 沒有 runtime profile 的 caller 執行 write、refine 或英文 sidecar 翻譯
- **THEN** pipeline SHALL 使用 pin 住的 Claude 寫手
- **AND** `GP_WRITER_PROVIDER=codex` SHALL 在呼叫任何 model 前被拒絕並說明只有 Claude 可以寫作
- **AND** `claude` 不在 PATH 時 SHALL 以可行動的錯誤失敗，SHALL NOT 改用 Codex

#### Scenario: Tribunal 背景改寫只接受 Claude 寫手

- **WHEN** Tribunal 需要評審不過後的改寫或 final-build 修復
- **THEN** 隔離候選交易 SHALL 只接受 `GP_WRITER_MODE=claude`
- **AND** `GP_WRITER_MODE=codex` 或 `grok` SHALL 在呼叫任何 model 前以已退役的錯誤失敗
- **AND** 寫手來源紀錄 SHALL 記錄 Claude provider 與實際 pin model，其他供應端的來源紀錄 SHALL 被視為不完整

#### Scenario: Claude 寫手 pin 在兩個 SSOT 之間漂移

- **WHEN** `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:` 不一致
- **THEN** 回歸測試 SHALL 失敗
- **AND** VM runtime profile 的 Claude 路由 SHALL 在派送前封閉失敗，不得任選其中一個 model

#### Scenario: VM runtime profile 的供應端 preflight

- **WHEN** VM runtime profile 解析任一角色
- **THEN** `requiredProviders` SHALL 與各角色實際使用的供應端完全一致，不一致時 SHALL 封閉失敗
- **AND** 解析 Claude 角色時 SHALL 先驗證 Claude CLI 已登入且寫手 pin 可解析
- **AND** 只解析 Codex 角色時 SHALL NOT 呼叫 Claude CLI
- **AND** 沒有角色使用 Grok 時 SHALL NOT 要求安裝、登入或查詢 Grok

#### Scenario: 評審與審查角色維持原供應端

- **WHEN** Tribunal 評審、eval、review、GP source reviewer 或 natural-zh vibe gate 執行
- **THEN** 它們 SHALL 維持各自既有的供應端路由
- **AND** 本 requirement SHALL NOT 要求這些角色改用 Claude

### Requirement: Claude 寫作呼叫 SHALL 以最小權限執行並擷取乾淨輸出

Runtime profile 與 Tribunal 部署路徑呼叫 Claude 寫作時，SHALL 使用非互動、最小權限的呼叫方式，且 SHALL NOT 使用 bypass permissions 或同等的「全部放行」模式：

- 只回傳 JSON artifact 的寫作角色（GP translator、corrector、commentary）SHALL 不提供任何工具，並 SHALL 以 structured output 取得符合該角色 schema 的 JSON。
- 需要寫檔的寫作角色（MP write／refine、英文 sidecar、Tribunal 寫手與寫入 canary）SHALL 只提供檔案讀寫工具；讀取 MAY 涵蓋 repo 參考文件，編修 SHALL 只在該步驟的私有工作目錄內被自動核准，SHALL NOT 提供執行指令或網路工具。
- 部署版 Tribunal 寫手與寫入 canary SHALL 共用同一個 Claude 執行器，並在暫態 systemd service 內執行。
- Pipeline SHALL 從 Claude CLI 的 JSON 結果擷取最終回覆或 structured output，SHALL NOT 把 CLI 雜訊、錯誤訊息或空的 structured output 當成文章內容。

#### Scenario: JSON 寫作角色沒有工具可用

- **WHEN** GP translator、corrector 或 commentary 透過 runtime profile 呼叫 Claude
- **THEN** 該呼叫 SHALL 不提供任何工具，並帶上該角色的 JSON schema
- **AND** Claude 結果缺少 structured output 時 SHALL 失敗，SHALL NOT 改讀一般文字回覆

#### Scenario: 注入的來源試圖寫出工作目錄

- **WHEN** 寫檔角色處理的來源或文章要求 Claude 執行指令或寫入工作目錄外的路徑
- **THEN** Claude session SHALL 沒有可執行指令的工具
- **AND** 工作目錄外的寫入 SHALL 被拒絕，正式 repo 與 canonical 文章 SHALL 維持不變

#### Scenario: Claude CLI 回報錯誤

- **WHEN** Claude CLI 以非零結束碼或 `is_error` 結果回報 model、登入或額度錯誤
- **THEN** 呼叫 SHALL 以包含 CLI 錯誤訊息的錯誤失敗，讓額度分類可以辨識
- **AND** 該錯誤訊息 SHALL NOT 被寫成文章或 artifact 內容
