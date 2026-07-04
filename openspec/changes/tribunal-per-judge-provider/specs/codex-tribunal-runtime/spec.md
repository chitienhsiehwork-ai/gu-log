## MODIFIED Requirements

### Requirement: Tribunal SHALL 依 judge 決定 runtime provider（VibeScorer=Claude Opus 4.5、其餘=Codex GPT-5.5）

Canonical tribunal runner SHALL 以 per-judge 方式解析 runtime provider：

- **Librarian、FactChecker、FreshEyes** SHALL 透過 `codex exec` 使用 model `gpt-5.5` 執行；其 Codex project agent 設定 SHALL 放在 `.codex/agents/*.toml`。
- **VibeScorer** SHALL 在 codex 可用的環境（mac / VPS）透過 `claude -p` 使用 `.claude/agents/vibe-opus-scorer.md` 宣告的 model（`claude-opus-4-5`）執行。該檔的 `model:` 欄位 SHALL 作為 VibeScorer runtime 的權威來源。
- 其餘三個 judge 的 `.claude/agents/*.md` metadata MAY 作為 calibration context 保留，且 SHALL NOT 被當成 mac/VPS 上的 Codex runtime model selection（僅在 codex 不可用的 CCC fallback 生效）。

Provider 解析 SHALL 集中在一個 agent-aware helper；沒有帶 judge 身份的既有呼叫路徑 SHALL 維持原本的全域 `codex if present else claude` 行為不變。全域 `TRIBUNAL_FORCE_PROVIDER` override SHALL 對所有 judge（含 VibeScorer）生效，優先序高於 per-judge 偏好。

#### Scenario: Full tribunal run on mac/VPS

- **WHEN** operator 在 codex 可用的環境對單篇 post 執行 canonical tribunal runner
- **THEN** Librarian / FactChecker / FreshEyes stage SHALL 透過 Codex/GPT-5.5 執行
- **AND** VibeScorer stage SHALL 透過 Claude Opus 4.5 執行
- **AND** frontmatter score metadata SHALL 各自誠實記錄 runtime model（三個客觀 judge 記 `codex-gpt-5.5-medium`、VibeScorer 記 `claude-opus-4-5`）

#### Scenario: CCC sandbox fallback（codex 不在 PATH）

- **WHEN** operator 在沒有 codex binary 的環境執行 canonical tribunal runner
- **THEN** 四個 judge stage SHALL 全部 fallback 到 Claude，讀各自 `.claude/agents/*.md` 的 `model:`
- **AND** runner SHALL NOT 因某個 judge 偏好 codex 而硬失敗

#### Scenario: 全域 force-provider override

- **WHEN** operator 設定 `TRIBUNAL_FORCE_PROVIDER=codex` 執行 tribunal
- **THEN** 包含 VibeScorer 在內的所有 judge stage SHALL 透過 Codex/GPT-5.5 執行
- **AND** per-judge 的 VibeScorer=Claude 偏好 SHALL 被覆寫

#### Scenario: Single-stage vibe run

- **WHEN** operator 在 codex 可用環境執行 `scripts/tribunal.sh --only-stage vibe <post>`
- **THEN** 只有 VibeScorer stage SHALL 執行
- **AND** 該 stage SHALL 透過 Claude Opus 4.5 執行
