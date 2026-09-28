## MODIFIED Requirements

### Requirement: Mogu 撰寫與改寫文章 SHALL 一律使用 Claude 模型

gu-log 的文章由 Mogu 撰寫；Claude 是 Mogu 背後使用的 AI 模型。凡是會產生或改寫讀者可見文章字句的自動化步驟，SHALL 一律呼叫 Claude 模型。範圍包含英文 sidecar 翻譯、MP 與 GP 的 write 與 refine（含來源距離沒過之後的改寫），以及 Tribunal 評審不過後的背景改寫與 final-build 修復；同時會審查又會改字的步驟也屬於寫作步驟。

寫作步驟的 model SHALL 只來自 owner pin 的 Claude 模型 SSOT：gp-pipeline 的 `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:` frontmatter，兩者 SHALL 保持一致。Runtime 設定檔 SHALL NOT 為寫作步驟另存 model 或 reasoning 副本。

寫作步驟 SHALL NOT 使用 Codex、Grok 或其他模型，也 SHALL NOT 在 Claude 不可用、登入失效、額度不足或 pin 不一致時靜默改用其他模型或供應端；這些情況 SHALL 在寫入文章前明確失敗並保留可行動的錯誤。只打分或審查、不寫文章字句的評審（Tribunal 評審、eval、review）不受本 requirement 約束。來源距離的配對員（aligner）只輸出句子配對、不寫文章字句，也不是寫作步驟；它的模型規則見 `source-distance-stamp`。

#### Scenario: VM runtime profile 為寫作步驟選用 Claude 模型

- **WHEN** VM runtime profile 解析 writer 步驟
- **THEN** provider SHALL 是 Claude，model SHALL 是 Claude 模型 pin
- **AND** 設定檔 SHALL NOT 為寫作步驟宣告 model 或 reasoning effort
- **AND** 若設定把寫作步驟指向其他供應端，routing SHALL 在派送前封閉失敗

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

- **WHEN** Tribunal 評審、eval 或 review 執行
- **THEN** 它們 SHALL 維持各自既有的模型路由
- **AND** 本 requirement SHALL NOT 要求這些評審改用 Claude 模型
