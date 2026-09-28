## MODIFIED Requirements

### Requirement: 保留 cluster 內的 primary post

同 cluster 內被分類為 `sourceType = primary` 的 post，dedup policy SHALL 保持其 `status = published`，SHALL NOT 對其觸發 deprecate action。一手 post 的 status 轉移只能來自 dedup 以外的外部理由（事實錯誤 / 過時危險 → `retired`；未取得授權的整篇翻譯或改寫 → `taken-down`，見 `post-takedown`），不能來自 dedup 規則。

#### Scenario: Mythos event cluster 內的 primary

- **WHEN** GP-165 屬於 Mythos event cluster 且 `sourceType = primary`
- **THEN** 所有 dedup rule SHALL NOT 將 GP-165 deprecate
- **AND** dedup rule SHALL NOT 改變 GP-165 的 `status`
- **AND** GP-165 之後因授權下架成 `taken-down` 屬於外部理由，不違反本要求

#### Scenario: Cluster 有多 primary 的情境

- **WHEN** 某 concept cluster 內出現兩篇都是 `sourceType = primary` 的 post（例：兩位獨立作者對 agentic engineering 的獨立一手論述）
- **THEN** 兩篇 SHALL 皆維持 `published`
- **AND** policy SHALL NOT 選一留一廢（primary 之間不互相 deprecate）
