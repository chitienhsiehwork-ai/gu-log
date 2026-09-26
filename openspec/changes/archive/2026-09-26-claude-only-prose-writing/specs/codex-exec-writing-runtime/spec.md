## REMOVED Requirements

### Requirement: GP pipeline SHALL 預設使用 Codex GPT-5.5 作為正式 writer runtime

**Reason**: Owner 在 2026-09-26 決定只有 Claude 模型寫得出 gu-log 等級的繁體中文，Mogu 撰寫與改寫文章時不再使用 Codex 模型；這條 requirement 也早已和優先使用 Claude 模型的寫作 chain 分岔。review、eval 與 probe 等審查步驟的模型不受影響，繼續由各自的 runtime 設定決定。

**Migration**: 文章寫作改由 `claude-prose-writing-runtime` 的「Mogu 撰寫與改寫文章 SHALL 一律使用 Claude 模型」規範；設定 `GP_WRITER_PROVIDER=codex` 的 caller 會收到明確錯誤，應移除該設定或改為 `claude`。

### Requirement: Codex writer output SHALL 在沒有 CLI noise 的情況下被 capture

**Reason**: 文章不再用 Codex 模型產生，Codex 寫作輸出的擷取契約已無對象。

**Migration**: 呼叫 Claude 模型時的輸出擷取改由 `claude-prose-writing-runtime` 的「呼叫 Claude 模型撰寫文章 SHALL 以最小權限執行並擷取乾淨輸出」規範。
