## 1. Negotiation contract

- [ ] 1.1 實作純 `Accept` 解析器，覆蓋明確媒體類型、類型／全域萬用範圍、q 權重、明確程度、重複範圍、無效輸入與固定的 HTML 同分規則
- [ ] 1.2 實作正式文章路徑 allowlist，只接受無尾端斜線的繁中／英文單一安全 slug，排除 `.md`、API、資產、列表與其他路徑
- [ ] 1.3 加入 GET／HEAD 判斷單元測試，驗證缺少標頭、HTML、Markdown、偏好、同分、`q=0`、萬用範圍與 `application/markdown`

## 2. Vercel Routing Middleware

- [ ] 2.1 加入官方 `@vercel/functions` 正式環境相依套件與根目錄 `middleware.ts`
- [ ] 2.2 Markdown 勝出時在內部改寫到既有 `.md` 產物；其餘以 `next()` 前往原 HTML，兩條都輸出 `Vary: Accept`
- [ ] 2.3 驗證中介層 matcher 有界，且路由額度、既有 308／舊網址轉址與明確 `.md` 標頭不變

## 3. Deployment verification

- [ ] 3.1 擴充 strict verifier，覆蓋繁中／英文正式 GET、偏好 Markdown、偏好 HTML、同分、`q=0`、萬用範圍、無效／不支援類型
- [ ] 3.2 驗證 HEAD 沒有正文且 Content-Type／Vary 正確；API、明確 `.md` 與尾端斜線 308 保持原契約
- [ ] 3.3 在相同正式網址交錯請求 HTML／Markdown，逐次驗 Content-Type、Vary 與正文 sentinel，證明 CDN 快取隔離
- [ ] 3.4 在 Vercel 預覽與正式環境各跑一次完整 strict smoke

## 4. Quality gates

- [ ] 4.1 跑聚焦／完整單元測試、型別檢查、lint、format、build、repo hooks 與安全關卡
- [ ] 4.2 完成正確性／安全 review 與簡化 review，修完所有阻擋問題
- [ ] 4.3 同步 `post-markdown-representation` 穩定 spec、封存 change，確認 OpenSpec ownership／archive 關卡通過
