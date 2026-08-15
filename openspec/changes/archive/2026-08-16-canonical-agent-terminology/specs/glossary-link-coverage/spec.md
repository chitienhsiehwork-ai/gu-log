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

### Requirement: Canonical terminology-only migrations MUST be mechanically provable

既有文章只因 `forbiddenZhTw` 遷移而變更時，content-quality gate MAY 略過既有文章缺少 scores 的歷史債務，但 SHALL 先以確定性 proof 證明 staged 內容只包含：禁用詞改成該 entry 的 canonical `term`、`term（禁用詞）` 合併成 canonical term，以及對 canonical term 加上 glossary link wrapper。

Pre-commit 與 PR content-gate file selection SHALL 使用同一個 proof contract。任何不屬於上述轉換的 reader-visible 文字變更 SHALL 使 proof 失敗，並 SHALL 維持既有 score、pronoun 與內容品質 gate。

#### Scenario: mechanical Agent migration does not rescore legacy prose

- **WHEN** 無 scores 的既有文章只把「代理人」改成 `Agent`，並在第一次出現加上 `/glossary#agent` link
- **THEN** canonical terminology proof SHALL 通過
- **AND** content gate SHALL NOT 因該機械式 migration 要求重跑整篇 Tribunal

#### Scenario: adjacent rewrite cannot hide behind terminology migration

- **WHEN** staged 文章除了禁用詞替換與 glossary link 之外，還改寫同一行或相鄰行的其他 prose
- **THEN** canonical terminology proof SHALL 失敗
- **AND** 文章 SHALL 繼續接受一般 score 與內容品質 gate
