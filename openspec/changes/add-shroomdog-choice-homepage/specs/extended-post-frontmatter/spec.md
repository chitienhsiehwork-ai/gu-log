## ADDED Requirements

### Requirement: Frontmatter 支援 unlisted 曝光控制

Post frontmatter SHALL 支援可選的 `unlisted` 布林欄位，缺省值 SHALL 為 `false`。`unlisted` SHALL 保持為獨立 metadata，不得擴充或取代 `published | retired | deprecated` 的文章生命週期狀態。

#### Scenario: 缺少 unlisted 時採公開預設

- **WHEN** post frontmatter 沒有 `unlisted`
- **THEN** Zod schema 驗證 SHALL 通過
- **AND** parsed data 的 `unlisted` SHALL 為 `false`

#### Scenario: unlisted 接受布林值

- **WHEN** post frontmatter 設定 `unlisted: true`
- **THEN** Zod schema 驗證 SHALL 通過並保留該值

#### Scenario: unlisted 拒絕非布林值

- **WHEN** post frontmatter 設定 `unlisted: "yes"`
- **THEN** Zod schema 驗證 SHALL 失敗
