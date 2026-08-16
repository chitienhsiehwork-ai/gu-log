<!-- md-zh-tw: ignore -->

## ADDED Requirements

### Requirement: Reader-facing series labels MUST state the editorial relationship to source

Reader-facing zh-TW 與 English UI SHALL 用符合系列 contract 的文字描述 source relationship。GP SHALL 使用翻譯語言；MP SHALL 使用 source-grounded writing 語言，並清楚指出正文由 Mogu 依來源撰寫。MP SHALL NOT 顯示為「翻譯自」、「原文出處」、`Translated from`、`Original source` 或 translation pipeline，也 SHALL NOT 假裝成沒有來源的 original writing。

#### Scenario: GP keeps translation labels

- **WHEN** reader 開啟 GP 首頁卡片、系列頁或文章頁
- **THEN** zh-TW UI SHALL 使用「翻譯自／原文出處／翻譯 pipeline」等 translation language
- **AND** English UI SHALL 使用對應的 translation language

#### Scenario: MP uses source-material labels

- **WHEN** reader 開啟 MP 首頁卡片、系列頁或文章頁
- **THEN** zh-TW UI SHALL 使用「來源材料／Mogu 依來源撰寫」等 source-grounded language
- **AND** English UI SHALL 使用 `Source material` 或同義的 source-grounded language
- **AND** MP technical details SHALL 描述 source-grounded writing pipeline

#### Scenario: legacy MP receives no new verification claim

- **WHEN** 既有 MP 使用新的中性 source-grounded label
- **THEN** UI SHALL NOT 宣稱該文曾通過本 change 之後才建立的 judge 或 verification
- **AND** SHALL NOT 因 label 更新而改寫文章內容或 frontmatter

## MODIFIED Requirements

### Requirement: Public and machine taxonomy SHALL share one canonical vocabulary

gu-log SHALL use the same canonical names in reader-facing UI and machine-facing storage. The commentary persona SHALL be `Mogu`; its note component SHALL be `MoguNote`; its Vibe score dimension SHALL be `moguNote`. The external-content series SHALL be `GP` (`Gu-log Picks`) for source-author-voice faithful translation and `MP` (`Mogu Picks`) for Mogu-authored source-grounded writing. Original and tutorial series SHALL remain `SD` and `Lv`.

The application SHALL NOT store SP/CP and translate them to GP/MP only at render time. Frontmatter, filenames, routes, counters, filters, APIs, search, feeds, pipelines, tests and generated data SHALL use the canonical values directly.

#### Scenario: GP article renders without an alias translation

- **GIVEN** a Gu-log Picks article has ticket `GP-258`
- **WHEN** the article is indexed, rendered, searched or returned by the feed API
- **THEN** every layer SHALL use `GP-258`
- **AND** no layer SHALL first store `SP-258` and replace its prefix for display

#### Scenario: MP article uses the same identity across layers

- **GIVEN** a Mogu Picks article has ticket `MP-314` and an `mp-314-*` slug
- **WHEN** pipeline output is validated and published
- **THEN** counter, frontmatter, filename, route, badge, search and feed SHALL agree on the MP identity
- **AND** reader-facing copy SHALL identify its source-grounded Mogu writing contract rather than translation
