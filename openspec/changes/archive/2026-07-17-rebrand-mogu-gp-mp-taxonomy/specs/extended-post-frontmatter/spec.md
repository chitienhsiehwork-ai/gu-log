## ADDED Requirements

### Requirement: ticketId SHALL 使用正式系列登錄表

已發布與待發布文章的 frontmatter `ticketId` SHALL 符合 `^(GP|MP|SD|Lv)-(\\d+|PENDING)$`。GP／MP 文章的正式檔名 slug SHALL 使用相同 prefix。SP 與 CP SHALL NOT 作為別名被接受。

#### Scenario: 正式 GP ticket 通過

- **WHEN** 文章使用 `ticketId: GP-258` 與 `gp-258-*` 檔名
- **THEN** frontmatter 與檔名驗證 SHALL 通過

#### Scenario: 已退役的 SP ticket 失敗

- **WHEN** 變更後的文章使用 `ticketId: SP-258`
- **THEN** 驗證 SHALL 失敗，並提供可執行的 `use GP-258` 診斷

## MODIFIED Requirements

### Requirement: Frontmatter 選填欄位

Frontmatter SHALL 支援以下選填欄位：`seriesId`、`dedup`（含子欄位）、`metadata.gateWarnings`、`stage4Scores`、**`scores`（含四個 judge 子物件）**。選填欄位缺失 SHALL NOT 觸發 build 失敗。

`scores` 物件結構：
- `tribunalVersion`：正整數（選填）
- `librarian`：`{ glossary?, crossRef?, sourceAlign?, attribution?, score, date, model? }`
- `factCheck`：`{ accuracy?, fidelity?, consistency?, sourceBoundary?, commentarySeparation?, score, date, model? }`
- `freshEyes`：`{ readability?, firstImpression?, payoffDensity?, lengthFit?, clarity?, score, date, model? }`
- `vibe`：`{ persona?, moguNote?, vibe?, clarity?, narrative?, score, date, model? }`

每個 judge 子物件為選填（允許累進寫入）。維度分數為 0-10 整數，`score` 為 composite（`floor(avg)`），`date` 為 ISO 8601 字串，`model` 為 model label 字串（選填）。各 `tribunalVersion` 實際必填維度與 clarity ownership SHALL 由 `tribunal-scoring-dimensions` 決定，避免在 storage superset 重複 version table。Persona-note key 在所有版本一律為 `moguNote`；`clawdNote` SHALL NOT 被接受，也不得作為 fallback key 被靜默移除。

Top-level `stage4Scores` 結構為 `{ persona, moguNote, vibe, narrative, clarity?, degradedDimensions?, isDegraded }`，不是 `scores` 的子欄位。`clarity` 只屬於 `tribunalVersion <= 8` 的 legacy Vibe ownership；`tribunalVersion >= 9` 的 Stage 4 Vibe rescore SHALL NOT 寫入或伪造 `clarity`，clarity 依 `tribunal-scoring-dimensions` 由 Fresh Eyes 擁有。

#### Scenario: Version 9 Stage 4 不伪造 clarity

- **WHEN** `tribunalVersion >= 9` 的 post 寫入 `stage4Scores`
- **THEN** `stage4Scores` SHALL 只需 `persona`、`moguNote`、`vibe`、`narrative` 與 degradation metadata
- **AND** validation SHALL NOT 要求 `stage4Scores.clarity`
- **AND** controller SHALL NOT 將 Fresh Eyes clarity 複製成 Vibe score

#### Scenario: Version 8 Stage 4 保留 legacy clarity

- **WHEN** `tribunalVersion <= 8` 的 historical post 帶有 `stage4Scores.clarity`
- **THEN** validation SHALL 保留並接受該值

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

#### Scenario: 已退役的 score key 失敗

- **WHEN** post 的 `scores.vibe` 或 `stage4Scores` 使用 `clawdNote`
- **THEN** schema / content validation SHALL 失敗
- **AND** diagnostic SHALL 要求改成 `moguNote`

### Requirement: Schema 層跨欄位不變量

Zod schema SHALL 驗證以下同一篇文章內部的跨欄位不變量（欄位互相不矛盾）。此規則為「單兵檢查」——不讀其他文章、不呼叫語言模型。

1. `status = 'deprecated'` ↔ `deprecatedBy` 必須存在
2. `dedup.humanOverride = true` → `dedup.humanOverrideReason` 必須存在且非空
3. `dedup.acknowledgedOverlapWith` 存在且非空陣列 → `dedup.overlapJustification` 必須存在且非空
4. `authorType = 'proxy'` → `author` 欄位 SHALL NOT 與 `authorCanonical` 完全相同

#### Scenario: deprecated 但缺 deprecatedBy 應失敗

- **WHEN** post 設 `status: deprecated` 但無 `deprecatedBy`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出 `deprecatedBy is required when status is deprecated`

#### Scenario: humanOverride 但缺 reason 應失敗

- **WHEN** post 設 `dedup.humanOverride: true` 但無 `dedup.humanOverrideReason`
- **THEN** Zod schema 驗證 SHALL 失敗

#### Scenario: acknowledgedOverlapWith 非空但缺 justification 應失敗

- **WHEN** post 設 `dedup.acknowledgedOverlapWith: ["GP-165"]` 但無 `dedup.overlapJustification`
- **THEN** Zod schema 驗證 SHALL 失敗

#### Scenario: proxy authorType 但 author 等於 canonical 應失敗

- **WHEN** post 設 `authorType: proxy`、`authorCanonical: "andrej-karpathy"`、`author: "andrej-karpathy"`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出 proxy 必須能從 author 欄位區分真實作者

#### Scenario: 已退役 ticket reference 在跨欄位檢查前失敗

- **WHEN** post 設 `dedup.acknowledgedOverlapWith: ["SP-165"]`
- **THEN** canonical taxonomy validation SHALL 失敗並要求 `GP-165`
