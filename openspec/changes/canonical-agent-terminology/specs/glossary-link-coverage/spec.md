## ADDED Requirements

### Requirement: Glossary entries MAY forbid non-canonical zh-tw terms

啟用中的 glossary 項目 MAY 宣告 `forbiddenZhTw` 字串清單。Glossary 檢查器 SHALL 將 zh-tw 文章裡每一處讀者可見的禁用字串回報為阻擋發布的標準用詞違規，並 SHALL 指出該項目的 canonical `term` 作為替換目標。

檢查器 SHALL 對讀者可見的 `title`、`summary`、inline 或 block-list `tags` frontmatter 欄位與正文套用此規則；Markdown blockquote 也是讀者可見正文，SHALL 納入掃描。檢查器 SHALL NOT 掃描英文文章，亦 SHALL NOT 掃描程式碼區塊、行內程式碼、URL、Markdown 連結目的地、import/export 陳述式、MDX/HTML 標籤或屬性等非正文語法。

#### Scenario: forbidden Agent translation fails

- **WHEN** `Agent` glossary 項目在 `forbiddenZhTw` 宣告一個中文譯名
- **AND** zh-tw 文章在讀者可見的正文使用該譯名
- **THEN** 檢查器 SHALL 以非零狀態結束
- **AND** SHALL 回報檔案、行號、禁用詞、標準用詞與預期 glossary anchor

#### Scenario: frontmatter is reader-visible terminology

- **WHEN** zh-tw 文章的標題、摘要或標籤含有已設定的禁用詞
- **THEN** 檢查器 SHALL 回報標準用詞違規

#### Scenario: non-prose syntax is not rewritten policy

- **WHEN** 已設定的禁用字串只出現在程式碼區塊、行內程式碼、URL、連結目的地、import/export 語法，或 MDX/HTML 標籤或屬性
- **THEN** 檢查器 SHALL NOT 回報標準用詞違規

#### Scenario: blockquote remains reader-visible prose

- **WHEN** zh-tw 文章只在 Markdown blockquote 中使用已設定的禁用詞
- **THEN** 檢查器 SHALL 回報標準用詞違規

#### Scenario: English post does not inherit zh-tw ban

- **WHEN** 英文文章含有與 `forbiddenZhTw` 相符的文字
- **THEN** 檢查器 SHALL NOT 回報標準用詞違規

#### Scenario: changed glossary entry triggers historical scan

- **WHEN** PR 在啟用中的 glossary 項目新增或修改 `forbiddenZhTw`
- **THEN** 既有 changed-term ratchet SHALL 掃描所有 zh-tw 文章是否含有該項目的禁用詞
- **AND** 全站 glossary hard gate SHALL 阻止歷史違規上線
