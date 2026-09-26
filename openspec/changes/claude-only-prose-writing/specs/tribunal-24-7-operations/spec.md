## MODIFIED Requirements

### Requirement: 部署版額度路徑 SHALL 使用限定 Codex 供應端的 JSON

部署版額度控制器與 model 額度錯誤探測 SHALL 執行有界指令 `codexbar usage --provider codex --source cli --format json --pretty`，並 SHALL 只根據通過驗證的 Codex JSON 做決策。部署版路徑 SHALL NOT 執行 CodexBar 合併供應端指令、Claude 額度指令，或任何會初始化這兩條路徑的 helper。控制器只調節 Codex 額度；Claude 寫手的額度錯誤 SHALL 以 unknown 暫停該篇文章，不得推測 Claude 額度。

#### Scenario: 控制器讀取 Codex 額度

- **WHEN** 部署版控制器需要讀取額度
- **THEN** 它 SHALL 精確執行 `codexbar usage --provider codex --source cli --format json --pretty`
- **AND** SHALL 從該 JSON 取得 Codex 目前有效的額度視窗值
- **AND** SHALL NOT 呼叫合併供應端或 Claude 額度探測

#### Scenario: CodexBar 回報短窗未啟用

- **WHEN** 唯一的 Codex record 來自 `cli` 或 `codex-cli` source、`usage.primary` 明確為 `null`，且 weekly `secondary` 視窗完整有效
- **THEN** parser SHALL 把短窗標記為不參與控制器運算，而不是猜測短窗 reset 或進入 fallback
- **AND** 控制器 SHALL 繼續以通過驗證的 weekly 視窗做 floor 與 burn-rate 決策
- **AND** 缺少 `primary` key、非 `null` 的 malformed primary，或無效的 weekly 視窗仍 SHALL 封閉失敗

#### Scenario: Model 呼叫回報額度錯誤

- **WHEN** 部署版 Codex 評審回報額度錯誤
- **THEN** 額度錯誤處理器 SHALL 使用同一條限定 Codex 供應端的 CodexBar JSON 路徑決定等待或暫停
- **AND** 只有通過驗證的 exhausted 視窗 MAY 提供 tier 與 reset；視窗 unavailable 或讀值仍非零時 SHALL 以 unknown 暫停，不得推測耗盡的視窗
- **AND** SHALL NOT 呼叫合併或 Claude 額度路徑

#### Scenario: Claude 寫手回報額度錯誤

- **WHEN** 部署版 Claude 寫手或寫入 canary 回報額度錯誤
- **THEN** runner SHALL 丟棄候選並還原 canonical 文章後，以 unknown tier 將該篇標為額度暫停
- **AND** SHALL NOT 執行 Claude 額度指令、合併供應端探測，或改派其他寫手

#### Scenario: Codex 額度 JSON 無法取得或無效

- **WHEN** 限定 Codex 供應端的 CodexBar 指令失敗、逾時、輸出格式錯誤的 JSON，或缺少必要的 Codex 額度欄位
- **THEN** 部署版執行環境 SHALL 封閉失敗或進入既有可觀測的額度備援
- **AND** SHALL 輸出可採取行動的 log 或警報
- **AND** SHALL NOT 從 Claude 或合併供應端指令取得替代讀值

## REMOVED Requirements

### Requirement: 長時間執行的部署版環境 SHALL 啟用改寫

**Reason**: 部署版寫手從 Codex 改成 Claude（owner 2026-09-26 決定只有 Claude 寫得出 gu-log 等級的繁中）。原 requirement 的名稱與情境綁定 Codex 寫手、Codex 寫入 canary 與「部署版完全不需要 Claude」，已無法原地修正。

**Migration**: 由「部署版環境 SHALL 以 Claude 寫手啟用改寫」取代；評審路徑仍不需要 Claude 的要求保留在新 requirement 的情境中。

## ADDED Requirements

### Requirement: 部署版環境 SHALL 以 Claude 寫手啟用改寫

部署版非互動式 24/7 執行環境（systemd unit／wrapper）SHALL 設定 `GP_WRITER_MODE=claude`，並 SHALL 在派送文章前驗證 Claude 寫手能完成有界的寫入 canary。Canary SHALL 從 `.claude/agents/tribunal-writer.md` 的 `model:` 解析寫手 model，並 SHALL 重用正式寫手的受限 Claude 執行器、暫態 systemd service 與逾時行為。Claude 憑證 SHALL 由 Claude CLI 自己的登入狀態管理；部署版服務與 wrapper SHALL NOT 讀取、匯出或注入 Claude token。Library 預設 MAY 維持 `none`，非部署版互動式編排 MAY 保留 `subagent` 或舊版 `cli` 相容性；`codex` 與 `grok` 寫手模式已退役。正式 daemon SHALL NOT 以只評分、未消費 broker、舊版 `cli` 或已退役的寫手模式執行。

#### Scenario: 未過關文章由 Claude 改寫而非跳過

- **WHEN** 文章在部署版 daemon 的任一評審階段未過關
- **THEN** Claude Tribunal 寫手 SHALL 使用 `.claude/agents/tribunal-writer.md` 的 model 接受呼叫
- **AND** 改寫 SHALL 在私有候選工作區以受限 Claude 執行器進行
- **AND** 本次執行 SHALL NOT 記錄 `rewrite skipped (GP_WRITER_MODE=none)`，也不得在沒有改寫時耗盡嘗試次數變成 EXHAUSTED
- **AND** 寫手 log 或進度來源 SHALL 記錄實際 Claude provider／model

#### Scenario: 寫手寫入 canary 在派送前成功

- **WHEN** 部署版 daemon 啟動時 Claude CLI 已登入，且 tribunal-writer frontmatter 的 model 有效
- **THEN** 前置檢查 SHALL 要求正式 Claude 寫手執行器在私有專用 canary 工作區寫入固定 sentinel
- **AND** 前置檢查 SHALL 在設定的逾時內驗證完全相同的 sentinel 內容
- **AND** canary SHALL 無權寫入 canary 工作區以外的路徑，也沒有執行指令或網路的工具
- **AND** daemon SHALL 只在這項驗證完成後領取或派送文章

#### Scenario: 寫手前置檢查在派送前失敗

- **WHEN** 寫手模式不是 `claude`、Claude CLI 不可用或未登入、tribunal-writer frontmatter 無效、canary 逾時，或 sentinel 遺失或錯誤
- **THEN** 部署版 daemon SHALL 在領取或派送文章前退出
- **AND** SHALL 輸出可採取行動的寫手前置檢查錯誤
- **AND** SHALL NOT 透過 Codex、Grok 或其他寫手重試

#### Scenario: 部署版評審路徑不依賴 Claude

- **WHEN** 部署版 Codex 評審、額度控制器或額度復原執行
- **THEN** 這些路徑 SHALL NOT 檢查或呼叫 Claude 執行檔
- **AND** SHALL NOT 讀取、匯出或驗證 Claude 憑證
- **AND** Claude CLI SHALL 只在寫手、寫入 canary 與解析 Claude 寫作角色的 preflight 被呼叫

#### Scenario: 非部署版相容路徑留在正式環境之外

- **WHEN** 部署版嚴格模式未啟用
- **THEN** 互動式 `subagent`、舊版 `cli` 或 CCC 供應端備援 MAY 維持可用
- **AND** 這些相容路徑 SHALL NOT 滿足或繞過部署版 Claude 寫入 canary 合約
