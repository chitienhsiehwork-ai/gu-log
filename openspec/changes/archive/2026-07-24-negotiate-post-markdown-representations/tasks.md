## 1. Negotiation contract

- [x] 1.1 實作純 `Accept` 解析器，覆蓋明確媒體類型、類型／全域萬用範圍、q 權重、明確程度、重複範圍、無效輸入與固定的 HTML 同分規則
- [x] 1.2 實作正式文章路徑 allowlist，接受帶／不帶尾端斜線的繁中／英文單一安全 slug，排除 `.md`、API、資產、列表與其他路徑
- [x] 1.3 加入 GET／HEAD 判斷單元測試，驗證缺少標頭、HTML、Markdown、偏好、同分、`q=0`、萬用範圍與 `application/markdown`

## 2. Vercel Routing Middleware

- [x] 2.1 加入官方 `@vercel/functions` 正式環境相依套件與根目錄 `middleware.ts`
- [x] 2.2 Markdown 勝出時在內部改寫到既有 `.md` 產物；其餘以 `next()` 前往原 HTML，兩條都輸出 `Vary: Accept`
- [x] 2.3 驗證中介層 matcher 有界，且路由額度、舊網址轉址與明確 `.md` 標頭不變

## 3. Deployment verification

- [x] 3.1 擴充 strict verifier，覆蓋繁中／英文正式 GET、偏好 Markdown、偏好 HTML、同分、`q=0`、萬用範圍、無效／不支援類型
- [x] 3.2 驗證 HEAD 沒有正文且 Content-Type／Vary 正確；API 與明確 `.md` 保持原契約，帶／不帶尾端斜線都能協商
- [x] 3.3 在相同正式網址交錯請求 HTML／Markdown，逐次驗 Content-Type、Vary 與正文 sentinel，證明 CDN 快取隔離
- [x] 3.4 在 Vercel 預覽跑一次完整 strict smoke，並確認 `deployment_status` gate 會對正式部署執行同一 verifier

## 4. Quality gates

- [x] 4.1 跑聚焦／完整單元測試、型別檢查、lint、format、build、repo hooks 與安全關卡
- [x] 4.2 完成正確性／安全 review 與簡化 review，修完所有阻擋問題
- [x] 4.3 同步 `post-markdown-representation` 穩定 spec、封存 change，確認 OpenSpec ownership／archive 關卡通過
