## MODIFIED Requirements

### Requirement: 每篇 canonical post SHALL 有明確的靜態 Markdown 表示

系統 SHALL 在每次 production build 為所有可建置的繁中與英文 canonical post 產生 deterministic Markdown artifact。繁中 artifact SHALL 位於 `/posts/{slug}.md`，英文 artifact SHALL 位於 `/en/posts/{slug}.md`，且每個 artifact SHALL 只由同一篇 authoritative content、既有 metadata 與有效 status SSOT 衍生，不得成為可獨立編輯或提交 Git 的第二份內容來源。

每個 artifact SHALL 以 `schemaVersion: 1` 的 YAML frontmatter 開頭，固定包含 `slug`、`ticketId`、`lang`、`title`、`summary`、`originalDate`、`translatedDate`、`source`、`sourceUrl`、nullable `author`、`authorshipNote`、absolute `canonicalUrl`、effective `status`、nullable `replacementTicketId` 與 nullable absolute `replacementUrl`。欄位 SHALL 由安全 YAML serializer 輸出並逐欄對應既有 post schema、`getPostAuthorshipNote()`、`getLocalizedPostUrl()` 與 `resolvePostStatus()`；不得用 description、published date 或其他推測欄位取代現有 SSOT。

Frontmatter 後的順序 SHALL 固定為單一 H1 title、只在非 published 時出現的 status／replacement blockquote、單一 source attribution blockquote，最後才是文章正文。正文 SHALL NOT 重複頁面 header 的 H1、日期或來源卡。已下架（`status: taken-down`）的文章 SHALL 照樣產生 artifact 並使用同一套 frontmatter，但正文 SHALL 換成簡短的墓碑內容與來源連結（見 `post-takedown`），SHALL NOT 含任何原本的正文。

#### Scenario: 繁中與英文文章成功建置

- **WHEN** content collection 各包含一篇有效的繁中與英文文章
- **THEN** build SHALL 為兩篇文章各產生對應語系與 slug 的 `.md` artifact
- **AND** artifact SHALL 對應同一篇 canonical HTML 與既有 JSON API 資源
- **AND** generated Markdown SHALL NOT 被提交為內容 SSOT

#### Scenario: 任一格式缺少對應 artifact

- **WHEN** HTML、既有 JSON 或 Markdown 的繁中／英文 slug set 不相等，或任一 Markdown artifact 為空
- **THEN** build SHALL 以非 0 結束並阻止 deployment
- **AND** SHALL NOT 把不完整的一批 artifacts 視為成功輸出

#### Scenario: Optional metadata 缺少

- **WHEN** 文章沒有 `author` 或 resolved replacement
- **THEN** YAML frontmatter SHALL 依固定 schema 將對應欄位輸出為 `null`
- **AND** SHALL NOT 省略欄位、補猜測值或產生無法解析的 YAML

#### Scenario: 文章已下架

- **WHEN** 文章是 `status: taken-down`，原始 MDX 正文為空
- **THEN** build SHALL 仍為它產生對應語系與 slug 的 `.md` artifact，slug set 照舊與 HTML、JSON 一致
- **AND** artifact 的 frontmatter SHALL 記錄 `status: taken-down`
- **AND** 正文 SHALL 只含墓碑文案與連到 `sourceUrl` 的來源連結

### Requirement: Markdown SHALL 忠實保留文章的閱讀語意

Markdown artifact SHALL 保留文章 title、summary、originalDate、translatedDate、source／author attribution、canonical URL、有效 status／replacement、heading hierarchy、段落、清單、引用、連結、圖片 alt／URL、程式碼、表格，以及自訂文章元件的可閱讀語意。繁中與英文 SHALL 使用各自既有內容與 canonical path；英文文章的 effective status SHALL 沿用現有由繁中來源繼承的規則。已下架文章沒有文章內容可保留，artifact SHALL 只保留 metadata、墓碑文案與來源連結。

系統 SHALL 明確投影目前 corpus 使用的 MoguNote、ShroomDogNote、Toggle、LevelUpProgress、LevelUpQuiz、AnalogyBox、Mermaid、PostImage、DiffBlock 與 CodexLearningMap，也 SHALL 明確投影既有 `a.artifact-callout` 原生 JSX 階層。輸出 SHALL NOT 含 MDX import、JSX、script、layout navigation、互動 control、純裝飾 markup、hidden duplicate、U+2060 或 U+00A0。站內連結與圖片 URL SHALL 可由不具頁面 base context 的外部 client 解析。

#### Scenario: 文章含 Mogu 與 ShroomDog 註解

- **WHEN** 原文使用 MoguNote 或 ShroomDogNote
- **THEN** Markdown SHALL 以明確標示的可閱讀註解保留 speaker 與內容
- **AND** SHALL NOT 輸出 JSX tag、元件 import 或純裝飾 DOM

#### Scenario: 文章含互動與視覺元件

- **WHEN** 原文使用 Toggle、LevelUpQuiz、LevelUpProgress、Mermaid、DiffBlock 或 CodexLearningMap
- **THEN** Markdown SHALL 依對應 adapter 保留能獨立理解的題目、答案／說明、進度語意、diagram source／fallback、diff 或 learning-map 內容
- **AND** SHALL NOT 重複輸出 hidden content 或依賴 JavaScript 才能讀取的 controls

#### Scenario: 文章含站內連結與 Astro 處理的圖片

- **WHEN** rendered article 含相對站內連結或 build 後資產 URL
- **THEN** Markdown SHALL 輸出可從 `.md` endpoint 或獨立 client 正確解析的 URL
- **AND** 圖片 SHALL 保留 meaningful alt text 與實際可取得的 build asset URL

#### Scenario: 文章含 artifact callout

- **WHEN** 原文使用既有 `a.artifact-callout` 與固定巢狀 span 結構
- **THEN** Markdown SHALL 只輸出一個以主要 strong 文字為 label 的絕對 link，並各保留一次 callout label 與 meta
- **AND** SHALL NOT 輸出 tap／cta／icon／`aria-hidden` 裝飾或重複連結文字

#### Scenario: Kaomoji 經 rendered-only 防斷行處理

- **WHEN** rendered article 的可見文字含 remark plugin 注入的 U+2060 或 U+00A0
- **THEN** Markdown SHALL 移除 U+2060、將 U+00A0 正規化成一般空白並保留相同可見字串
- **AND** completeness gate SHALL 驗證兩種控制字元都沒有殘留

#### Scenario: 文章已 deprecated 或 retired

- **WHEN** 既有 `resolvePostStatus()` 將文章解析為 deprecated 或 retired，並可能提供 replacement
- **THEN** Markdown metadata 與開頭狀態提示 SHALL 反映相同 effective status
- **AND** replacement 存在時 SHALL 提供可解析的 replacement URL
- **AND** 英文 artifact SHALL 遵守目前由繁中來源繼承 status／replacement 的規則

#### Scenario: 文章已下架的閱讀語意

- **WHEN** 文章是 `status: taken-down`
- **THEN** Markdown SHALL 保留 title、中性摘要、日期、source 標示與 canonical URL
- **AND** SHALL NOT 輸出原本的 heading、段落、程式碼、圖片或自訂元件內容

### Requirement: Effective status SHALL 由每篇都存在的 route marker 封閉傳遞

繁中與英文 post route SHALL 直接從 `resolvePostStatus(post, allPosts)` 在每個已渲染 `<article>` 輸出 machine-readable marker，至少包含 effective status、nullable replacement ticket 與 nullable absolute replacement URL。Marker SHALL 對 published、deprecated、retired 與 taken-down 每篇都存在；匯出器 SHALL 與人類可見 `PostStatusBanner` 交叉驗證，且 SHALL NOT 以 banner 缺少推測 published。`taken-down` 的 marker SHALL 沒有 replacement，頁面 SHALL 沒有 status banner、SHALL 有唯一的墓碑元素；匯出器 SHALL 確認 marker、墓碑元素與 frontmatter 的 `taken-down` 三者一致，並確認原始 MDX 正文為空。

#### Scenario: Published 文章 marker 完整

- **WHEN** `resolvePostStatus()` 回傳 published
- **THEN** article marker SHALL 明確記錄 `published` 與 null replacement
- **AND** 頁面 SHALL 不含 status banner
- **AND** Markdown frontmatter SHALL 記錄相同 status

#### Scenario: Non-published marker 與 banner 一致

- **WHEN** `resolvePostStatus()` 回傳 deprecated 或 retired
- **THEN** article marker、status banner 與 Markdown frontmatter SHALL 記錄相同 effective status
- **AND** deprecated replacement 存在時 ticket 與 absolute URL SHALL 一致

#### Scenario: Published marker 遺失或 status 不一致

- **WHEN** article marker 缺少、enum／replacement contract 無效，或 marker 與 status banner 不一致
- **THEN** exporter SHALL 使 build 失敗並指出文章與 mismatch
- **AND** SHALL NOT 把 marker 遺失當成 published 或發布錯誤 status 的 Markdown

#### Scenario: 下架文章的 marker

- **WHEN** 文章是 `status: taken-down`
- **THEN** article marker SHALL 記錄 `taken-down` 與 null replacement
- **AND** 頁面 SHALL 有唯一的墓碑元素、沒有 status banner
- **AND** marker、墓碑元素或 frontmatter 三者任一不一致時，匯出器 SHALL 使 build 失敗
