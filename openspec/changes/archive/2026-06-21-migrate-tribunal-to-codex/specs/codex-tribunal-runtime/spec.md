## ADDED Requirements

### Requirement: Tribunal v4 SHALL 讓所有 judge stages 使用 Codex GPT-5.5

Canonical tribunal runner SHALL 透過 `codex exec` 使用 model `gpt-5.5` 執行 Librarian、FactChecker、FreshEyes、VibeScorer。Codex 專用的 project agent 設定 SHALL 放在 `.codex/agents/*.toml`。`.claude/agents/*.md` 內的 historical Claude/Opus agent metadata MAY 作為 calibration context 保留，但 SHALL NOT 被修改或當成 Codex runtime model selection。

#### Scenario: Full tribunal run

- **WHEN** operator 對單篇 post 執行 canonical tribunal runner
- **THEN** 每個 judge stage SHALL 透過 Codex/GPT-5.5 執行
- **AND** frontmatter score metadata SHALL 記錄 runtime model `gpt-5.5`

#### Scenario: Single-stage run

- **WHEN** operator 執行 `scripts/tribunal.sh --only-stage vibe <post>`
- **THEN** 只有 VibeScorer stage SHALL 執行
- **AND** 該 stage SHALL 透過 Codex/GPT-5.5 執行

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
