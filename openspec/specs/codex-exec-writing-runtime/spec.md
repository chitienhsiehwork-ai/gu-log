# codex-exec-writing-runtime Specification

## Purpose

定義 GP pipeline 的正式 Codex writer runtime 與乾淨 output capture 契約，避免 CLI noise 混入文章產物或讓 pipeline 誤判寫作結果。

## Requirements

### Requirement: GP pipeline SHALL 預設使用 Codex GPT-5.5 作為正式 writer runtime

GP pipeline 在正式 writing、refine、review、probe LLM 呼叫時，SHALL 透過 Codex 與 GPT-5.5 執行，除非操作明確要求 fake/test provider。Legacy CLI 名稱 MAY 為了相容性保留，但 SHALL NOT 讓正式預設路徑離開 Codex。

#### Scenario: 預設 writer chain

- **WHEN** operator 在沒有 fake/test flags 的情況下執行 GP pipeline
- **THEN** pipeline SHALL 呼叫 `codex exec` 並使用 model `gpt-5.5`
- **AND** pipeline SHALL NOT 在正式 writing steps 呼叫 `claude -p`

#### Scenario: Legacy flag compatibility

- **WHEN** 既有 command 傳入 legacy model-selection flag
- **THEN** CLI MAY 為了相容性接受該 flag
- **AND** 除非該 flag 明確選擇 fake/test provider，正式預設 provider SHALL 仍然是 Codex/GPT-5.5

### Requirement: Codex writer output SHALL 在沒有 CLI noise 的情況下被 capture

GP pipeline SHALL 透過 deterministic mechanism capture 最終 Codex assistant output，例如 `codex exec -o <file>` 或等效的 output file protocol。除非實作有 tested extractor 能移除 CLI logs，stdout SHALL NOT 被直接當成 article body。

#### Scenario: Codex 輸出 banner 或 warning text

- **WHEN** Codex 把非文章文字寫到 stdout 或 stderr
- **THEN** pipeline SHALL 從產生的 MDX 與 JSON artifacts 排除那些文字
- **AND** 產生的 article content SHALL 只包含預期的 final answer

#### Scenario: Output capture 不可用

- **WHEN** 已安裝的 Codex CLI 不支援偏好的 output flag
- **THEN** pipeline SHALL 以可行動的錯誤失敗，或使用 tested fallback extractor
- **AND** pipeline SHALL NOT 默默把混有 CLI logs 的內容寫進 article files
