## MODIFIED Requirements

### Requirement: `scripts/tribunal.sh` SHALL 是 canonical tribunal entrypoint

Canonical single-post tribunal entrypoint SHALL 是 `scripts/tribunal.sh`。Legacy entrypoints 例如 `scripts/tribunal-all-claude.sh` MAY 作為 wrapper 保留，但 SHALL delegate 到 canonical runner。

#### Scenario: Legacy wrapper invocation

- **WHEN** 既有 automation 呼叫 `scripts/tribunal-all-claude.sh <post>`
- **THEN** wrapper SHALL delegate 到 `scripts/tribunal.sh <post>`
- **AND** 該 run SHALL 使用與 canonical command 相同的 provider／model 路由（見〈Tribunal SHALL 依評審決定執行供應端與角色設定中的 model〉）
- **AND** wrapper SHALL NOT 自行指定 provider 或 model

### Requirement: VibeScorer compatibility wrapper SHALL 保留 legacy output

`scripts/vibe-scorer.sh` SHALL delegate 到 canonical tribunal vibe stage，同時保留 older callers 預期的 legacy JSON output path contract。Wrapper SHALL 只評分：不改寫文章、不寫 frontmatter、不 commit。

#### Scenario: Legacy vibe scorer caller 傳入 output path

- **WHEN** 舊 script 呼叫 `scripts/vibe-scorer.sh <post> <output-path>`
- **THEN** wrapper SHALL 執行 `scripts/tribunal.sh --score-only --only-stage vibe <post>`
- **AND** wrapper SHALL 將 resulting vibe score JSON 寫到 `<output-path>`
