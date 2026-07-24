## 1. Markdown projection contract

- [x] 1.1 建立原始 MDX 盤點，列舉所有匯入、自訂元件、原生 JSX 元素、語意 class／attribute 與表達式形態；未知／未覆蓋結構或無法靜態判定的內容 SHALL 封閉失敗
- [x] 1.2 建立標準文章 DOM 投影與明確的轉接器登錄表，覆蓋目前全文集的所有自訂文章元件與 `artifact-callout` 原生 JSX 階層
- [x] 1.3 為註解、程式碼、圖片、Mermaid、diff、toggle／quiz／progress、learning map、artifact callout 與未知 native JSX 建立語意正負測試與 snapshot
- [x] 1.4 移除已渲染內容的 U+2060，將防斷行 U+00A0 正規化成一般空白，加入 kaomoji 可見文字不變與控制字元零殘留測試

## 2. Metadata、status 與 URL fidelity

- [x] 2.1 實作有版本的固定 YAML metadata schema，逐欄對應 post schema、`getPostAuthorshipNote()`、正式 URL 與 resolved status，optional 欄位以安全 serializer 輸出 `null`
- [x] 2.2 讓繁中／英文 post route 從 `resolvePostStatus()` 輸出每篇都存在的 article marker；另驗證 `PostStatusBanner` 與 marker 一致，覆蓋 published、英文繼承、deprecated、retired、replacement 與 marker 遺失／不符
- [x] 2.3 固定輸出 H1、條件式 status notice、單一來源歸屬、正文的順序；將站內連結與圖片正規化成外部 client 可解析的 URL，保留 heading、code fence 與 alt text

## 3. 靜態產物與可發現性

- [x] 3.1 在建置後原子產生 `dist/posts/{slug}.md` 與 `dist/en/posts/{slug}.md`，不得提交 generated Markdown
- [x] 3.2 為 `BaseLayout` 增加僅供文章使用的 optional `markdownUrl`，讓繁中／英文正式文章輸出正確的 `rel="alternate" type="text/markdown"`
- [x] 3.3 加入全文集 HTML／JSON／Markdown slug 集合、非空輸出與殘留匯入／JSX／script 完整性關卡，任何不一致阻止部署

## 4. Vercel 回應契約

- [x] 4.1 以固定數量的 Vercel 回應標頭 pattern 設定繁中／英文 `.md` 的 `Content-Type: text/markdown; charset=utf-8`
- [x] 4.2 將路由額度驗證擴成計算 headers、redirects 與 rewrites 的平台路由總量，維持平台上限封閉失敗
- [x] 4.3 保持正式 HTML、尾端斜線、既有 308 與 API 路由不變；本 change 不加入 `Accept` 協商 rewrite 或 middleware

## 5. 驗證與 non-regression

- [x] 5.1 加入匯出器單元／整合測試，覆蓋代表性繁中／英文文章、所有自訂元件、未知元件、壞 URL 與原子失敗
- [x] 5.2 鎖住 `/api/posts/{slug}.json` schema v2 的實際 top-level keys、原始 MDX 內文與 HTTP consumer 契約，證明匯出器沒有新增不存在的 status 欄位或改動 API
- [x] 5.3 跑全文集建置、Astro／Vitest／lint／format、文章 validator、taxonomy scanner 與 repo hooks
- [ ] 5.4 擴充 preview／production smoke test，驗證繁中與英文 `.md` 的 status、Content-Type、忠實度、alternate 可發現性，以及 HTML／JSON non-regression

## 6. 審查與封存

- [x] 6.1 完成獨立 correctness／security review 與 simplify review，修完所有阻擋問題
- [ ] 6.2 同步 `post-markdown-representation` delta spec、封存 change，確認 OpenSpec ownership／archive 關卡通過
