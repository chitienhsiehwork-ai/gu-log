## MODIFIED Requirements

### Requirement: 每篇 canonical post SHALL 有明確的靜態 Markdown 表示

系統 SHALL 在每次 production build 為所有可建置、且未下架的繁中與英文 canonical post 產生 deterministic Markdown artifact。已下架（`status: taken-down`）的文章 SHALL NOT 有 Markdown artifact，只以帶墓碑 marker 的 HTML 存在（見 `post-takedown`）。繁中 artifact SHALL 位於 `/posts/{slug}.md`，英文 artifact SHALL 位於 `/en/posts/{slug}.md`，且每個 artifact SHALL 只由同一篇 authoritative content、既有 metadata 與有效 status SSOT 衍生，不得成為可獨立編輯或提交 Git 的第二份內容來源。

每個 artifact SHALL 以 `schemaVersion: 1` 的 YAML frontmatter 開頭，固定包含 `slug`、`ticketId`、`lang`、`title`、`summary`、`originalDate`、`translatedDate`、`source`、`sourceUrl`、nullable `author`、`authorshipNote`、absolute `canonicalUrl`、effective `status`、nullable `replacementTicketId` 與 nullable absolute `replacementUrl`。欄位 SHALL 由安全 YAML serializer 輸出並逐欄對應既有 post schema、`getPostAuthorshipNote()`、`getLocalizedPostUrl()` 與 `resolvePostStatus()`；不得用 description、published date 或其他推測欄位取代現有 SSOT。

Frontmatter 後的順序 SHALL 固定為單一 H1 title、只在非 published 時出現的 status／replacement blockquote、單一 source attribution blockquote，最後才是文章正文。正文 SHALL NOT 重複頁面 header 的 H1、日期或來源卡。

#### Scenario: 繁中與英文文章成功建置

- **WHEN** content collection 各包含一篇有效的繁中與英文文章
- **THEN** build SHALL 為兩篇文章各產生對應語系與 slug 的 `.md` artifact
- **AND** artifact SHALL 對應同一篇 canonical HTML 與既有 JSON API 資源
- **AND** generated Markdown SHALL NOT 被提交為內容 SSOT

#### Scenario: 任一格式缺少對應 artifact

- **WHEN** 未下架文章在 HTML、既有 JSON 或 Markdown 的繁中／英文 slug set 不相等，或任一 Markdown artifact 為空
- **THEN** build SHALL 以非 0 結束並阻止 deployment
- **AND** SHALL NOT 把不完整的一批 artifacts 視為成功輸出

#### Scenario: 下架文章只剩 HTML 墓碑

- **GIVEN** 語料有未下架文章集合 L 與下架文章集合 T
- **WHEN** production build 產生 HTML、JSON 與 Markdown
- **THEN** HTML 的 slug set SHALL 等於 L 與 T 的聯集，JSON 與 Markdown 的 slug set SHALL 都等於 L
- **AND** T 的 HTML SHALL 帶墓碑 marker
- **AND** 任一下架文章出現 JSON 或 Markdown artifact，或它的 HTML 缺少墓碑 marker 時，build SHALL 以非 0 結束

#### Scenario: Optional metadata 缺少

- **WHEN** 文章沒有 `author` 或 resolved replacement
- **THEN** YAML frontmatter SHALL 依固定 schema 將對應欄位輸出為 `null`
- **AND** SHALL NOT 省略欄位、補猜測值或產生無法解析的 YAML

### Requirement: Effective status SHALL 由每篇都存在的 route marker 封閉傳遞

繁中與英文 post route SHALL 直接從 `resolvePostStatus(post, allPosts)` 在每個已渲染 `<article>` 輸出 machine-readable marker，至少包含 effective status、nullable replacement ticket 與 nullable absolute replacement URL。Marker SHALL 對 published、deprecated 與 retired 每篇都存在；匯出器 SHALL 與人類可見 `PostStatusBanner` 交叉驗證，且 SHALL NOT 以 banner 缺少推測 published。已下架文章的墓碑頁 SHALL 輸出 status 為 `taken-down` 的墓碑 marker，沒有 replacement，也沒有 status banner；匯出器 SHALL 確認帶墓碑 marker 的文章集合等於 frontmatter 的下架集合，且 SHALL NOT 為它們產生 Markdown。

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

#### Scenario: 下架文章的墓碑 marker

- **WHEN** 文章是 `status: taken-down`
- **THEN** 它的 HTML SHALL 帶 status 為 `taken-down` 的墓碑 marker
- **AND** 匯出器 SHALL 略過它，不產生 Markdown
- **AND** 墓碑 marker 缺少，或出現在未下架文章上時，匯出器 SHALL 使 build 失敗

### Requirement: Canonical HTML SHALL 可發現對應 Markdown

每個未下架的繁中與英文 canonical post 的 HTML `<head>` SHALL 包含且只包含一個對應同語系文章的 `<link rel="alternate" type="text/markdown">`。Alternate `href` SHALL 是可由外部 client 直接解析的 canonical absolute `.md` URL。非文章頁與下架文章的墓碑頁 SHALL NOT 因共用 layout 而輸出不存在的 Markdown alternate。

#### Scenario: Agent 從文章 HTML 尋找 Markdown 表示

- **WHEN** client 取得繁中或英文 canonical post HTML
- **THEN** `<head>` SHALL 提供對應語系與 slug 的 Markdown alternate URL
- **AND** GET 該 URL SHALL 取得同一篇文章的 Markdown artifact

#### Scenario: 非文章頁使用 BaseLayout

- **WHEN** 首頁、標籤頁或其他非文章 route 使用相同 layout
- **THEN** 頁面 SHALL NOT 輸出指向不存在文章 `.md` 的 alternate link

#### Scenario: 下架文章的墓碑頁

- **WHEN** client 取得下架文章的墓碑頁 HTML
- **THEN** `<head>` SHALL NOT 含 Markdown alternate link

### Requirement: 正式文章 SHALL 依 Accept 偏好協商 HTML 與 Markdown

未下架的繁中與英文正式文章網址 SHALL 對 GET 與 HEAD 請求在既有 HTML 與同篇 Markdown 產物間進行伺服器端內容協商。下架文章的正式網址 SHALL NOT 進行協商，一律依 `post-takedown` 回應 HTTP 410 墓碑頁。系統 SHALL 解析 `Accept` 媒體範圍的明確類型、類型萬用範圍、全域萬用範圍、明確程度與 q 權重；只有 `text/markdown` 的有效品質大於 0 且嚴格高於 `text/html` 時才 SHALL 選擇 Markdown，其餘情況 SHALL 保留 HTML。

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

#### Scenario: 下架文章不協商

- **WHEN** 用戶端對下架文章的正式網址傳送讓 Markdown 勝出的 `Accept`
- **THEN** 回應 SHALL 是 HTTP 410 的墓碑頁 HTML
- **AND** SHALL NOT 改寫到 `.md`
