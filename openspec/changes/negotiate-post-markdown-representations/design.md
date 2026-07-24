## Context

第一階段已在建置後產生 `/posts/{slug}.md` 與 `/en/posts/{slug}.md`，並以 Vercel 有界標頭規則固定 `Content-Type`。剩餘工作只需要在請求路由層選擇現成的 HTML 或 Markdown 產物。Astro 目前是純靜態輸出；為此改成 SSR 會擴大成本、快取與故障面。

Issue #689 要求的不只是標頭字串包含判斷。`Accept` 是帶偏好的媒體範圍清單：明確類型、類型萬用範圍、`*/*`、q 權重、`q=0` 與同分都會影響選擇。正式 HTML 也是同網址的合法表示；若 Markdown 沒有正品質值且嚴格勝過 HTML，必須保守維持既有 HTML。

## Goals / Non-Goals

**Goals:**

- 對有效繁中／英文正式文章的 GET／HEAD 支援標準 `Accept` 偏好。
- 保持瀏覽器／預設 HTML 行為，並對兩種表示輸出 `Vary: Accept`。
- 以純函式鎖住 q 權重、明確程度、同分、無效輸入與路徑範圍。
- 以真實 Vercel 預覽／正式環境驗證內部改寫、HEAD、帶／不帶尾端斜線的 canonical URL 與 CDN 快取隔離。

**Non-Goals:**

- 不改 Markdown projection、文章內容、JSON v2、RSS、sitemap 或 editorial pipeline。
- 不支援 `application/markdown` 別名、User-Agent 偵測、MCP、`llms.txt` 或 Markdown sitemap。
- 不把 Astro 改成混合／SSR，也不建立每篇文章的執行期函式。

## Decisions

### 1. 使用根目錄 Vercel Routing Middleware，不改 Astro 輸出模式

新增根目錄 `middleware.ts`，以 `@vercel/functions` 的 `next()` 與 `rewrite()` 操作現有靜態產物。Matcher 只涵蓋 `/posts/:path*` 與 `/en/posts/:path*`，程式內再用單一區段 slug allowlist 封閉範圍。

Markdown 勝出時把請求路徑改為同路徑加 `.md`，保留查詢字串並在內部改寫；HTML 則 `next()`。兩條回應都設定 `Vary: Accept`。中介層不讀檔、不查資料庫、不重新產生內容。

### 2. 以純函式計算兩個表示的有效品質

解析器只接受合法 `type/subtype` token 與合法 q 權重；缺少 q 預設為 1，非法範圍不參與選擇。對每個表示，較明確的範圍優先於萬用範圍；明確程度相同且重複宣告時取較高 q。

只有 `markdownQuality > 0 && markdownQuality > htmlQuality` 才選 Markdown。缺少 `Accept`、`*/*`、`text/*`、同分、HTML 較高、Markdown `q=0`、不認得或無效標頭都維持 HTML。這個同分規則保證一般瀏覽器與含廣泛萬用範圍的用戶端不會意外切換表示。

### 3. 保留 route canonicalization 的既有順序

只有沒有副檔名、只有一個安全 slug 區段的正式文章路徑會進行協商，並同時接受現行 canonical URL 使用的尾端斜線與無斜線形式。Markdown 勝出時，兩種形式都改寫到同一個明確 `.md` 產物。明確 `.md`、`/api/**`、資產、列表與舊 slug 轉址都不由中介層改寫，因此其狀態與 Location 契約不變。

### 4. `Vary: Accept` 是兩種回應共同的快取邊界

若只在 Markdown 回應設 `Vary`，先快取的 HTML 仍可能污染後續 agent 請求。中介層因此對範圍內的正式文章 HTML 與 Markdown 都設 `Vary: Accept`。部署 smoke 會以同一網址交錯請求 HTML／Markdown 多次，逐次檢查 Content-Type、Vary、正文 sentinel 與表示不串台。

## Risks / Trade-offs

- [Routing Middleware 是新增正式環境執行期] → matcher 與路徑解析器都有有界 allowlist，所有內容仍由靜態產物提供，先由預覽驗證再合併。
- [不同原始 `Accept` 字串可能造成 CDN 快取碎片] → `Vary` 是正確性必要邊界；目前只在文章路由使用，優先避免快取污染。
- [平台內部改寫的回應標頭行為與本機 helper 不完全相同] → 單元測試鎖住判斷，預覽／正式環境 smoke 鎖住實際 Vercel 標頭與正文。
- [未涵蓋完整 RFC 協商] → capability 明確只在 `text/html` 與 `text/markdown` 兩個表示間選擇；帶引號的擴充參數或非法範圍保守回 HTML。

## Migration Plan

1. 新增純解析器、路徑範圍與單元測試。
2. 加入 `@vercel/functions` 與根目錄中介層。
3. 擴充部署 verifier，先在預覽驗 q 權重、HEAD、Vary、帶／不帶尾端斜線、API／`.md` non-regression 與快取隔離。
4. 同步穩定 spec、封存 change、CI 全綠後合併。
5. 等正式部署 READY 後重跑相同 verifier；失敗時以 PR squash commit 回滾，不改文章 SSOT。

## Open Questions

無。平台 API、中介層放置位置與快取標頭行為都由官方文件加預覽 smoke共同驗證。
