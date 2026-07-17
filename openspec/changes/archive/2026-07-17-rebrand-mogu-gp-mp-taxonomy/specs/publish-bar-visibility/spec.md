## MODIFIED Requirements

### Requirement: Sub-8 posts SHALL still publish at their own URL

有真 tribunal 分數但未達 PASS bar 的文章（below publish bar）SHALL 照常 build、有自己的文章頁 URL。分數未達 PASS bar 本身 MUST NOT 成為 commit、build 或 deploy 的阻擋條件（floor gate `composite >= 3` 是另一條既有規則，不在本 capability 範圍）。

#### Scenario: Below-bar post builds and serves

- **WHEN** 一篇文章帶有真 tribunal 分數（`hasTribunalScore()`，即 `scores.vibe.score` 為數值），且 `meetsPublishBar()` 判定不成立（例：vibe narrative=7、composite=8）
- **THEN** 該文章照常出現在 production build，其文章頁 URL 回 200

#### Scenario: Partial tribunal scores count as below bar

- **WHEN** 一篇文章有 `scores.vibe.score` 數值但缺其他 judge 的分數
- **THEN** 該文章不算 grandfathered——`isBelowPublishBar()` 判定成立，適用本 capability 全部 below-bar 行為

#### Scenario: Tribunal FAIL is advisory to the pipeline

- **WHEN** `gp-pipeline` 的 tribunal 階段回報 FAIL（任一 judge 未達 pass bar）
- **THEN** pipeline 記錄警告並繼續 best-effort deploy，MUST NOT 因此以非零 exit code 中止部署流程
