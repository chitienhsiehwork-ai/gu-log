## ADDED Requirements

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

## MODIFIED Requirements

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
