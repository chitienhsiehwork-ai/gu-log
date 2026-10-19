## MODIFIED Requirements

### Requirement: Schema 層跨欄位不變量

Zod schema SHALL 驗證以下同一篇文章內部的跨欄位不變量（欄位互相不矛盾）。此規則為「單兵檢查」——不讀其他文章、不呼叫語言模型。

1. `status = 'deprecated'` ↔ `deprecatedBy` 必須存在
2. `dedup.humanOverride = true` → `dedup.humanOverrideReason` 必須存在且非空
3. `dedup.acknowledgedOverlapWith` 存在且非空陣列 → `dedup.overlapJustification` 必須存在且非空
4. `authorType = 'proxy'` → `author` 欄位 SHALL NOT 與 `authorCanonical` 完全相同
5. `status = 'taken-down'` → `takenDownAt`（`YYYY-MM-DD`）與非空 `sourceTitle` 必須存在
6. `takenDownAt` 存在 → `status` 必須是 `taken-down`

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

#### Scenario: 下架文章缺 takenDownAt 應失敗

- **WHEN** post 設 `status: taken-down` 但無 `takenDownAt` 或 `sourceTitle`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出缺少的欄位

#### Scenario: 未下架文章帶 takenDownAt 應失敗

- **WHEN** post 設 `status: published` 卻有 `takenDownAt`
- **THEN** Zod schema 驗證 SHALL 失敗
