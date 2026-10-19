## MODIFIED Requirements

### Requirement: Un-scored posts SHALL be grandfathered

沒有 tribunal 分數的既有文章（`hasTribunalScore()` 判定不成立）SHALL 視為 unevaluated 而非 below bar：留在首頁列表、不掛精修中 banner，直到它獲得真分數為止。已下架（`status: taken-down`）的文章不適用本規則：它們沒有分數，但 SHALL 依 `post-takedown` 從首頁與所有列表移除，文章網址顯示墓碑頁。

#### Scenario: Grandfathered post stays on homepage

- **WHEN** 某文章 frontmatter 沒有 `scores.vibe.score` 數值
- **AND** 該文章沒有下架
- **THEN** `isBelowPublishBar()` 判定不成立，該文章留在首頁列表且不渲染精修中 banner

#### Scenario: Taken-down post is not grandfathered

- **WHEN** 某文章是 `status: taken-down` 且沒有 tribunal 分數
- **THEN** 該文章 SHALL NOT 出現在首頁列表
- **AND** 它的網址 SHALL 顯示墓碑頁，不渲染精修中 banner
