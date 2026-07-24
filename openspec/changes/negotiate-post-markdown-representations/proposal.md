## Why

Issue #689 的第一階段已讓每篇繁中／英文文章都有固定生成的 `.md` 產物與 HTML alternate 宣告，但 agent 對正式文章網址傳送 `Accept: text/markdown` 時仍只會取得 HTML。若每個用戶端都必須自行猜 `.md` 路徑，正式引用網址與標準 HTTP 內容協商的價值仍未完成。

## What Changes

- 在 Vercel Routing Middleware 只攔截繁中／英文正式文章路徑，依 `Accept` 媒體範圍、明確程度與 q 權重選擇 HTML 或 Markdown。
- Markdown 勝出時在內部改寫到既有 `.md` 產物；網址、狀態與內容 SSOT 不變。
- HTML 與 Markdown 回應都輸出 `Vary: Accept`，並以預覽／正式環境的交錯請求 smoke 驗證 CDN 快取隔離。
- 明確保留缺少標頭／萬用範圍／同分／偏好 HTML／Markdown `q=0` 的 HTML fallback、HEAD 語意、既有尾端斜線 308、舊網址轉址、明確 `.md` 與 JSON API。

## Capabilities

### Modified Capabilities

- `post-markdown-representation`: 正式文章新增同網址 `Accept` 協商，同時保留明確 `.md` 與所有既有 HTML／JSON 契約。

## Impact

- 受影響程式：根目錄 Routing Middleware、純 `Accept` 解析器、部署 smoke 與單元測試。
- 相依套件：正式環境加入 Vercel 官方 `@vercel/functions` 中介層 helper。
- 執行環境：維持 Astro 靜態輸出；只有兩個有界的文章命名空間進入 Routing Middleware，不引入 SSR 或逐篇函式。
- 相容性：人類閱讀的 HTML、SEO、RSS、sitemap、JSON v2、既有轉址與 `.md` 產物皆維持不變。
