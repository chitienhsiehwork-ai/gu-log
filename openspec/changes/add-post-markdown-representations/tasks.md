## 1. Markdown projection contract

- [ ] 1.1 建立原始 MDX 盤點，列舉所有匯入、JSX 元素與表達式；未知／未覆蓋元件或無法靜態判定的內容 SHALL 封閉失敗
- [ ] 1.2 建立標準文章 DOM 投影與明確的元件轉接器登錄表，覆蓋目前全文集的所有自訂文章元件
- [ ] 1.3 為註解、程式碼、圖片、Mermaid、diff、toggle／quiz／progress 與 learning map 建立語意測試資料、snapshot 與殘留語法負面測試

## 2. Metadata、status 與 URL fidelity

- [ ] 2.1 從既有建置 metadata／JSON 產物投影 title、description、日期、來源、作者、正式 URL，不建立第二套 frontmatter parser
- [ ] 2.2 從現有 `resolvePostStatus()`／`PostStatusBanner` 呈現契約投影 effective status 與 replacement，覆蓋繁中、英文繼承、deprecated 與 superseded
- [ ] 2.3 將站內連結與圖片正規化成外部 client 可解析的 URL，保留 heading、code fence、alt text 與來源歸屬

## 3. 靜態產物與可發現性

- [ ] 3.1 在建置後原子產生 `dist/posts/{slug}.md` 與 `dist/en/posts/{slug}.md`，不得提交 generated Markdown
- [ ] 3.2 為 `BaseLayout` 增加僅供文章使用的 optional `markdownUrl`，讓繁中／英文正式文章輸出正確的 `rel="alternate" type="text/markdown"`
- [ ] 3.3 加入全文集 HTML／JSON／Markdown slug 集合、非空輸出與殘留匯入／JSX／script 完整性關卡，任何不一致阻止部署

## 4. Vercel 回應契約

- [ ] 4.1 以固定數量的 Vercel 回應標頭 pattern 設定繁中／英文 `.md` 的 `Content-Type: text/markdown; charset=utf-8`
- [ ] 4.2 將路由額度驗證擴成計算 headers、redirects 與 rewrites 的平台路由總量，維持平台上限封閉失敗
- [ ] 4.3 保持正式 HTML、尾端斜線、既有 308 與 API 路由不變；本 change 不加入 `Accept` 協商 rewrite 或 middleware

## 5. 驗證與 non-regression

- [ ] 5.1 加入匯出器單元／整合測試，覆蓋代表性繁中／英文文章、所有自訂元件、未知元件、壞 URL 與原子失敗
- [ ] 5.2 鎖住 `/api/posts/{slug}.json` schema v2、原始 MDX 內文、status 與既有 consumer 契約，證明匯出器沒有改動 API
- [ ] 5.3 跑全文集建置、Astro／Vitest／lint／format、文章 validator、taxonomy scanner 與 repo hooks
- [ ] 5.4 擴充 preview／production smoke test，驗證繁中與英文 `.md` 的 status、Content-Type、忠實度、alternate 可發現性，以及 HTML／JSON non-regression

## 6. 審查與封存

- [ ] 6.1 完成獨立 correctness／security review 與 simplify review，修完所有阻擋問題
- [ ] 6.2 同步 `post-markdown-representation` delta spec、封存 change，確認 OpenSpec ownership／archive 關卡通過
