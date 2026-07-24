# post-markdown-representation Specification

## Purpose

定義 gu-log 每篇 canonical post 的 deterministic Markdown 表示、語意忠實度、可發現性、同 URL 的 HTML／Markdown 內容協商、明確 `.md` 回應契約，以及與既有 HTML／JSON 的相容邊界。

## Requirements

### Requirement: 每篇 canonical post SHALL 有明確的靜態 Markdown 表示

系統 SHALL 在每次 production build 為所有可建置的繁中與英文 canonical post 產生 deterministic Markdown artifact。繁中 artifact SHALL 位於 `/posts/{slug}.md`，英文 artifact SHALL 位於 `/en/posts/{slug}.md`，且每個 artifact SHALL 只由同一篇 authoritative content、既有 metadata 與有效 status SSOT 衍生，不得成為可獨立編輯或提交 Git 的第二份內容來源。

每個 artifact SHALL 以 `schemaVersion: 1` 的 YAML frontmatter 開頭，固定包含 `slug`、`ticketId`、`lang`、`title`、`summary`、`originalDate`、`translatedDate`、`source`、`sourceUrl`、nullable `author`、`authorshipNote`、absolute `canonicalUrl`、effective `status`、nullable `replacementTicketId` 與 nullable absolute `replacementUrl`。欄位 SHALL 由安全 YAML serializer 輸出並逐欄對應既有 post schema、`getPostAuthorshipNote()`、`getLocalizedPostUrl()` 與 `resolvePostStatus()`；不得用 description、published date 或其他推測欄位取代現有 SSOT。

Frontmatter 後的順序 SHALL 固定為單一 H1 title、只在非 published 時出現的 status／replacement blockquote、單一 source attribution blockquote，最後才是文章正文。正文 SHALL NOT 重複頁面 header 的 H1、日期或來源卡。

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

### Requirement: Markdown SHALL 忠實保留文章的閱讀語意

Markdown artifact SHALL 保留文章 title、summary、originalDate、translatedDate、source／author attribution、canonical URL、有效 status／replacement、heading hierarchy、段落、清單、引用、連結、圖片 alt／URL、程式碼、表格，以及自訂文章元件的可閱讀語意。繁中與英文 SHALL 使用各自既有內容與 canonical path；英文文章的 effective status SHALL 沿用現有由繁中來源繼承的規則。

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

### Requirement: Exporter SHALL 對未知或不完整投影封閉失敗

系統 SHALL 在 raw MDX 層盤點 import、自訂元件、原生 JSX element、語意 class／attribute 與 expression form，並在 rendered article 層以明確、可測的 adapter 投影已登錄結構。Raw inventory、adapter registry 與 rendered markers SHALL 一致；遇到未知元件、未知原生 JSX 階層／語意屬性、未支援 expression、marker drift、殘留 MDX／script、無效 URL 或其他可能造成 silent data loss 的狀況時，整個 build SHALL 失敗，不得以 best-effort 純文字繼續 deploy。

#### Scenario: 新文章使用沒有 adapter 的自訂元件

- **WHEN** raw MDX inventory 發現不在 adapter registry 的自訂元件
- **THEN** exporter SHALL 回報文章與元件名稱並使 build 失敗
- **AND** SHALL NOT 只丟棄 tag、猜測語意或發布不完整 Markdown

#### Scenario: Raw component 與 rendered marker 不一致

- **WHEN** raw MDX 宣告已支援元件，但 rendered `.post-content` 缺少或改變其契約 marker
- **THEN** exporter SHALL 封閉失敗並指出 projection mismatch
- **AND** SHALL NOT 把可能遺失內容的 artifact 視為成功

#### Scenario: 新文章使用未知 native JSX 結構

- **WHEN** raw inventory 發現未登錄的原生 JSX 階層、語意 class／attribute 或 expression form
- **THEN** exporter SHALL 回報文章與未知結構並使 build 失敗
- **AND** SHALL NOT 以 generic DOM text 折疊後繼續部署

#### Scenario: 輸出仍含可執行或 MDX 語法

- **WHEN** 轉換結果含 import、JSX tag、script 或無法靜態判定的 expression
- **THEN** completeness gate SHALL 拒絕該 artifact 並阻止 deployment

### Requirement: Effective status SHALL 由每篇都存在的 route marker 封閉傳遞

繁中與英文 post route SHALL 直接從 `resolvePostStatus(post, allPosts)` 在每個已渲染 `<article>` 輸出 machine-readable marker，至少包含 effective status、nullable replacement ticket 與 nullable absolute replacement URL。Marker SHALL 對 published、deprecated 與 retired 每篇都存在；匯出器 SHALL 與人類可見 `PostStatusBanner` 交叉驗證，且 SHALL NOT 以 banner 缺少推測 published。

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

### Requirement: Canonical HTML SHALL 可發現對應 Markdown

每個繁中與英文 canonical post 的 HTML `<head>` SHALL 包含且只包含一個對應同語系文章的 `<link rel="alternate" type="text/markdown">`。Alternate `href` SHALL 是可由外部 client 直接解析的 canonical absolute `.md` URL。非文章頁 SHALL NOT 因共用 layout 而輸出不存在的 Markdown alternate。

#### Scenario: Agent 從文章 HTML 尋找 Markdown 表示

- **WHEN** client 取得繁中或英文 canonical post HTML
- **THEN** `<head>` SHALL 提供對應語系與 slug 的 Markdown alternate URL
- **AND** GET 該 URL SHALL 取得同一篇文章的 Markdown artifact

#### Scenario: 非文章頁使用 BaseLayout

- **WHEN** 首頁、標籤頁或其他非文章 route 使用相同 layout
- **THEN** 頁面 SHALL NOT 輸出指向不存在文章 `.md` 的 alternate link

### Requirement: 正式文章 SHALL 依 Accept 偏好協商 HTML 與 Markdown

繁中與英文正式文章網址 SHALL 對 GET 與 HEAD 請求在既有 HTML 與同篇 Markdown 產物間進行伺服器端內容協商。系統 SHALL 解析 `Accept` 媒體範圍的明確類型、類型萬用範圍、全域萬用範圍、明確程度與 q 權重；只有 `text/markdown` 的有效品質大於 0 且嚴格高於 `text/html` 時才 SHALL 選擇 Markdown，其餘情況 SHALL 保留 HTML。

Markdown 回應 SHALL 以內部改寫讀取既有同語系 `.md` 產物，維持瀏覽器正式網址、成功狀態與 `Content-Type: text/markdown; charset=utf-8`。HTML 回應 SHALL 維持既有頁面正文、SEO 與 `text/html` 契約。兩種表示 SHALL 都包含 `Vary: Accept`。

#### Scenario: 用戶端明確只接受 Markdown

- **WHEN** 用戶端對有效繁中或英文正式文章傳送 `Accept: text/markdown`
- **THEN** 回應 SHALL 回傳同篇 Markdown 產物與 `text/markdown; charset=utf-8`
- **AND** 瀏覽器可見的正式網址 SHALL 不變
- **AND** 回應 SHALL 包含 `Vary: Accept`

#### Scenario: 用戶端較偏好 Markdown

- **WHEN** 用戶端傳送 `Accept: text/markdown, text/html;q=0.9`
- **THEN** 回應 SHALL 選擇 Markdown

#### Scenario: 用戶端較偏好 HTML 或兩者同分

- **WHEN** HTML 的有效 q-value 高於或等於 Markdown
- **THEN** 回應 SHALL 選擇既有 HTML
- **AND** SHALL NOT 因標頭中只要出現 `text/markdown` 字串就改寫

#### Scenario: Markdown 被明確拒絕

- **WHEN** 最明確的 `text/markdown` 範圍為 `q=0`
- **THEN** 回應 SHALL 選擇既有 HTML
- **AND** 萬用範圍 SHALL NOT 蓋過較明確的拒絕

#### Scenario: 缺少、萬用範圍或不支援的 Accept

- **WHEN** `Accept` 缺少、只含 `*/*`／`text/*`、格式無效或只要求 `application/markdown`
- **THEN** 回應 SHALL 保守選擇既有 HTML

#### Scenario: HEAD 使用相同 negotiation

- **WHEN** 用戶端對正式文章傳送 HEAD 與會選中 HTML 或 Markdown 的 `Accept`
- **THEN** 回應標頭 SHALL 對應 GET 會選中的表示
- **AND** 回應 SHALL 沒有訊息正文

### Requirement: 協商後的表示 SHALL 保持路由與快取隔離

內容協商 SHALL 只作用於沒有副檔名且只有一個安全 slug 區段的 `/posts/{slug}` 與 `/en/posts/{slug}`，並接受現行 canonical URL 的帶／不帶尾端斜線形式。明確 `.md`、`/api/**`、資產、列表、任意深層路徑與舊網址轉址 SHALL 保持既有路由契約。

同一正式網址的 HTML 與 Markdown 回應 SHALL 以 `Vary: Accept` 建立 CDN 快取邊界。交錯請求兩種表示時，每次回應的 Content-Type 與正文 SHALL 對應當次請求，不得因先前快取狀態而混用。

#### Scenario: 帶尾端斜線的正式文章同樣協商

- **WHEN** 用戶端對既有帶尾端斜線的正式文章網址傳送會讓 Markdown 勝出的 `Accept`
- **THEN** 回應 SHALL 回傳同篇 Markdown 產物與 `text/markdown; charset=utf-8`
- **AND** 回應 SHALL 包含 `Vary: Accept`
- **AND** 帶／不帶尾端斜線 SHALL 使用相同的表示選擇規則

#### Scenario: API 或明確 Markdown endpoint

- **WHEN** 用戶端請求 `/api/posts/{slug}.json` 或明確 `.md`
- **THEN** 回應 SHALL 維持既有 JSON v2 或明確 Markdown 契約
- **AND** 協商中介層 SHALL NOT 改寫該路徑

#### Scenario: 交錯請求 HTML 與 Markdown

- **WHEN** 用戶端對同一正式網址依序請求 HTML、Markdown、HTML、Markdown
- **THEN** 每次回應 SHALL 含 `Vary: Accept`
- **AND** HTML request SHALL 只取得 HTML，Markdown request SHALL 只取得 Markdown
- **AND** CDN SHALL NOT 將任一表示正文用於另一種請求

### Requirement: Explicit `.md` response SHALL 有正確且有界的 Vercel 契約

繁中與英文 `.md` endpoint SHALL 回傳成功狀態與 `Content-Type: text/markdown; charset=utf-8`。Vercel config SHALL 使用固定數量的路徑 pattern，不得為每篇文章展開路由；路由額度驗證 SHALL 計算標頭、轉址與改寫的總平台路由用量，並在超過平台上限前封閉失敗。同網址協商 SHALL 只在內部改寫到這些既有產物，不得改變明確 `.md`、舊網址轉址或 API 路由的原有契約。

#### Scenario: Client 直接請求繁中與英文 `.md`

- **WHEN** 預覽或正式環境的用戶端 GET 一篇繁中或英文文章的明確 `.md` 網址
- **THEN** 回應 SHALL 成功並回傳 `text/markdown` 媒體類型與 UTF-8 charset
- **AND** 正文 SHALL 通過代表性 metadata 與內容忠實度 assertion

#### Scenario: Route config 接近平台上限

- **WHEN** Vercel 標頭、轉址與改寫的總路由用量超過 repo 定義的安全上限
- **THEN** validation SHALL 以非 0 結束
- **AND** SHALL NOT 因只計 redirects 而誤判為可部署

#### Scenario: 正式網址收到 Markdown Accept 標頭

- **WHEN** 用戶端對正式文章網址傳送一個讓 Markdown 嚴格勝出的 `Accept`
- **THEN** 中介層 SHALL 在內部改寫到同篇明確 `.md` 產物
- **AND** 明確 endpoint 與協商回應 SHALL 使用相同 Markdown 表示

### Requirement: 既有 JSON API SHALL 保持相容

新增 Markdown representation SHALL NOT 修改 `/api/posts/{slug}.json` schema v2、現有 top-level keys、raw MDX body 或 HTTP contract。現有 JSON API 沒有 effective status 欄位；Exporter MAY 讀取 build 後 JSON artifact 做實際 metadata projection 與 cross-format completeness validation，但 SHALL NOT 新增 status、把 Markdown 清理結果寫回 JSON，或要求既有 consumer 改用新 schema。

#### Scenario: 既有 JSON consumer 讀取文章

- **WHEN** client 在加入 Markdown representation 前後請求同一篇 `/api/posts/{slug}.json`
- **THEN** response schema version、實際 top-level keys、raw MDX body 與 HTTP contract SHALL 保持相容
- **AND** response SHALL NOT 被替換成清理後 Markdown

#### Scenario: Markdown exporter 失敗

- **WHEN** exporter 因未知元件或 completeness mismatch 失敗
- **THEN** build SHALL 阻止整批 deployment
- **AND** SHALL NOT 修改已存在的 JSON API source contract 來掩蓋失敗
