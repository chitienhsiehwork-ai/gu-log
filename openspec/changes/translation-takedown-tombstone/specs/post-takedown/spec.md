## Purpose

定義已發布文章的「下架」契約：以 `taken-down` 狀態保留網址並回應 HTTP 410 墓碑頁，從所有公開列表與機器輸出移除內文，並規範下架批次的規則、授權紀錄與公開 repo 不留譯文和第三方原文全文。

## ADDED Requirements

### Requirement: 下架 SHALL 是只保留墓碑資料的獨立文章狀態

文章 frontmatter 的 `status` SHALL 支援 `taken-down`，代表文章已下架。下架文章的 frontmatter SHALL 只包含 `ticketId`、`title`、`lang`、`status`、`translatedDate`、`takenDownAt`、`source`、`sourceUrl`、`sourceTitle`，以及選填的 `author`；出現其他欄位時驗證 SHALL 失敗。`takenDownAt` SHALL 是 `YYYY-MM-DD` 格式的日期。`sourceTitle` SHALL 是非空字串，內容是來源自己的標題；來源沒有標題時可用來源開頭一句或 `source`，但 SHALL NOT 使用 gu-log 自己的文章標題。下架文章的正文 SHALL 為空，只允許空白字元。

同一 `ticketId` 的繁中檔與英文檔 SHALL 一起下架，並 SHALL 使用相同的 `takenDownAt`、`sourceUrl`、`sourceTitle` 與 `author`。

`deprecated` 與 `retired` SHALL 維持「文章仍公開全文、加上狀態標籤」的既有語意；任何工具 SHALL NOT 把它們當成下架。需要下架時 SHALL 使用 `taken-down`。

#### Scenario: 下架文章帶有多餘欄位

- **WHEN** 一篇 `status: taken-down` 的文章仍有 `summary`、`tags`、`scores` 或 `translatedBy`
- **THEN** frontmatter 驗證 SHALL 失敗
- **AND** 診斷 SHALL 指出多餘的欄位

#### Scenario: 下架文章留有正文

- **WHEN** 一篇 `status: taken-down` 的文章在 frontmatter 之後還有任何非空白內容，包含 `import` 行
- **THEN** 驗證 SHALL 失敗
- **AND** pre-commit 與 CI SHALL 得到相同結果

#### Scenario: 翻譯配對只下架一邊

- **WHEN** 同一 `ticketId` 的繁中檔是 `taken-down`，英文檔不是，或兩邊的 `takenDownAt` 不同
- **THEN** 驗證 SHALL 失敗

#### Scenario: 貼標籤不等於下架

- **WHEN** 一篇文章是 `retired` 或 `deprecated`
- **THEN** 文章頁 SHALL 依既有規則顯示全文與狀態標籤
- **AND** 回應狀態、列表、API、Markdown 與下架檢查 SHALL NOT 把它視為已下架

### Requirement: 下架文章的網址 SHALL 保留並回應 HTTP 410 墓碑頁

下架文章的繁中 `/posts/{slug}` 與英文 `/en/posts/{slug}`，連同恰好一個結尾斜線的形式，SHALL 回應 HTTP 410，正文 SHALL 是該篇的墓碑頁 HTML。這些回應 SHALL NOT 包含文章正文或譯文。下架文章的 `/api/posts/{slug}.json` SHALL NOT 存在；它的 `.md` 網址 SHALL 回應 HTTP 410，且 SHALL NOT 回傳 Markdown。

實作 SHALL NOT 為每篇下架文章新增平台轉址、改寫或標頭規則。決定哪些網址回 410 的下架清單 SHALL 由文章 frontmatter 決定性產生，並 SHALL 在 pre-push、CI 與 production build 前檢查是否與 frontmatter 一致。

#### Scenario: 讀者開啟下架文章

- **WHEN** 讀者以 GET 請求下架文章的繁中或英文正式網址，有或沒有結尾斜線
- **THEN** 回應 SHALL 是 HTTP 410，`Content-Type` SHALL 是 `text/html; charset=utf-8`
- **AND** 正文 SHALL 是該篇的墓碑頁

#### Scenario: HEAD 請求下架文章

- **WHEN** 用戶端以 HEAD 請求下架文章的正式網址
- **THEN** 回應 SHALL 是 HTTP 410
- **AND** 回應 SHALL 沒有訊息正文

#### Scenario: 用戶端偏好 Markdown

- **WHEN** 用戶端對下架文章的正式網址送出讓 `text/markdown` 勝出的 `Accept`
- **THEN** 回應 SHALL 仍是 HTTP 410 的墓碑頁 HTML
- **AND** SHALL NOT 改寫到 `.md`

#### Scenario: 用戶端請求下架文章的 Markdown

- **WHEN** 用戶端請求下架文章的 `.md` 網址
- **THEN** 回應 SHALL 是 HTTP 410
- **AND** 回應 SHALL NOT 含 Markdown 或譯文

#### Scenario: 用戶端請求下架文章的 JSON API

- **WHEN** 用戶端請求下架文章的 `/api/posts/{slug}.json`
- **THEN** 回應 SHALL 是 HTTP 404

#### Scenario: 舊網址轉到下架文章

- **GIVEN** 一條品牌遷移前的舊文章網址，依 `brand-taxonomy` 的遷移清單指向已下架文章
- **WHEN** 讀者請求那條舊網址
- **THEN** 回應 SHALL 先是 HTTP 308，`Location` 是下架文章的正式網址
- **AND** 追下去 SHALL 得到 HTTP 410 墓碑頁，沒有轉址迴圈

#### Scenario: 路由預算不隨下架增加

- **WHEN** 建置產生平台的標頭、轉址與改寫設定
- **THEN** 規則總數 SHALL NOT 因下架文章的數量增加

#### Scenario: 下架清單過期

- **WHEN** 某篇文章的 `status` 改成或改離 `taken-down`，但決定 410 的下架清單沒有重新產生
- **THEN** pre-push、CI 與 production build SHALL 失敗並指出清單過期

### Requirement: 墓碑頁 SHALL 呈現定稿內容且不露出文章內文

墓碑頁 SHALL 只包含：ticketId 與下架標籤、石碑、Mogu 對話框、去讀來源的卡片、回首頁連結，以及內容含文章標題的視覺隱藏 h1。石碑上 SHALL NOT 顯示文章標題。石碑日期 SHALL 是 `translatedDate` 到 `takenDownAt`，格式為 `YYYY.MM.DD – YYYY.MM.DD`。卡片 SHALL 連到 `sourceUrl`，第一行顯示 `sourceTitle`，第二行顯示「`author` · 網域」；網域是 `sourceUrl` 的 hostname 去掉開頭 `www.`，沒有 `author` 時第二行只顯示網域。對話框每一行句尾 SHALL NOT 加句號。

墓碑頁 SHALL 帶 `noindex`；`<title>` SHALL 標示已下架；meta description SHALL NOT 使用文章摘要。墓碑頁 SHALL NOT 輸出 Markdown alternate、目錄、tags、已讀／分享／登入控制、相關文章、系列與上下篇導覽、版本資訊與修改歷史連結、留言、AI popup 或任何文章正文。石碑文字 SHALL 在深淺兩種主題使用同一個深色墨水色，並對石面達到 WCAG AA 對比。顏文字 SHALL 依站上的顏文字不斷行規則處理。

#### Scenario: GP 繁中墓碑

- **WHEN** 讀者開啟一篇下架的繁中 GP
- **THEN** 標籤 SHALL 是 ticketId 與「已下架」
- **AND** 石碑 SHALL 依序顯示「gu-log 的」「翻譯文章之墓」「<發表日期> – <下架日期>」「安息吧 (－人－)」
- **AND** 對話框標題 SHALL 是「Mogu 內心小劇場：」
- **AND** 對話框五行 SHALL 依序是「嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ」「結果才知道，整篇翻譯要先經過作者同意」「可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))」「只好幫中文版立個小墓碑」「還好原文沒事，點下面去看原汁原味的吧！」
- **AND** 卡片標籤 SHALL 是「去讀原文 →」，頁尾連結 SHALL 是「回首頁 →」
- **AND** 視覺隱藏 h1 SHALL 是「<文章標題>（gu-log 翻譯文章，已下架）」
- **AND** `<title>` SHALL 是「<文章標題>（已下架） - gu-log」

#### Scenario: GP 英文 sidecar 墓碑

- **WHEN** 讀者開啟一篇下架的英文 GP sidecar
- **THEN** 標籤 SHALL 是 ticketId 與「Taken down」
- **AND** 石碑 SHALL 依序顯示「Here lies」「a gu-log translation」「<published date> – <takedown date>」「Rest in peace (－人－)」
- **AND** 對話框標題 SHALL 是「Mogu's inner monologue:」
- **AND** 對話框五行 SHALL 依序是「Waaah, I translated this whole thing ಥ_ಥ」「Then I learned: translating a whole article needs the author's OK」「But I'm way too introverted to ask ((( ；ﾟДﾟ)))」「So I gave the translation a little tombstone」「Good news: the original is alive and well. Go read it below!」
- **AND** 卡片標籤 SHALL 是「Read the original →」，頁尾連結 SHALL 是「Back to home →」
- **AND** 視覺隱藏 h1 SHALL 是「<title> (gu-log translation, taken down)」
- **AND** `<title>` SHALL 是「<title> (taken down) - gu-log」

#### Scenario: MP 墓碑

- **WHEN** 讀者開啟一篇下架的 MP
- **THEN** 繁中石碑第二行 SHALL 是「改寫文章之墓」，英文 SHALL 是「a gu-log rewrite」
- **AND** 繁中對話框五行 SHALL 依序是「嗚嗚，我辛辛苦苦寫了一整篇 ಥ_ಥ」「結果才知道，整篇改寫也要先經過作者同意」「可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))」「只好幫這篇立個小墓碑」「還好來源沒事，點下面去看原汁原味的吧！」
- **AND** 英文對話框五行 SHALL 依序是「Waaah, I rewrote this whole thing ಥ_ಥ」「Then I learned: rewriting a whole article needs the author's OK」「But I'm way too introverted to ask ((( ；ﾟДﾟ)))」「So I gave the rewrite a little tombstone」「Good news: the source is alive and well. Go read it below!」
- **AND** 卡片標籤 SHALL 是「去讀來源 →」與「Read the source →」
- **AND** 視覺隱藏 h1 SHALL 是「<文章標題>（gu-log 改寫文章，已下架）」與「<title> (gu-log rewrite, taken down)」
- **AND** 其餘標籤、石碑、頁尾與 `<title>` SHALL 與同語言的 GP 墓碑相同
- **AND** MP 墓碑 SHALL NOT 使用翻譯或「原文出處」類字眼

#### Scenario: 墓碑不露出文章周邊與內文

- **WHEN** 墓碑頁建置完成
- **THEN** HTML SHALL NOT 含文章正文容器、目錄、tags、Markdown alternate、版本歷史連結、留言與 AI popup
- **AND** HTML SHALL 帶 `noindex`

#### Scenario: 深色主題下的碑文

- **WHEN** 讀者以深色主題開啟墓碑頁
- **THEN** 碑文 SHALL 使用與淺色主題相同的深色墨水
- **AND** 碑文對米色石面的對比 SHALL 符合 WCAG AA

#### Scenario: 顏文字在窄螢幕

- **WHEN** 墓碑頁在 390px 寬的畫面換行
- **THEN** 「ಥ_ಥ」「((( ；ﾟДﾟ)))」「(－人－)」SHALL NOT 在內部斷行

#### Scenario: 下架文章沒有作者

- **WHEN** 下架文章沒有 `author`
- **THEN** 卡片第二行 SHALL 只顯示網域

### Requirement: 下架文章 SHALL 從所有公開列表與機器輸出移除

下架文章 SHALL NOT 出現在首頁、系列列表、tags 與 tags 索引、Level-Up 列表、閱讀紀錄、glossary 的文章連結、相關文章、系列導覽與上下篇導覽、RSS、JSON feed、搜尋索引、sitemap、`/api/posts/{slug}.json` 與 Markdown 匯出。

Production build SHALL 驗證：未下架文章在 HTML、JSON API 與 Markdown 三種輸出的繁中與英文 slug 集合一致；下架文章只以帶墓碑 marker 的 HTML 存在，SHALL NOT 有 JSON 或 Markdown。Build SHALL 另外檢查下架文章的網址沒有出現在 sitemap、RSS、搜尋索引與 JSON feed，且下架文章的 HTML 沒有文章正文。任一條件不符時 build SHALL 以非 0 結束並阻止部署。

#### Scenario: 列表與導覽排除下架文章

- **WHEN** 首頁、系列頁、tags、Level-Up、閱讀紀錄、glossary 或文章底部導覽列出文章
- **THEN** 下架文章 SHALL NOT 出現

#### Scenario: Feed、索引與 sitemap 排除下架文章

- **WHEN** build 產生 RSS、JSON feed、搜尋索引與 sitemap
- **THEN** 其中 SHALL NOT 有任何下架文章的項目或網址

#### Scenario: 三種輸出的 slug 集合

- **GIVEN** 語料有未下架文章集合 L 與下架文章集合 T
- **WHEN** production build 完成
- **THEN** HTML 的 slug 集合 SHALL 等於 L 與 T 的聯集
- **AND** JSON API 與 Markdown 的 slug 集合 SHALL 都等於 L
- **AND** T 的每個 HTML SHALL 帶墓碑 marker，L 的每個 HTML SHALL 帶一般文章 marker

#### Scenario: 下架文章漏進輸出

- **WHEN** 任一下架文章的網址出現在 sitemap、RSS、搜尋索引或 JSON feed，或它有 JSON 或 Markdown artifact，或它的 HTML 含文章正文
- **THEN** build SHALL 失敗
- **AND** 診斷 SHALL 指出文章與出口

### Requirement: 下架轉換 SHALL 不需要 Tribunal，自動化 SHALL 跳過下架文章

把文章改成 `taken-down` SHALL NOT 需要 Tribunal 評分。Score floor 與其他以讀者可見內容變更為觸發條件的內容 gates SHALL 跳過下架文章；frontmatter 驗證與 emoji 檢查 SHALL 仍適用下架文章會顯示的欄位。Tribunal 的候選選取 SHALL 只挑未下架文章，寫手與 publisher SHALL NOT 把正文寫回下架文章。以既有文章當語料的工具，包括 dedup、交叉連結與相關文章建議，SHALL 把下架文章視為不存在。

#### Scenario: 下架 commit 沒有分數

- **WHEN** 一個 commit 把文章改成 `taken-down` 並移除 `scores`
- **THEN** pre-commit 與 CI 的內容 gates SHALL 放行
- **AND** frontmatter 驗證 SHALL 仍檢查墓碑欄位

#### Scenario: Tribunal 挑選文章

- **WHEN** Tribunal batch 或常駐 loop 列出待評文章
- **THEN** 下架文章 SHALL NOT 被選中

#### Scenario: 自動化寫回下架文章

- **WHEN** 任何自動化變更在下架文章寫入正文或分數
- **THEN** 驗證 SHALL 失敗並阻止該變更進 main

#### Scenario: 語料工具比對既有文章

- **WHEN** dedup 或交叉連結工具比對既有文章
- **THEN** 下架文章 SHALL NOT 被當成既有覆蓋
- **AND** SHALL NOT 被建議成連結目標

### Requirement: 下架批次 SHALL 依可重算的規則與 owner 授權執行

每一批下架 SHALL 有 owner 的明確授權紀錄，授權可以逐篇，也可以是規則。每一批 SHALL 在 repo 內留下清單，記錄授權人、日期、管道與範圍，規則本身，每篇的 ticketId、slug、標題與 `sourceUrl`，以及判斷後不下架的邊界案例與理由。依規則產生的批次 SHALL 在執行前以同一規則對目前語料重算；結果與清單不一致時 SHALL 停止，先收斂差異。判斷不確定的文章 SHALL NOT 列入依規則下架的批次。

本次翻譯下架批次的規則 SHALL 是：所有 GP 文章，繁中與英文都下架；以及 `sourceUrl` 的 hostname 轉小寫、去掉開頭 `www.` 後，等於付費新聞媒體網域清單中某個網域或其子網域的 MP 文章。網域清單 SHALL 只收以新聞為主業、一般文章預設在訂閱或計量付費牆後的媒體，判斷 SHALL 只看 `sourceUrl`。

#### Scenario: 執行前對帳

- **WHEN** 準備套用一份依規則產生的下架清單
- **THEN** 工具 SHALL 用清單記錄的規則對目前語料重算
- **AND** 有多出或缺少的文章時 SHALL 失敗並列出差異

#### Scenario: MP 邊界案例

- **WHEN** 一篇 MP 的付費媒體只出現在 `source` 欄，或它的來源是付費狀態不確定的新聞網站、付費電子報或學術期刊
- **THEN** 它 SHALL NOT 列入本次下架
- **AND** 清單 SHALL 記錄這篇與理由

#### Scenario: 沒有授權紀錄

- **WHEN** 一批下架沒有 owner 的授權紀錄
- **THEN** 該批 SHALL NOT 執行

### Requirement: 公開 repo 的 HEAD SHALL NOT 保留下架譯文與未授權的第三方原文全文

下架文章的正文 SHALL 從 HEAD 移除。Repo SHALL NOT 在 HEAD 保存沒有授權可再散布的第三方文章原文全文擷取或整篇譯文，測試資料也一樣；需要長期保存的第三方原文 SHALL 放在 repo 外。ShroomDog 本人的對話紀錄 MAY 保留。只被下架文章使用的文章圖檔 SHALL 一併移除。改寫 git 歷史不在本要求範圍內。

#### Scenario: 測試需要來源與譯文 fixture

- **WHEN** 測試需要一組來源與譯文 fixture
- **THEN** fixture SHALL 是自寫的合成內容
- **AND** SHALL NOT 是第三方文章原文或 gu-log 已下架的譯文

#### Scenario: Agent 擷取第三方原文

- **WHEN** agent 為寫作或查證擷取第三方原文
- **THEN** 擷取結果 SHALL 留在 repo 外
- **AND** SHALL NOT commit 進 `sources/` 或其他追蹤路徑

#### Scenario: 下架後沒人用的圖檔

- **WHEN** 下架讓某些文章圖檔不再被任何文章引用
- **THEN** 這些圖檔 SHALL 從 HEAD 移除
