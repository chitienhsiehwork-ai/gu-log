# codex-tribunal-runtime Specification

## Purpose
TBD - created by archiving change migrate-tribunal-to-codex. Update Purpose after archive.
## Requirements
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

### Requirement: `scripts/tribunal.sh` SHALL 是 canonical tribunal entrypoint

Canonical single-post tribunal entrypoint SHALL 是 `scripts/tribunal.sh`。Legacy entrypoints 例如 `scripts/tribunal-all-claude.sh` MAY 作為 wrapper 保留，但 SHALL delegate 到 canonical runner。

#### Scenario: Legacy wrapper invocation

- **WHEN** 既有 automation 呼叫 `scripts/tribunal-all-claude.sh <post>`
- **THEN** wrapper SHALL delegate 到 `scripts/tribunal.sh <post>`
- **AND** 該 run SHALL 使用與 canonical command 相同的 Codex/GPT-5.5 runtime

### Requirement: Tribunal score transfer SHALL 使用 explicit score files

每個 tribunal judge SHALL 將 JSON score 寫入 runner 提供的 explicit score file path。runner SHALL 在寫入 frontmatter score metadata 前驗證 JSON schema。

#### Scenario: Judge returns malformed JSON

- **WHEN** judge 未能寫出 valid score JSON
- **THEN** 該 stage SHALL validation fail
- **AND** runner SHALL NOT 把 partial 或 untrusted score metadata 寫入 post

### Requirement: VibeScorer compatibility wrapper SHALL 保留 legacy output

`scripts/vibe-scorer.sh` SHALL delegate 到 canonical tribunal vibe stage，同時保留 older callers 預期的 legacy JSON output path contract。

#### Scenario: Legacy vibe scorer caller 傳入 output path

- **WHEN** 舊 script 呼叫 `scripts/vibe-scorer.sh <post> <output-path>`
- **THEN** wrapper SHALL 執行 `scripts/tribunal.sh --only-stage vibe <post>`
- **AND** wrapper SHALL 將 resulting vibe score JSON 寫到 `<output-path>`

