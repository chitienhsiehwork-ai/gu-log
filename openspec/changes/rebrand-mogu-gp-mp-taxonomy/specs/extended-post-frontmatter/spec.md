## ADDED Requirements

### Requirement: ticketId SHALL use the canonical series registry

Published and pending post frontmatter `ticketId` SHALL match `^(GP|MP|SD|Lv)-(\\d+|PENDING)$`. GP / MP articles SHALL use the same prefix in their canonical filename slug. SP and CP SHALL NOT be accepted as aliases.

#### Scenario: Canonical GP ticket passes

- **WHEN** a post uses `ticketId: GP-258` and a `gp-258-*` filename
- **THEN** frontmatter and filename validation SHALL pass

#### Scenario: Retired SP ticket fails

- **WHEN** a changed post uses `ticketId: SP-258`
- **THEN** validation SHALL fail with an actionable `use GP-258` diagnostic

## MODIFIED Requirements

### Requirement: Frontmatter 選填欄位

Frontmatter SHALL 支援以下選填欄位：`seriesId`、`dedup`（含子欄位）、`metadata.gateWarnings`、`stage4Scores`、**`scores`（含四個 judge 子物件）**。選填欄位缺失 SHALL NOT 觸發 build 失敗。

`scores` 物件結構：
- `tribunalVersion`：正整數（選填）
- `librarian`：`{ glossary?, crossRef?, sourceAlign?, attribution?, score, date, model? }`
- `factCheck`：`{ accuracy?, fidelity?, consistency?, sourceBoundary?, commentarySeparation?, score, date, model? }`
- `freshEyes`：`{ readability?, firstImpression?, payoffDensity?, lengthFit?, clarity?, score, date, model? }`
- `vibe`：`{ persona?, moguNote?, vibe?, clarity?, narrative?, score, date, model? }`

每個 judge 子物件為選填（允許累進寫入）。維度分數為 0-10 整數，`score` 為 composite（`floor(avg)`），`date` 為 ISO 8601 字串，`model` 為 model label 字串（選填）。各 `tribunalVersion` 實際必填維度與 clarity ownership SHALL 由 `tribunal-scoring-dimensions` 決定，避免在 storage superset 重複 version table。Persona-note key 在所有版本一律為 `moguNote`；`clawdNote` SHALL NOT be accepted or silently stripped as a fallback key。

Top-level `stage4Scores` 結構為 `{ persona, moguNote, vibe, clarity, narrative, degradedDimensions?, isDegraded }`，不是 `scores` 的子欄位。

#### Scenario: 只有部分 judge 分數的 post build 成功

- **WHEN** post 的 frontmatter 有 `scores.vibe` 但沒有 `scores.factCheck`
- **THEN** Zod schema 驗證 SHALL 通過
- **AND** build SHALL 成功

#### Scenario: scores 完全缺失的 post build 成功

- **WHEN** post 的 frontmatter 沒有 `scores` 欄位
- **THEN** Zod schema 驗證 SHALL 通過（scores 整體是 optional）

#### Scenario: scores 內的維度分數超出範圍 build 失敗

- **WHEN** post 的 `scores.vibe.persona` 值為 `11`（超出 0-10）
- **THEN** Zod schema 驗證 SHALL 失敗

#### Scenario: retired score key fails

- **WHEN** post 的 `scores.vibe` 或 `stage4Scores` 使用 `clawdNote`
- **THEN** schema / content validation SHALL 失敗
- **AND** diagnostic SHALL 要求改成 `moguNote`

### Requirement: Schema 層 cross-field invariants

Zod schema SHALL 驗證以下同一篇 post 內部的 cross-field invariants（欄位互相不矛盾）。此規則為「單兵檢查」—— 不讀其他 post、不呼叫語言模型。

1. `status = 'deprecated'` ↔ `deprecatedBy` 必須存在
2. `dedup.humanOverride = true` → `dedup.humanOverrideReason` 必須存在且非空
3. `dedup.acknowledgedOverlapWith` 存在且非空陣列 → `dedup.overlapJustification` 必須存在且非空
4. `authorType = 'proxy'` → `author` 欄位 SHALL NOT 與 `authorCanonical` 完全相同

#### Scenario: deprecated 但缺 deprecatedBy 應 fail

- **WHEN** post 設 `status: deprecated` 但無 `deprecatedBy`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出 `deprecatedBy is required when status is deprecated`

#### Scenario: humanOverride 但缺 reason 應 fail

- **WHEN** post 設 `dedup.humanOverride: true` 但無 `dedup.humanOverrideReason`
- **THEN** Zod schema 驗證 SHALL 失敗

#### Scenario: acknowledgedOverlapWith 非空但缺 justification 應 fail

- **WHEN** post 設 `dedup.acknowledgedOverlapWith: ["GP-165"]` 但無 `dedup.overlapJustification`
- **THEN** Zod schema 驗證 SHALL 失敗

#### Scenario: proxy authorType 但 author 等於 canonical 應 fail

- **WHEN** post 設 `authorType: proxy`、`authorCanonical: "andrej-karpathy"`、`author: "andrej-karpathy"`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出 proxy 必須能從 author 欄位區分真實作者

#### Scenario: retired ticket reference fails before cross-field evaluation

- **WHEN** post 設 `dedup.acknowledgedOverlapWith: ["SP-165"]`
- **THEN** canonical taxonomy validation SHALL 失敗並要求 `GP-165`
