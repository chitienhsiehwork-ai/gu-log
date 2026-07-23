## ADDED Requirements

### Requirement: 每篇 canonical post SHALL 有明確的靜態 Markdown 表示

系統 SHALL 在每次 production build 為所有可建置的繁中與英文 canonical post 產生 deterministic Markdown artifact。繁中 artifact SHALL 位於 `/posts/{slug}.md`，英文 artifact SHALL 位於 `/en/posts/{slug}.md`，且每個 artifact SHALL 只由同一篇 authoritative content、既有 metadata 與有效 status SSOT 衍生，不得成為可獨立編輯或提交 Git 的第二份內容來源。

#### Scenario: 繁中與英文文章成功建置

- **WHEN** content collection 各包含一篇有效的繁中與英文文章
- **THEN** build SHALL 為兩篇文章各產生對應語系與 slug 的 `.md` artifact
- **AND** artifact SHALL 對應同一篇 canonical HTML 與既有 JSON API 資源
- **AND** generated Markdown SHALL NOT 被提交為內容 SSOT

#### Scenario: 任一格式缺少對應 artifact

- **WHEN** HTML、既有 JSON 或 Markdown 的繁中／英文 slug set 不相等，或任一 Markdown artifact 為空
- **THEN** build SHALL 以非 0 結束並阻止 deployment
- **AND** SHALL NOT 把不完整的一批 artifacts 視為成功輸出

### Requirement: Markdown SHALL 忠實保留文章的閱讀語意

Markdown artifact SHALL 保留文章 title、description、published date、source／author attribution、canonical URL、有效 status／replacement、heading hierarchy、段落、清單、引用、連結、圖片 alt／URL、程式碼、表格，以及自訂文章元件的可閱讀語意。繁中與英文 SHALL 使用各自既有內容與 canonical path；英文文章的 effective status SHALL 沿用現有由繁中來源繼承的規則。

系統 SHALL 明確投影目前 corpus 使用的 MoguNote、ShroomDogNote、Toggle、LevelUpProgress、LevelUpQuiz、AnalogyBox、Mermaid、PostImage、DiffBlock 與 CodexLearningMap。輸出 SHALL NOT 含 MDX import、JSX、script、layout navigation、互動 control、純裝飾 markup 或 hidden duplicate。站內連結與圖片 URL SHALL 可由不具頁面 base context 的外部 client 解析。

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

#### Scenario: 文章已 deprecated 或 superseded

- **WHEN** 既有 `resolvePostStatus()` 將文章解析為 deprecated 或 superseded，並可能提供 replacement
- **THEN** Markdown metadata 與開頭狀態提示 SHALL 反映相同 effective status
- **AND** replacement 存在時 SHALL 提供可解析的 replacement URL
- **AND** 英文 artifact SHALL 遵守目前由繁中來源繼承 status／replacement 的規則

### Requirement: Exporter SHALL 對未知或不完整投影封閉失敗

系統 SHALL 在 raw MDX 層盤點 import、JSX element 與 expression，並在 rendered article 層以明確、可測的 adapter 投影自訂元件。Raw inventory、adapter registry 與 rendered markers SHALL 一致；遇到未知元件、未支援 expression、marker drift、殘留 MDX／script、無效 URL 或其他可能造成 silent data loss 的狀況時，整個 build SHALL 失敗，不得以 best-effort 純文字繼續 deploy。

#### Scenario: 新文章使用沒有 adapter 的自訂元件

- **WHEN** raw MDX inventory 發現不在 adapter registry 的自訂元件
- **THEN** exporter SHALL 回報文章與元件名稱並使 build 失敗
- **AND** SHALL NOT 只丟棄 tag、猜測語意或發布不完整 Markdown

#### Scenario: Raw component 與 rendered marker 不一致

- **WHEN** raw MDX 宣告已支援元件，但 rendered `.post-content` 缺少或改變其契約 marker
- **THEN** exporter SHALL 封閉失敗並指出 projection mismatch
- **AND** SHALL NOT 把可能遺失內容的 artifact 視為成功

#### Scenario: 輸出仍含可執行或 MDX 語法

- **WHEN** 轉換結果含 import、JSX tag、script 或無法靜態判定的 expression
- **THEN** completeness gate SHALL 拒絕該 artifact 並阻止 deployment

### Requirement: Canonical HTML SHALL 可發現對應 Markdown

每個繁中與英文 canonical post 的 HTML `<head>` SHALL 包含且只包含一個對應同語系文章的 `<link rel="alternate" type="text/markdown">`。Alternate `href` SHALL 是可由外部 client 直接解析的 canonical absolute `.md` URL。非文章頁 SHALL NOT 因共用 layout 而輸出不存在的 Markdown alternate。

#### Scenario: Agent 從文章 HTML 尋找 Markdown 表示

- **WHEN** client 取得繁中或英文 canonical post HTML
- **THEN** `<head>` SHALL 提供對應語系與 slug 的 Markdown alternate URL
- **AND** GET 該 URL SHALL 取得同一篇文章的 Markdown artifact

#### Scenario: 非文章頁使用 BaseLayout

- **WHEN** 首頁、標籤頁或其他非文章 route 使用相同 layout
- **THEN** 頁面 SHALL NOT 輸出指向不存在文章 `.md` 的 alternate link

### Requirement: Explicit `.md` response SHALL 有正確且有界的 Vercel 契約

繁中與英文 `.md` endpoint SHALL 回傳成功狀態與 `Content-Type: text/markdown; charset=utf-8`。Vercel config SHALL 使用固定數量的 path patterns，不得為每篇文章展開 route；route-budget validation SHALL 計算 headers、redirects 與 rewrites 的總 platform route usage，並在超過平台上限前封閉失敗。本 capability SHALL NOT 改變 canonical HTML、trailing slash、legacy redirect 或 same-URL `Accept` 行為。

#### Scenario: Client 直接請求繁中與英文 `.md`

- **WHEN** preview 或 production client GET 一篇繁中或英文文章的 explicit `.md` URL
- **THEN** response SHALL 成功並回傳 `text/markdown` media type 與 UTF-8 charset
- **AND** body SHALL 通過代表性 metadata 與內容 fidelity assertion

#### Scenario: Route config 接近平台上限

- **WHEN** Vercel headers、redirects 與 rewrites 的總 route usage 超過 repo 定義的安全上限
- **THEN** validation SHALL 以非 0 結束
- **AND** SHALL NOT 因只計 redirects 而誤判為可部署

#### Scenario: Canonical URL 收到 Markdown Accept header

- **WHEN** client 對 canonical HTML URL 傳送 `Accept: text/markdown`
- **THEN** 本 capability SHALL NOT 保證改寫回 `.md`
- **AND** same-URL negotiation、q-value、`Vary` 與 cache isolation SHALL 由後續獨立 capability 定義

### Requirement: 既有 JSON API SHALL 保持相容

新增 Markdown representation SHALL NOT 修改 `/api/posts/{slug}.json` schema v2、既有欄位、raw MDX body、status 語意或 HTTP contract。Exporter MAY 讀取 build 後 JSON artifact 做 metadata projection 與 cross-format completeness validation，但 SHALL NOT 把 Markdown 清理結果寫回 JSON 或要求既有 consumer 改用新 schema。

#### Scenario: 既有 JSON consumer 讀取文章

- **WHEN** client 在加入 Markdown representation 前後請求同一篇 `/api/posts/{slug}.json`
- **THEN** response schema version、欄位、raw MDX body 與 status contract SHALL 保持相容
- **AND** response SHALL NOT 被替換成清理後 Markdown

#### Scenario: Markdown exporter 失敗

- **WHEN** exporter 因未知元件或 completeness mismatch 失敗
- **THEN** build SHALL 阻止整批 deployment
- **AND** SHALL NOT 修改已存在的 JSON API source contract 來掩蓋失敗
