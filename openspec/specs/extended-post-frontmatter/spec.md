# extended-post-frontmatter Specification

## Purpose

定義 post frontmatter 的必填／選填欄位、正式 ticketId registry、schema-level invariants 與漸進 migration 邊界，避免 schema 承擔跨文章或語言模型判讀。

## Requirements

### Requirement: Frontmatter 必填欄位

每篇 post 的 frontmatter SHALL 有以下必填欄位：`sourceType`、`temporalType`、`authorCanonical`、`authorType`、`clusterIds`。Zod schema SHALL 在 build 階段驗證這些欄位的存在與型別。

**型別規範**：

- `sourceType`：enum of `'primary' | 'derivative' | 'commentary'`
- `temporalType`：enum of `'event' | 'evergreen' | 'hybrid'`
- `authorCanonical`：非空字串
- `authorType`：enum of `'individual' | 'org' | 'proxy'`
- `clusterIds`：字串陣列，允許為空陣列 `[]`

#### Scenario: 缺必填欄位的 post build 失敗

- **WHEN** post 的 frontmatter 缺少 `sourceType`
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** `pnpm run build` SHALL 回報 error 並指出缺欄位的 post 路徑

#### Scenario: enum 值不合法 build 失敗

- **WHEN** post 的 `temporalType` 值為 `"news"`（不在 enum 列表）
- **THEN** Zod schema 驗證 SHALL 失敗
- **AND** 錯誤訊息 SHALL 指出合法值 `event | evergreen | hybrid`

#### Scenario: clusterIds 允許空陣列

- **WHEN** 一篇獨立 standalone post 的 `clusterIds = []`
- **THEN** Zod schema 驗證 SHALL 通過
- **AND** 此 post 代表「目前未納入任何 cluster」

---

### Requirement: ticketId SHALL 使用正式系列登錄表

已發布與待發布文章的 frontmatter `ticketId` SHALL 符合 `^(GP|MP|SD|Lv)-(\\d+|PENDING)$`。GP／MP 文章的正式檔名 slug SHALL 使用相同 prefix。SP 與 CP SHALL NOT 作為別名被接受。

#### Scenario: 正式 GP ticket 通過

- **WHEN** 文章使用 `ticketId: GP-258` 與 `gp-258-*` 檔名
- **THEN** frontmatter 與檔名驗證 SHALL 通過

#### Scenario: 已退役的 SP ticket 失敗

- **WHEN** 變更後的文章使用 `ticketId: SP-258`
- **THEN** 驗證 SHALL 失敗，並提供可執行的 `use GP-258` 診斷

### Requirement: Frontmatter 選填欄位

Frontmatter SHALL 支援以下選填欄位：`seriesId`、`dedup`（含子欄位）、`metadata.gateWarnings`、`stage4Scores`、**`scores`（含四個 judge 子物件）**。選填欄位缺失 SHALL NOT 觸發 build 失敗。

`scores` 物件結構：

- `tribunalVersion`：正整數（選填）
- `librarian`：`{ glossary?, crossRef?, sourceAlign?, attribution?, score, date, model? }`
- `factCheck`：`{ accuracy?, fidelity?, consistency?, sourceBoundary?, commentarySeparation?, score, date, model? }`
- `freshEyes`：`{ readability?, firstImpression?, payoffDensity?, lengthFit?, clarity?, score, date, model? }`
- `vibe`：`{ persona?, moguNote?, vibe?, clarity?, narrative?, score, date, model? }`

每個 judge 子物件為選填（允許累進寫入）。維度分數為 0-10 整數，`score` 為 composite（`floor(avg)`），`date` 為 ISO 8601 字串，`model` 為 model label 字串（選填）。各 `tribunalVersion` 實際必填維度與 clarity ownership SHALL 由 `tribunal-scoring-dimensions` 決定，避免在 storage superset 重複 version table。Persona-note key 在所有版本一律為 `moguNote`；`clawdNote` SHALL NOT 被接受，也不得作為 fallback key 被靜默移除。

Top-level `stage4Scores` 結構為 `{ persona, moguNote, vibe, narrative, clarity?, degradedDimensions?, isDegraded }`，不是 `scores` 的子欄位。`clarity` 只屬於 `tribunalVersion <= 8` 的 legacy Vibe ownership；`tribunalVersion >= 9` 的 Stage 4 Vibe rescore SHALL NOT 寫入或偽造 `clarity`，clarity 依 `tribunal-scoring-dimensions` 由 Fresh Eyes 擁有。

#### Scenario: Version 9 Stage 4 不偽造 clarity

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

---

### Requirement: Schema 不做跨文章 / 語言模型判讀

Zod schema SHALL NOT 嘗試驗證需要跨文章或語言模型判讀的規則。以下情境 SHALL 留給下游 `dedup-gate`（Level F）與 `librarian dupCheck`（Level E）處理：

- derivative post 是否有 `independentDiff`（需讀 cluster 內 primary 才能判斷）
- 同作者湧現式系列的時間/主題重疊判定（B-3-A）
- commentary 觀點重疊度（B-2-C，需語言模型）

#### Scenario: Schema 放行缺 independentDiff 的 derivative

- **WHEN** post 設 `sourceType: derivative`，`dedup` 欄位完全不存在
- **AND** 無 cross-field invariant 衝突
- **THEN** Zod schema 驗證 SHALL 通過（這是 derivative 最常見狀態，schema 不該在此擋）
- **AND** 是否符合 dedup-policy B-2-B 規則 SHALL 留給 dedup-gate 判

#### Scenario: 放行後由 gate 接手

- **WHEN** post 通過 Zod schema 進入 dedup-gate
- **THEN** dedup-gate SHALL 讀 frontmatter 欄位與 cluster 內其他 post 對比
- **AND** 若觸發 BLOCK 規則 SHALL 回拒

---

### Requirement: 遷移策略 — 新欄位先選填再必填

新欄位的遷移 SHALL 走「硬性一次到位」策略（A 方案）：新欄位以 `.optional()` 上線作為短期施工支架，待 922 篇全部 backfill 完成後，`.optional()` SHALL 在同一個 commit 內移除，使欄位永久變必填。遷移過程 SHALL NOT 讓 production build 失敗超過單次 deploy 週期。

#### Scenario: 遷移第一階段 schema 先選填

- **WHEN** `extend-post-frontmatter` 首次 commit 落地
- **THEN** `sourceType` 等「最終必填」欄位 SHALL 暫以 `.optional()` 形式存在
- **AND** 既有 922 篇未動時 `pnpm run build` SHALL 通過

#### Scenario: 遷移腳本分批 commit

- **WHEN** `scripts/backfill-dedup-frontmatter.mjs` 執行
- **THEN** 腳本 SHALL 每補完 50 篇就 commit 一次
- **AND** commit 訊息 SHALL 包含批次序號與 ticketId 範圍

#### Scenario: 抽檢後整批放行

- **WHEN** 語言模型補完一批（50 篇）後
- **THEN** 腳本 SHALL 隨機列出 30 篇供 user 審（可少於一批，視批次大小）
- **AND** user 明確通過後 SHALL 繼續下一批
- **AND** 若抽檢失敗 SHALL 停機由 user 決定：重跑、調整 prompt、或手動修正後繼續

#### Scenario: 遷移完成後 schema 變必填

- **WHEN** 922 篇全部補完
- **THEN** 同一個 commit SHALL 把 `.optional()` 從 `sourceType`、`temporalType`、`authorCanonical`、`authorType`、`clusterIds` 移除
- **AND** 該 commit 的 pre-commit hook SHALL 執行 `validate-posts.mjs` 確保 922 篇全通過

#### Scenario: 事後誤判當場修正

- **WHEN** 遷移完成後 user 發現某篇文章的 `temporalType` 標錯
- **THEN** 修正 SHALL 是單一 commit，訊息格式 `fix: 修正 <ticketId> 分類`
- **AND** 修正 SHALL NOT 積壓成批次處理
