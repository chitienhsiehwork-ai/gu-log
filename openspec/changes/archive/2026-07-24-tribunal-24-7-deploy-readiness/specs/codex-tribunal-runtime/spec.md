## REMOVED Requirements

### Requirement: Tribunal SHALL 依 judge 決定 runtime provider（VibeScorer=Claude Opus 4.5、其餘=Codex GPT-5.5）

**Reason**: Requirement 名稱與情境寫死 model 快照，且無法表達部署嚴格模式與 CCC 相容 fallback 的不同契約。以下改用「每個角色各自讀取設定」的 requirement。

## ADDED Requirements

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
