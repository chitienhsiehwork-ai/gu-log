## REMOVED Requirements

### Requirement: GP pipeline SHALL 預設使用 Codex GPT-5.5 作為正式 writer runtime

**Reason**: Owner 在 2026-09-26 決定只有 Claude 寫得出 gu-log 等級的繁體中文，文章寫作角色不再由 Codex 擔任；這條 requirement 也早已和 Claude 優先的寫作 chain 分岔。review、eval 與 probe 等審查角色的路由不受影響，繼續由各自的 runtime 設定決定。

**Migration**: 寫作角色改由 `claude-prose-writing-runtime` 的「文章內容的撰寫與改寫角色 SHALL 一律使用 Claude」規範；設定 `GP_WRITER_PROVIDER=codex` 的 caller 會收到明確錯誤，應移除該設定或改為 `claude`。

### Requirement: Codex writer output SHALL 在沒有 CLI noise 的情況下被 capture

**Reason**: Codex 不再產生文章內容，Codex 寫手的輸出擷取契約已無對象。

**Migration**: Claude 寫作呼叫的輸出擷取改由 `claude-prose-writing-runtime` 的「Claude 寫作呼叫 SHALL 以最小權限執行並擷取乾淨輸出」規範。
