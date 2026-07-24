# publish-bar-visibility Specification

## Purpose

定義低於 publish bar 文章的公開 URL、首頁排除、refining banner 與未評分 grandfather policy，讓可存取性和推薦資格保持分離。

## Requirements

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

### Requirement: Below-bar posts SHALL be excluded from the homepage index

首頁 / featured 文章列表 SHALL 排除 below publish bar 的文章。判定 SHALL 使用「有真分數 AND 未達完整 PASS bar」的語意（`isBelowPublishBar()`），PASS bar 的計算內容由 `tribunal-scoring-dimensions` spec 定義，本 capability 只消費其結果。

排除範圍**僅限首頁 / featured 列表**：below-bar 不是全站隱藏——RSS、search、tag、前後篇導覽等其他 published surfaces（`getPublishedPosts()` 語意）MUST 照常包含 below-bar 文章。

#### Scenario: Sub-8 post absent from homepage

- **WHEN** 首頁列表以 `getIndexPosts()` 產生，且某文章 `isBelowPublishBar()` 判定成立
- **THEN** 該文章不出現在首頁列表

#### Scenario: Passing post appears on homepage

- **WHEN** 某文章 `meetsPublishBar()` 判定成立 且非 deprecated
- **THEN** 該文章正常出現在首頁列表

### Requirement: Below-bar posts SHALL render a refining banner

below publish bar 的文章頁 SHALL 渲染「精修中」banner（zh-tw 與 en 兩種語言版本各自渲染對應文案），告知讀者該文尚未達 featured 標準、顯示目前 composite 分數。

#### Scenario: Banner on below-bar post page

- **WHEN** 渲染一篇 `isBelowPublishBar()` 判定成立 的文章頁
- **THEN** 頁面包含精修中 banner 與 `computeOverallComposite()` 分數

#### Scenario: No banner on passing post page

- **WHEN** 渲染一篇 `meetsPublishBar()` 判定成立 的文章頁
- **THEN** 頁面不包含精修中 banner

### Requirement: Un-scored posts SHALL be grandfathered

沒有 tribunal 分數的既有文章（`hasTribunalScore()` 判定不成立）SHALL 視為 unevaluated 而非 below bar：留在首頁列表、不掛精修中 banner，直到它獲得真分數為止。

#### Scenario: Grandfathered post stays on homepage

- **WHEN** 某文章 frontmatter 沒有 `scores.vibe.score` 數值
- **THEN** `isBelowPublishBar()` 判定不成立，該文章留在首頁列表且不渲染精修中 banner
