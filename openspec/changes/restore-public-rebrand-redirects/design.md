## Context

品牌遷移已有 `quality/brand-taxonomy-post-migration.json`，記錄每個舊 SP／CP 公開文章 slug 到新 GP／MP slug 的證據導出一對一映射。這些 slug 不是都能靠改前綴推導，因此舊 URL 全 404 會破壞真實讀者連結，而寬鬆前綴轉址又可能把不存在或錯配的內容導到錯頁。

公開 URL 相容性與機器契約的風險不同：前者是無狀態 HTTP 邊界，後者若保留 alias 會讓 frontmatter、API、pipeline、counter 與 automation 長期雙軌。本設計只恢復前者。

Vercel 專案可讀可程式化設定；靜態轉址／路由上限足以容納目前清單與列表規則。本機 Astro server 不會套用 Vercel 路由設定，因此測試必須分成設定契約與真實預覽／正式環境路由冒煙測試。

## Goals / Non-Goals

**Goals:**

- 所有清單有記錄的舊文章 URL 精確 308 到正式 URL。
- 真實存在過的 zh-tw／en 列表頁與分頁路徑 308 到正式列表頁。
- 映射、測試與維運證據都以遷移清單為 SSOT，不手抄表格。
- 無效、重複、自我迴圈或超出路由預算時一律封閉失敗。
- 網站地圖、新連結與所有機器契約保持 GP／MP／Mogu-only。

**Non-Goals:**

- 不恢復舊 frontmatter、ticketId、API、Reader、pipeline、counter、automation、artifact 或 asset alias。
- 不替沒有清單項目的 slug 猜目的地。
- 不引進 Vercel Bulk Redirects 付費功能或新的執行期服務。
- 不讓本機 Astro 測試假裝能驗證 Vercel 邊緣路由行為。

## Decisions

### 1. `vercel.mjs` 在建置／載入設定時由清單產生靜態轉址

新增可程式化 Vercel 設定，直接讀取 `quality/brand-taxonomy-post-migration.json`。每個 zh-tw 項目產生 `/posts/{oldSlug}` → `/posts/{newSlug}`；每個 en 項目產生 `/en/posts/{oldSlug}` → `/en/posts/{newSlug}`；全部使用 `permanent: true`（Vercel 回 HTTP 308）。另外明列 `/shroomdog-picks` → `/gu-log-picks`、`/clawd-picks` → `/mogu-picks` 的 zh-tw／en 基底與純數字 `/:page(\\d+)` 分頁規則；只把捕捉到的頁碼帶到正式列表頁，不接受任意深路徑。

設定載入時 SHALL 驗證必要欄位、語言、來源／目的地唯一性、無自我迴圈，並在總路由數達平台上限前失敗。測試從同一個匯出值讀規則，不再解析另一份手抄設定。

**Alternatives considered:**

- `vercel.json` 手抄規則：會複製清單，必然漂移，拒絕。
- 前綴萬用字元改寫：許多 slug 不是單純替換前綴，會導錯內容，拒絕。
- Vercel Bulk Redirects：目前數量會碰到方案／費用邊界，且增加外部控制台 SSOT，拒絕。
- Astro 動態轉址頁：需要留舊路由進應用程式樹，混淆機器契約切換，也增加執行期程式碼，拒絕。

### 2. 相容允許清單只開 HTTP 來源，不開機器 alias

Taxonomy 掃描器的精確殘留允許清單只允許可程式化設定、delta／stable spec、路由測試、切換手冊與部署冒煙測試中必要的舊 URL 字面值／清單證據。清單本身仍是遷移證據。任何現行內容、正式目的地、網站地圖、API、Reader、pipeline、counter 或 automation 出現舊契約都繼續封閉失敗。

**考慮過的替代方案：** 把舊 token 整個目錄排除；這會讓新舊契約偷渡，拒絕。

### 3. 驗證分成確定性全量契約與真實邊緣路由冒煙測試

單元／設定測試 SHALL 對所有清單項目做精確來源、目的地、永久轉址覆蓋，並檢查重複、迴圈、路由預算、列表白名單、正式目的地與網站地圖無舊 URL。Playwright 的本機 Astro 套件只負責正式頁面與未映射／非公開範圍仍 404，不宣稱能驗 308。

Vercel 預覽在 companion PR 合併前至少驗代表性的 zh-tw／en、GP／MP、列表頁／分頁：原始狀態 308、精確 `Location`、跟隨後 200、無迴圈。正式環境部署冒煙測試在切換後重跑同一組；另以有界並行的腳本對完整清單做原始轉址與跟隨結果稽核，保存摘要證據。

### 4. 配套 change 先合併進品牌重構分支，再做單一切換

此 change 使用堆疊 PR，base 為 `rebrand/mogu-gu-log-taxonomy`。完成 OpenSpec 歸檔、review、CI 與預覽證據後先合入品牌重構分支；接著 #586 對最新 `origin/main` 重跑完整檢查、復原演練與最終審查，再合併到 `main`。不在配套 PR 單獨改正式環境網域。

## Risks / Trade-offs

- **[可程式化設定不被 Vercel 接受或路由語法有差異]** → 在預覽先驗代表性基底、分頁與文章 URL；預覽不符即不合 #586。
- **[清單項目指向不存在的正式頁面]** → 設定測試對儲存庫正式文章集合做全量連接；預覽／正式環境完整清單稽核跟隨後必須 200。
- **[轉址數量未來接近平台上限]** → 設定載入與 CI 設硬上限；超限時另提架構 change，不靜默截斷。
- **[Taxonomy 允許清單因測試文字變寬]** → 精確路徑、精確 pattern 與預期計數；過時或計數漂移直接失敗。
- **[308 快取使錯映射難立即回收]** → 映射只取已 review 的不可變遷移清單；切換前保留復原分支／SHA，先在預覽全量驗證，再進正式環境。若邊緣路由本身有錯，立即復原部署；已快取用戶端仍可能延遲恢復，是永久轉址的固有代價。
- **[列表相容性誤接未存在路徑]** → 只明列兩個已存在列表命名空間的基底與純數字分頁；任意深路徑、未知文章、`/shroom-picks`、API、artifact 與 asset 都不匹配。

## Migration Plan

1. 在堆疊配套分支完成 delta spec、設定、確定性測試、部署冒煙測試與手冊。
2. 驗設定路由數、全部清單映射、正式目標存在性、taxonomy 檢查、建置與原品牌重構檢查。
3. 部署 Vercel 預覽，保存原始 308、精確 `Location`、跟隨後 200、無迴圈與完整清單稽核摘要。
4. 歸檔 OpenSpec change，兩位獨立 reviewer 放行，CI 全綠後合併配套 PR 到品牌重構分支。
5. Refresh `origin/main`，解漂移，對 #586 跑完整 CI、雙主題 UI、不相容影響、復原演練與正式環境路由計畫。
6. 合併 #586 後監看正式環境部署；完成正式路由、舊 URL 轉址、舊機器路徑 404 與網站地圖冒煙測試。
7. 若冒煙測試失敗，立即把正式環境復原到切換前部署／SHA，修正後重新走預覽檢查；不在 live VM 手改 alias。

## Open Questions

（無。公開 URL 使用精確永久轉址、機器契約維持不相容切換，已由 user 決定。）
