# codex-tribunal-runtime Specification

## Purpose

定義 Tribunal 的 judge-specific runtime／model routing、canonical entrypoint、explicit score transfer 與 legacy VibeScorer compatibility 邊界。

## Requirements

### Requirement: Tribunal SHALL 依 judge 決定 runtime provider 與角色設定中的 model

Canonical tribunal runner SHALL 逐一依 judge 解析 runtime provider 與 model：

- **Librarian、FactChecker、FreshEyes** 在部署嚴格模式 SHALL 透過 Codex 執行，model SHALL 來自對應 `.codex/agents/<role>.toml`。
- **VibeScorer** 在部署嚴格模式 SHALL 透過 Claude 執行，model SHALL 來自 `.claude/agents/vibe-opus-scorer.md` 第一段 frontmatter。
- Provider/model 解析 SHALL 集中在能辨識 agent 身份的 helper，不得在 router 寫死 model 版本。
- `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` SHALL 是部署嚴格模式的唯一開關。未設定時 MAY 保留 Codex 不可用時的 CCC 相容 fallback，但進度與分數來源 SHALL 記錄實際 provider/model。
- `TRIBUNAL_FORCE_PROVIDER` 與 `GP_CODEX_MODEL` MAY 作為明示的單次執行覆寫；覆寫 SHALL 記錄實際來源。`TRIBUNAL_FORCE_PROVIDER` 與部署嚴格模式 SHALL NOT 同時啟用。

#### Scenario: 在部署嚴格模式跑完整 Tribunal

- **WHEN** operator 設定 `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` 執行 canonical tribunal runner
- **THEN** Librarian / FactChecker / FreshEyes SHALL 透過 Codex 與各自 TOML 宣告的 model 執行
- **AND** VibeScorer SHALL 透過 Claude 與其 frontmatter 宣告的 model 執行
- **AND** frontmatter 與進度紀錄 SHALL 誠實記錄各階段的實際 provider/model

#### Scenario: CCC sandbox 相容 fallback

- **WHEN** 部署嚴格模式未設定且 Codex 執行檔不在 PATH
- **THEN** judge 階段 MAY fallback 到 Claude 並讀各自 `.claude/agents/*.md` 的 model
- **AND** runner SHALL 在來源紀錄寫下實際 Claude provider/model

#### Scenario: 部署嚴格模式缺少必要 provider

- **WHEN** 部署嚴格模式啟用但 Vibe 缺少 Claude，或任一客觀 judge 缺少 Codex
- **THEN** runner SHALL 明確回報該角色失敗
- **AND** SHALL NOT 靜默改用另一個 provider

#### Scenario: Codex 角色設定無效

- **WHEN** 未設定 `GP_CODEX_MODEL` 覆寫，且客觀 judge 的 TOML 缺少或包含無效 model
- **THEN** Codex invocation SHALL 在執行前明確失敗
- **AND** SHALL NOT 使用隱性預設 model

#### Scenario: 部署嚴格模式拒絕全域 provider 覆寫

- **WHEN** operator 同時設定 `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` 與 `TRIBUNAL_FORCE_PROVIDER`
- **THEN** 部署前置檢查 SHALL 在文章派送前失敗
- **AND** SHALL 告知 operator 必須關閉部署嚴格模式才能執行覆寫實驗

#### Scenario: 相容模式明示全域 provider 覆寫

- **WHEN** 部署嚴格模式未設定且 operator 明示設定 `TRIBUNAL_FORCE_PROVIDER`
- **THEN** judge 階段 MAY 依覆寫使用同一 provider
- **AND** 實際 provider/model SHALL 寫入來源紀錄

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
