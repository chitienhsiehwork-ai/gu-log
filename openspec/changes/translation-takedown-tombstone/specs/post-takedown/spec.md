## Purpose

定義已發布文章的「下架」契約：以 `taken-down` 狀態保留網址並顯示墓碑頁，讓 HTML、JSON 與 Markdown 三種輸出只剩墓碑內容、從所有公開列表與機器輸出移除，並規範 CI 棘輪、自動化的處理、下架批次的規則與授權紀錄，以及公開 repo 不留譯文與未授權的第三方原文全文。

## ADDED Requirements

### Requirement: 下架 SHALL 是保留原欄位、清空正文的文章狀態

文章 frontmatter 的 `status` SHALL 支援 `taken-down`，代表文章已下架。下架時 SHALL 保留原本的 frontmatter 欄位，只做以下改變：`status` 改成 `taken-down`；加上 `YYYY-MM-DD` 格式的 `takenDownAt`；沒有 `sourceTitle` 時補上來源自己的標題（來源沒有標題、或抓不到標題時，可用來源開頭一句或 `source`，但 SHALL NOT 使用 gu-log 自己的文章標題）；沒有 `author` 時可補上來源標示的作者或機構，查不到或不確定就不補，SHALL NOT 用猜的；`summary` 換成對應系列與語言的中性句；移除與新狀態不相容的 `deprecatedBy`、`deprecatedReason`、`retiredReason`、`retiredAt`；正文清空，只允許空白字元。

同一 `ticketId` 的繁中檔與英文檔 SHALL 一起下架，並 SHALL 使用相同的 `takenDownAt`、`sourceUrl` 與 `sourceTitle`。

`deprecated` 與 `retired` SHALL 維持「文章仍公開全文、加上狀態標籤」的既有語意；任何工具 SHALL NOT 把它們當成下架。

#### Scenario: 下架文章留有正文

- **WHEN** 一篇 `status: taken-down` 的文章在 frontmatter 之後還有任何非空白內容，包含 `import` 行
- **THEN** 驗證 SHALL 失敗
- **AND** pre-commit 與 CI SHALL 得到相同結果

#### Scenario: 下架文章的摘要不是中性句

- **WHEN** 一篇 `status: taken-down` 的文章，`summary` 不是它的系列與語言對應的中性句
- **THEN** 驗證 SHALL 失敗

#### Scenario: 下架文章缺少下架資料

- **WHEN** 一篇 `status: taken-down` 的文章缺少 `takenDownAt` 或 `sourceTitle`，或 `sourceTitle` 等於它的 `title`
- **THEN** 驗證 SHALL 失敗

#### Scenario: 翻譯配對只下架一邊

- **WHEN** 同一 `ticketId` 的繁中檔是 `taken-down`，英文檔不是，或兩邊的 `takenDownAt` 不同
- **THEN** 驗證 SHALL 失敗

#### Scenario: 貼標籤不等於下架

- **WHEN** 一篇文章是 `retired` 或 `deprecated`
- **THEN** 文章頁 SHALL 依既有規則顯示全文與狀態標籤
- **AND** 列表、API、Markdown 與下架檢查 SHALL NOT 把它視為已下架

### Requirement: 下架文章的網址 SHALL 保留並顯示不被索引的墓碑頁

下架文章的繁中 `/posts/{slug}` 與英文 `/en/posts/{slug}` SHALL 保留，回應 HTTP 200，正文是該篇的墓碑頁 HTML，`<head>` SHALL 帶 `<meta name="robots" content="noindex">`。墓碑頁 SHALL NOT 包含文章正文或譯文，也 SHALL NOT 出現在 sitemap。實作 SHALL NOT 為每篇下架文章新增平台轉址、改寫或標頭規則。

下架文章 SHALL 在 HTML、JSON API 與 Markdown 三種輸出都保留 slug，讓三者的 slug 集合照舊一致，但內容只剩墓碑：JSON SHALL 維持既有 v2 欄位，`body` 為空字串、`headings` 為空陣列、`summary` 為中性句；Markdown SHALL 是簡短的墓碑內容與來源連結。

#### Scenario: 讀者開啟下架文章

- **WHEN** 讀者以 GET 請求下架文章的繁中或英文正式網址
- **THEN** 回應 SHALL 是 HTTP 200 的墓碑頁
- **AND** `<head>` SHALL 帶 `<meta name="robots" content="noindex">`
- **AND** 頁面 SHALL NOT 含任何原本的正文

#### Scenario: 用戶端請求下架文章的 JSON

- **WHEN** 用戶端請求下架文章的 `/api/posts/{slug}.json`
- **THEN** 回應 SHALL 維持 v2 的欄位集合
- **AND** `body` SHALL 是空字串，`headings` SHALL 是空陣列，`summary` SHALL 是中性句

#### Scenario: 用戶端請求下架文章的 Markdown

- **WHEN** 用戶端請求下架文章的 `.md`，或對正式網址送出讓 Markdown 勝出的 `Accept`
- **THEN** 回應 SHALL 成功回傳墓碑 Markdown
- **AND** 其中 SHALL 有來源連結，SHALL NOT 有任何原本的正文

#### Scenario: 舊網址轉到下架文章

- **GIVEN** 一條品牌遷移前的舊文章網址，依 `brand-taxonomy` 的遷移清單指向已下架文章
- **WHEN** 讀者請求那條舊網址
- **THEN** 回應 SHALL 是 HTTP 308，`Location` 是下架文章的正式網址
- **AND** 追下去 SHALL 得到 HTTP 200 的墓碑頁，沒有轉址迴圈

#### Scenario: 路由預算不隨下架增加

- **WHEN** 建置產生平台的標頭、轉址與改寫設定
- **THEN** 規則總數 SHALL NOT 因下架文章的數量增加

### Requirement: 墓碑頁 SHALL 呈現定稿內容

墓碑頁 SHALL 只包含：ticketId 與下架標籤、石碑、Mogu 對話框、去讀來源的卡片、回首頁連結，以及內容含文章標題的視覺隱藏 h1。石碑上 SHALL NOT 顯示文章標題。石碑日期 SHALL 是 `translatedDate` 到 `takenDownAt`，格式為 `YYYY.MM.DD – YYYY.MM.DD`。卡片 SHALL 連到 `sourceUrl`，第一行顯示 `sourceTitle`，第二行顯示「`author` · 網域」；網域是 `sourceUrl` 的 hostname 去掉開頭 `www.`，沒有 `author` 時第二行只顯示網域。對話框每一行句尾 SHALL NOT 加句號。

墓碑頁 SHALL NOT 輸出目錄、tags、已讀／分享／登入控制、相關文章、系列與上下篇導覽、版本資訊與修改歷史連結、留言、AI popup 或狀態 banner。`<title>` SHALL 標示已下架，meta description SHALL NOT 使用原本的摘要。石碑文字 SHALL 在深淺兩種主題使用同一個深色墨水色，並對石面達到 WCAG AA 對比。顏文字 SHALL 依站上的顏文字不斷行規則處理。

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
- **AND** 繁中對話框五行 SHALL 依序是「嗚嗚，這篇我寫得太貼近原文了 ಥ_ಥ」「結果才知道，這樣也要先經過作者同意」「可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))」「只好幫它立個小墓碑」「還好原文沒事，點下面去看原汁原味的吧！」
- **AND** 英文對話框五行 SHALL 依序是「Waaah, I wrote this one way too close to the source ಥ_ಥ」「Then I learned that needs the author's OK too」「But I'm way too introverted to ask ((( ；ﾟДﾟ)))」「So I gave it a little tombstone」「Good news: the original is alive and well. Go read it below!」
- **AND** 卡片標籤 SHALL 是「去讀來源 →」與「Read the source →」
- **AND** 視覺隱藏 h1 SHALL 是「<文章標題>（gu-log 改寫文章，已下架）」與「<title> (gu-log rewrite, taken down)」
- **AND** 標籤、對話框標題、頁尾與 `<title>` SHALL 與同語言的 GP 墓碑相同

#### Scenario: 墓碑不露出文章周邊

- **WHEN** 墓碑頁建置完成
- **THEN** HTML SHALL NOT 含文章正文容器、目錄、tags、版本歷史連結、留言、AI popup 與狀態 banner

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

下架文章 SHALL NOT 出現在首頁、系列列表、tags 與 tags 索引、Level-Up 列表、閱讀紀錄、glossary 的文章連結、相關文章、系列導覽與上下篇導覽、RSS、JSON feed、搜尋索引與 sitemap。在 RSS、JSON feed、搜尋索引與 sitemap 裡，「出現」指下架文章自己的項目；其他公開文章正文裡指向墓碑頁的連結不算，SHALL 保留。

Production build SHALL 驗證：sitemap、RSS、搜尋索引與 JSON feed 裡沒有下架文章的項目；下架文章的 JSON `body` 為空；Markdown 是墓碑內容；HTML 帶墓碑 marker 與 `noindex`、沒有文章正文容器。任一條件不符時 build SHALL 以非 0 結束並阻止部署。

#### Scenario: 列表與導覽排除下架文章

- **WHEN** 首頁、系列頁、tags、Level-Up、閱讀紀錄、glossary 或文章底部導覽列出文章
- **THEN** 下架文章 SHALL NOT 出現

#### Scenario: Feed、索引與 sitemap 排除下架文章

- **WHEN** build 產生 RSS、JSON feed、搜尋索引與 sitemap
- **THEN** 其中 SHALL NOT 有任何下架文章的項目

#### Scenario: 公開文章連到下架文章

- **WHEN** 一篇公開文章的正文連到下架文章的網址，而這段正文進了搜尋索引、RSS 或 JSON feed
- **THEN** build SHALL NOT 因為這條連結失敗
- **AND** 連結 SHALL 指向墓碑頁

#### Scenario: 下架文章漏進輸出

- **WHEN** sitemap、RSS、搜尋索引或 JSON feed 有任一下架文章的項目，或下架文章的 JSON 有正文，或它的 HTML 含文章正文容器
- **THEN** build SHALL 失敗
- **AND** 診斷 SHALL 指出文章與出口

### Requirement: 已下架的文章 SHALL 被 CI 棘輪鎖住

Pre-commit 與 CI SHALL 比較基準版本與新版本：基準版本已是 `taken-down` 的文章，新版本 SHALL 仍存在、仍是 `taken-down`，而且正文為空。新增文章的來源網址（正規化後的網址或推文 ID）與任一下架文章相同時，SHALL 視為來源已封鎖而失敗。`sources/` 底下新增 `sources/chatgpt/` 以外的檔案時 SHALL 失敗。

#### Scenario: 自動化把全文寫回下架文章

- **GIVEN** 一篇文章在基準版本是 `taken-down`
- **WHEN** 一個變更把它改回 `published`、寫入正文，或刪除它
- **THEN** pre-commit 與 CI SHALL 失敗

#### Scenario: 新文章使用已封鎖的來源

- **WHEN** 一個變更新增的文章，`sourceUrl` 與某篇下架文章相同
- **THEN** pre-commit 與 CI SHALL 失敗，並指出被封鎖的來源與下架文章

#### Scenario: 新增第三方原文擷取

- **WHEN** 一個變更在 `sources/` 底下新增 `sources/chatgpt/` 以外的檔案
- **THEN** pre-commit 與 CI SHALL 失敗

### Requirement: 自動化 SHALL 依狀態處理下架文章

把文章改成 `taken-down` SHALL NOT 需要 Tribunal 評分。Score floor 與其他以讀者可見內容變更為觸發條件的內容 gates SHALL 跳過下架文章；frontmatter 驗證與 emoji 檢查 SHALL 仍適用。Tribunal 的候選選取 SHALL 依 `status` 排除下架文章。Dedup SHALL 把下架文章視為來源已封鎖：新文章的來源與下架文章相同時 SHALL 被擋下；既有文章互比與主題相似度比對 SHALL NOT 把下架文章當成重複對象。

#### Scenario: 下架 commit 沒有分數

- **WHEN** 一個 commit 把文章改成 `taken-down`
- **THEN** pre-commit 與 CI 的內容 gates SHALL 放行
- **AND** frontmatter 驗證 SHALL 仍檢查下架欄位

#### Scenario: Tribunal 挑選文章

- **WHEN** Tribunal batch 或常駐 loop 列出待評文章
- **THEN** 下架文章 SHALL NOT 被選中

#### Scenario: 下架前是 deprecated 的文章

- **GIVEN** GP-35 下架前是 `deprecated`、`deprecatedBy` 指向 GP-105，兩篇都下架
- **WHEN** 既有文章的重複掃描執行
- **THEN** GP-35 與 GP-105 SHALL NOT 被判成重複

#### Scenario: Pipeline 用已下架的來源

- **WHEN** dedup gate 收到的候選網址與某篇下架文章相同
- **THEN** gate SHALL 回 BLOCK，並說明來源已封鎖

### Requirement: 下架批次 SHALL 依可重算的規則與 owner 授權執行

每一批下架 SHALL 有 owner 的明確授權紀錄，授權可以逐篇，也可以是規則。每一批 SHALL 在 repo 內留下規則檔，記錄授權人、日期、管道與範圍、規則本身，以及判斷後不下架的邊界案例與理由。下架清單 SHALL 由工具依規則從當下語料產生，不另存逐篇快照；清單中的 slug SHALL 使用正式網址的小寫形式。判斷不確定的文章 SHALL NOT 列入依規則下架的批次。

本次翻譯下架批次的規則 SHALL 是：所有 GP 文章，繁中與英文都下架，但自寫示範文 GP-1 除外；以及 `sourceUrl` 的 hostname 轉小寫、去掉開頭 `www.` 後，等於付費新聞媒體網域清單中某個網域或其子網域的 MP 文章。網域清單 SHALL 只收以新聞為主業、一般文章預設在訂閱或計量付費牆後的媒體，判斷 SHALL 只看 `sourceUrl`。

#### Scenario: 檔名含大寫

- **WHEN** 規則選中一篇檔名含大寫字母的文章，例如 GP-63 的 `gp-63-20260214-GP63-…`
- **THEN** 清單中的 slug SHALL 是小寫的正式網址 id

#### Scenario: MP 邊界案例

- **WHEN** 一篇 MP 的付費媒體只出現在 `source` 欄，或它的來源是付費狀態不確定的新聞網站、付費電子報或學術期刊
- **THEN** 它 SHALL NOT 列入本次下架
- **AND** 規則檔 SHALL 記錄這篇與理由

#### Scenario: 沒有授權紀錄

- **WHEN** 一批下架沒有 owner 的授權紀錄
- **THEN** 該批 SHALL NOT 執行

### Requirement: 公開 repo 的 HEAD SHALL NOT 保留下架譯文與未授權的第三方原文全文

下架文章的正文 SHALL 從 HEAD 移除。Repo SHALL NOT 在 HEAD 保存沒有授權可再散布的第三方文章或 prompt 全文擷取，或下架文章的整篇譯文；測試資料、fixture 與 `public/` 也一樣。需要長期保存的第三方原文 SHALL 放在 repo 外。ShroomDog 本人的對話紀錄 MAY 保留。只被下架文章使用的文章圖檔 SHALL 一併移除。改寫 git 歷史不在本要求範圍內。

#### Scenario: 測試需要來源與譯文 fixture

- **WHEN** 測試或 eval fixture 需要來源與譯文的內容
- **THEN** 內容 SHALL 是自寫的合成文字
- **AND** SHALL NOT 是第三方文章原文或 gu-log 已下架的譯文

#### Scenario: 正式站提供第三方 prompt 全文

- **WHEN** `public/` 底下有第三方 prompt 或文章的全文
- **THEN** 它 SHALL 被移除

#### Scenario: Agent 擷取第三方原文

- **WHEN** agent 為寫作或查證擷取第三方原文
- **THEN** 擷取結果 SHALL 留在 repo 外
- **AND** SHALL NOT commit 進 `sources/` 或其他追蹤路徑
