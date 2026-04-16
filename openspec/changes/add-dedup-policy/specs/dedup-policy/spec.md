## ADDED Requirements

### Requirement: 保留 cluster 內的 primary post

同 cluster 內被分類為 `sourceType = primary` 的 post，dedup policy SHALL 保持其 `status = published`，SHALL NOT 對其觸發 deprecate action。一手 post 的 status 轉移只能來自外部（事實錯誤 / 過時危險 → `retired`），不能來自 dedup 規則。

#### Scenario: Mythos event cluster 內的 primary

- **WHEN** SP-165 屬於 Mythos event cluster 且 `sourceType = primary`
- **THEN** 所有 dedup rule SHALL NOT 將 SP-165 deprecate
- **AND** SP-165 的 `status` SHALL 維持 `published`

#### Scenario: Cluster 有多 primary 的情境

- **WHEN** 某 concept cluster 內出現兩篇都是 `sourceType = primary` 的 post（例：兩位獨立作者對 agentic engineering 的獨立一手論述）
- **THEN** 兩篇 SHALL 皆維持 `published`
- **AND** policy SHALL NOT 選一留一廢（primary 之間不互相 deprecate）

---

### Requirement: 無獨立差異的 derivative SHALL 被 BLOCK 或 deprecate

當同 cluster 內已存在 primary post，且 derivative post 無法證明 `independentDiff` 時，dedup-gate SHALL 在 pre-publish 階段 BLOCK 該 derivative；若該 derivative 已發佈，retroactive scan SHALL 建議 tribunal 將其 `status` 改為 `deprecated`，`deprecatedBy` 指向 cluster primary。`independentDiff` 存在與否由三種證據共同判定：(a) 寫手於 frontmatter 宣告 `dedup.independentDiff: <reason>`；(b) Librarian 讀兩篇比對是否有超越 primary 的內容貢獻；(c) structural sanity check（至少存在 primary 沒有的 heading-level 段落）。

#### Scenario: Pre-publish gate 擋下無 diff 的 derivative

- **WHEN** 新 post 進 dedup-gate 且 `sourceType = derivative`
- **AND** 同 cluster 內已有 primary
- **AND** 三項 `independentDiff` 證據皆不成立
- **THEN** gate SHALL 回拒發佈
- **AND** 錯誤訊息 SHALL 提示 writer 補 `dedup.independentDiff` frontmatter 或改以 `seriesId` 升級

#### Scenario: Retroactive scan 建議 deprecate 已發佈的無 diff derivative

- **WHEN** corpus scanner（Level G）偵測 CP-298 為 Mythos cluster 的 derivative
- **AND** SP-165（primary）已存在同 cluster
- **AND** CP-298 無 `independentDiff` 三項證據
- **THEN** scanner SHALL 回報建議
- **AND** tribunal 審核通過後 SHALL 設 `status = deprecated`、`deprecatedBy = SP-165`

#### Scenario: Derivative 有 independentDiff 應放行

- **WHEN** derivative post 的 frontmatter 帶 `dedup.independentDiff: "TechCrunch 補充了 Anthropic 未公開的內部時間線"`
- **AND** Librarian 讀後確認該 claim 成立
- **THEN** gate SHALL 放行
- **AND** post 以 `status = published` 存在 cluster 內

---

### Requirement: 同 cluster 內觀點重疊的 commentary SHALL 觸發 WARN

當同 cluster 內已有一篇 `sourceType = commentary` 的 post，新 / 既存 commentary 與其 thesis（論點核心）重疊度由 LLM 判定超過門檻時，系統 SHALL 觸發 `WARN` 嚴格度：gate 放行但於 post metadata 記 `gateWarnings`，tribunal Librarian 的 dupCheck 維度 SHALL 必須 explicitly approve 後才允許發佈。

#### Scenario: Concept cluster 內第二篇觀點重疊

- **WHEN** concept cluster `agentic-engineering` 已有一篇 commentary
- **AND** 新 commentary post 被 LLM 判 thesis 重疊度 > 門檻
- **THEN** gate SHALL 放行但設 `metadata.gateWarnings`
- **AND** tribunal Librarian dupCheck SHALL 必須 approve 才發佈

#### Scenario: Cluster 內僅有一篇 commentary 不觸發

- **WHEN** concept cluster 內只有一篇 commentary
- **THEN** 此規則 SHALL NOT 觸發（觸發條件「cluster 內已有另一篇 commentary」不成立）

#### Scenario: Commentary angle 有差異時應放行

- **WHEN** 兩篇 commentary 主題相同但 thesis 差異（例如一篇從 governance 角度、一篇從 engineering 角度）
- **AND** LLM 判 thesis 重疊度 < 門檻
- **THEN** 此規則 SHALL NOT 觸發

---

### Requirement: 同作者湧現式系列應按梯度嚴格度觸發

兩篇或以上 post 符合以下條件時，系統 SHALL 觸發梯度 BLOCK / WARN / INFO：
1. 同 `authorCanonical` AND 同 `authorType`
2. 發佈間隔落於該 `authorType` 對應的嚴格度區間
3. 主題重疊度由 LLM 判定超過該 `authorType` 門檻
4. 無共通 `seriesId`

嚴格度區間：
- `authorType = individual`：1–7 天 `BLOCK`；8–14 天 `WARN`；15–30 天 `INFO`；>30 天不觸發。重疊門檻 70%。
- `authorType = org`：1–3 天 `BLOCK`；4–7 天 `WARN`；8–14 天 `INFO`；>14 天不觸發。重疊門檻 85%。

#### Scenario: Individual 作者 5 天內觸發 BLOCK

- **WHEN** post A 與 post B 同 `authorCanonical = "andrej-karpathy"`、同 `authorType = individual`
- **AND** 發佈間隔 5 天
- **AND** LLM 判重疊度 78%
- **AND** 兩篇皆無 `seriesId`
- **THEN** dedup-gate SHALL BLOCK 較晚者
- **AND** 錯誤訊息 SHALL 提示 writer 補 `seriesId` 或 `dedup.acknowledgedOverlapWith`

#### Scenario: Individual 作者 10 天觸發 WARN

- **WHEN** 條件同上但間隔 10 天、重疊 73%
- **THEN** gate SHALL 放行
- **AND** `metadata.gateWarnings` SHALL 記錄
- **AND** tribunal Librarian dupCheck SHALL 必須 approve

#### Scenario: Org 作者 11 天低重疊不觸發

- **WHEN** Anthropic（org）連續兩篇 blog 間隔 11 天
- **AND** LLM 判重疊度 45%（低於 org 門檻 85%）
- **THEN** 規則 SHALL NOT 觸發（超出 org `INFO` 窗 8–14，且重疊不足）

#### Scenario: 有 seriesId 直接豁免

- **WHEN** 兩篇 post 間隔 3 天、同作者、重疊度 90%
- **AND** 兩篇共享 `seriesId: "prompt-caching-tutorial"`
- **THEN** 規則 SHALL NOT 觸發（條件 4「無共通 seriesId」不成立）

---

### Requirement: Override 透過 escape hatch 進行

Writer SHALL 可透過以下三種方式對觸發的 dedup BLOCK 提出豁免：
1. 補 `seriesId` frontmatter — 升級為 intentional series
2. 補 `dedup.acknowledgedOverlapWith: [<postIds>]` 以及 `dedup.overlapJustification: <string>` — 明示已知重疊且刻意
3. 補 `dedup.humanOverride: true` 以及 `dedup.humanOverrideReason: <string>` — 作者（user）本人最終豁免

Gate SHALL 在任一 override 存在時重新檢查規則：若 override 適用規則豁免條件，SHALL 放行至 tribunal。

#### Scenario: seriesId 使 emergent rule 豁免

- **WHEN** post 觸發 B-3-A BLOCK
- **AND** writer 補 `seriesId: "karpathy-thinking-evolution"`
- **THEN** gate SHALL 重新檢查，識別為 intentional series
- **AND** SHALL 放行至 tribunal

#### Scenario: acknowledgedOverlapWith 使 derivative rule 豁免

- **WHEN** post 觸發 B-2-B BLOCK（derivative 無 diff）
- **AND** writer 補 `dedup.acknowledgedOverlapWith: ["SP-165"]`, `dedup.overlapJustification: "需要中文化入口讓非英文讀者進入 Mythos 議題"`
- **THEN** gate SHALL 放行
- **AND** tribunal Librarian 讀 justification 判 approve / reject

#### Scenario: humanOverride 是最終手段

- **WHEN** tribunal Librarian reject 某 post
- **AND** user 堅持發佈，補 `dedup.humanOverride: true`、`dedup.humanOverrideReason: <string>`
- **THEN** gate SHALL 放行至 publish
- **AND** git commit SHALL 作為審計痕跡

---

### Requirement: Override 必留 audit trail（Design Principle #5）

所有 dedup override SHALL 留下可追溯證據。系統 SHALL NOT 提供「silent override」或「back-channel 豁免」— 任何豁免 SHALL 在以下至少兩處留痕：
- Post frontmatter 欄位（`seriesId` / `dedup.acknowledgedOverlapWith` / `dedup.humanOverride`）
- Git commit（時間戳、作者、diff）
- Tribunal metadata（dupCheck 維度的 override acknowledgment）

#### Scenario: 正常 override 留雙重痕跡

- **WHEN** writer 補 `dedup.acknowledgedOverlapWith` 並 commit
- **THEN** frontmatter SHALL 記錄豁免標記
- **AND** git log SHALL 可追溯「誰、何時、為何」

#### Scenario: 系統拒絕 silent override

- **WHEN** 有人嘗試在 dedup-gate 加 bypass flag 但不寫 frontmatter
- **THEN** gate SHALL 拒絕此操作
- **AND** 錯誤訊息 SHALL 要求使用 public escape hatch

---

### Requirement: LLM 為 dedup 判斷 ground truth（Design Principle #4）

所有 dedup 規則的**最終判定** SHALL 由 LLM 做出。Embedding cosine、Jaccard、heuristic 等 metric SHALL NOT 獨立作為最終判定依據 — 它們僅用於 pre-filter（效能優化）。

#### Scenario: 預發佈 gate 用純 LLM 判定

- **WHEN** 新 post 進 pre-publish gate
- **AND** gate 挑出 3–5 篇候選 cluster 成員
- **THEN** LLM SHALL 逐對評估重疊度
- **AND** 規則觸發與否 SHALL 取決於 LLM 輸出

#### Scenario: Retroactive scan 用 embedding pre-filter + LLM 裁決

- **WHEN** corpus scanner 跑全庫
- **THEN** 系統 SHALL 先計算所有 post 的 embedding（precompute）
- **AND** 計算 pairwise cosine similarity matrix
- **AND** 對每篇取 top-K 最近鄰
- **AND** LLM SHALL 對 top-K 配對做最終判定
- **AND** embedding similarity 本身 SHALL NOT 作為 dedup 觸發依據

---

### Requirement: BLOCK 嚴格度規則 MUST 有 escape hatch（Design Principle #2）

每條 `strictness = BLOCK` 的 dedup 規則 SHALL 有 explicit、auditable 的 escape hatch。系統 SHALL NOT 引入「無法繞過的硬擋」。

#### Scenario: 每條 BLOCK 規則皆可 override

- **WHEN** 某 dedup 規則 strictness = BLOCK
- **THEN** 該規則 SHALL 有至少一種 escape hatch（`seriesId` / `acknowledgedOverlapWith` / `humanOverride`）
- **AND** escape hatch SHALL 有 audit trail

#### Scenario: 沒有 escape hatch 的規則違反 Principle #2

- **WHEN** 有人提議新增一條 BLOCK 規則但無 escape hatch
- **THEN** 此設計 SHALL 被拒絕
- **AND** 規則 SHALL 新增 escape hatch 後才可部署

---

### Requirement: Policy 以 AI slop 為首要設計敵人（Design Principle #3）

Policy SHALL 把「AI 同質化批量生成」視為首要設計敵人。每條規則設計 SHALL 能處理「同 AI / 同作者 / 同來源反覆生出相近主題 / 相近觀點 / 相近文章」的情境。

#### Scenario: Commentary 間互檢 反映 Principle #3

- **WHEN** concept cluster 累積多篇 AI-assisted commentary
- **THEN** B-2-C rule SHALL 從第二篇開始觸發 WARN
- **AND** tribunal 必須 approve 才發佈

#### Scenario: 同作者梯度反映 Principle #3

- **WHEN** 同 AI / 同作者短時間內反覆生相近 post
- **THEN** B-3-A rule SHALL 按發佈密度給梯度嚴格度

#### Scenario: Principle 用於新規則評估

- **WHEN** 有人提議新增一條 dedup 規則
- **THEN** 該規則 SHALL 回答「如何防 AI slop」這個問題
- **AND** 無法回答者 SHALL 被要求補強設計
