## MODIFIED Requirements

### Requirement: 保留 cluster 內的 primary post

同 cluster 內被分類為 `sourceType = primary` 的 post，dedup policy SHALL 保持其 `status = published`，SHALL NOT 對其觸發 deprecate action。一手 post 的 status 轉移只能來自外部（事實錯誤 / 過時危險 → `retired`），不能來自 dedup 規則。

#### Scenario: Mythos event cluster 內的 primary

- **WHEN** GP-165 屬於 Mythos event cluster 且 `sourceType = primary`
- **THEN** 所有 dedup rule SHALL NOT 將 GP-165 deprecate
- **AND** GP-165 的 `status` SHALL 維持 `published`

#### Scenario: Cluster 有多 primary 的情境

- **WHEN** 某 concept cluster 內出現兩篇都是 `sourceType = primary` 的 post（例：兩位獨立作者對 agentic engineering 的獨立一手論述）
- **THEN** 兩篇 SHALL 皆維持 `published`
- **AND** policy SHALL NOT 選一留一廢（primary 之間不互相 deprecate）

### Requirement: 無獨立差異的 derivative SHALL 被 BLOCK 或 deprecate

當同 cluster 內已存在 primary post，且 derivative post 無法證明 `independentDiff` 時，dedup-gate SHALL 在 pre-publish 階段 BLOCK 該 derivative；若該 derivative 已發佈，retroactive scan SHALL 建議 tribunal 將其 `status` 改為 `deprecated`，`deprecatedBy` 指向 cluster primary。`independentDiff` 存在與否由三種證據共同判定：(a) 寫手於 frontmatter 宣告 `dedup.independentDiff: <reason>`；(b) Librarian 讀兩篇比對是否有超越 primary 的內容貢獻；(c) structural sanity check（至少存在 primary 沒有的 heading-level 段落）。

#### Scenario: Pre-publish gate 擋下無 diff 的 derivative

- **WHEN** 新 post 進 dedup-gate 且 `sourceType = derivative`
- **AND** 同 cluster 內已有 primary
- **AND** 三項 `independentDiff` 證據皆不成立
- **THEN** gate SHALL 回拒發佈
- **AND** 錯誤訊息 SHALL 提示 writer 補 `dedup.independentDiff` frontmatter 或改以 `seriesId` 升級

#### Scenario: Retroactive scan 建議 deprecate 已發佈的無 diff derivative

- **WHEN** corpus scanner（Level G）偵測 MP-298 為 Mythos cluster 的 derivative
- **AND** GP-165（primary）已存在同 cluster
- **AND** MP-298 無 `independentDiff` 三項證據
- **THEN** scanner SHALL 回報建議
- **AND** tribunal 審核通過後 SHALL 設 `status = deprecated`、`deprecatedBy = GP-165`

#### Scenario: Derivative 有 independentDiff 應放行

- **WHEN** derivative post 的 frontmatter 帶 `dedup.independentDiff: "TechCrunch 補充了 Anthropic 未公開的內部時間線"`
- **AND** Librarian 讀後確認該 claim 成立
- **THEN** gate SHALL 放行
- **AND** post 以 `status = published` 存在 cluster 內

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
- **AND** writer 補 `dedup.acknowledgedOverlapWith: ["GP-165"]`, `dedup.overlapJustification: "需要中文化入口讓非英文讀者進入 Mythos 議題"`
- **THEN** gate SHALL 放行
- **AND** tribunal Librarian 讀 justification 判 approve / reject

#### Scenario: humanOverride 是最終手段

- **WHEN** tribunal Librarian reject 某 post
- **AND** user 堅持發佈，補 `dedup.humanOverride: true`、`dedup.humanOverrideReason: <string>`
- **THEN** gate SHALL 放行至 publish
- **AND** git commit SHALL 作為審計痕跡
