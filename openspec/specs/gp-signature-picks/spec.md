# gp-signature-picks Specification

## Purpose
定義 GP（Gu-log Picks）這個招牌系列：誰能指定 GP、怎麼由已上線的 MP 升格、升格要過的 publish bar、`scripts/reclassify-post.mjs` 怎麼搬檔、怎麼擋下沒過 publish bar 就變成 GP 的檔案，以及列表與首頁怎麼呈現。GP 的寫作與 grounding 規則跟 MP 相同，以 `editorial-charter` 為準；gp-pipeline 不撰寫 GP，見 `gp-pipeline-publish-integrity`。

## Requirements

### Requirement: GP MUST 是 ShroomDog 指定的招牌文章，寫作與 grounding 規則同 MP

GP 是 ShroomDog 親自指定、代表 gu-log 品質的招牌文章。升格不改變內容契約：GP 就是遵守 MP 契約的文章，正文 SHALL 遵守 `editorial-charter` 的「MP body MUST be Mogu-authored and source-grounded」與「MP grounding MUST preserve claim closure and attribution」，「沒有來源作者同意的整篇翻譯 MUST NOT 公開」也一體適用。GP SHALL NOT 有自己的寫作格式、導讀結構或來源距離門檻。Tribunal SHALL 用 MP 的評分規則評 GP，只評分、不改寫（`gp-source-preservation`）。

#### Scenario: 升格不必重寫正文

- **WHEN** 一篇 MP 升格成 GP
- **THEN** 正文 SHALL NOT 為此改寫
- **AND** writer 與 reviewer SHALL NOT 要求補上導讀式開頭或帶讀者回原文的結尾

#### Scenario: Tribunal 評 GP

- **WHEN** Tribunal 評一篇 GP
- **THEN** 評審 SHALL 套用 MP 的評分規則，SHALL NOT 以翻譯完整度、來源順序或原作者聲音評分
- **AND** SHALL NOT 改寫正文

### Requirement: 只有 ShroomDog 明確指定才算 GP

文章 SHALL 只在 ShroomDog 明確指定「這篇是 GP」後，透過 `scripts/reclassify-post.mjs` 成為 GP。Agent SHALL NOT 自行定 GP，也 SHALL NOT 在 URL intake、候選評估或寫作建議裡把 GP 當選項；有來源的文章一律建議 MP（或依 `editorial-charter` 的分流建議 SD、Lv）。Agent MAY 說一句「可能夠格當招牌」，但 SHALL 照 MP 寫，由 ShroomDog 決定。

#### Scenario: URL intake 的系列建議

- **WHEN** agent 在 URL intake 或候選評估建議收錄一份來源
- **THEN** 建議的系列 SHALL 是 MP、SD 或 Lv，SHALL NOT 是 GP

#### Scenario: agent 覺得文章特別好

- **WHEN** agent 認為一篇來源或草稿品質特別高
- **THEN** agent MAY 說「可能夠格當招牌」
- **AND** 文章與 ticket SHALL 仍是 MP

### Requirement: GP MUST 由已上線的 MP 升格而來

每篇新的 GP SHALL 是已上線的 MP，在 ShroomDog 指定後用 `scripts/reclassify-post.mjs` 升格：配新的 GP 號，舊的 MP 網址轉到新網址。SHALL NOT 有上線前就是 GP 的草稿（`GP-PENDING`），GP 號 SHALL NOT 由其他配號路徑配出（`scripts/allocate-ticket.mjs`、gp-pipeline 的 `counter`、`deploy`）。升格當下文章 SHALL 通過 publish bar（`publish-bar-visibility`，實作是 `src/utils/tribunal-scores.ts` 的 `meetsPublishBar`）。publish bar 是升格門檻，不是持續條件：升格後重評沒過 SHALL NOT 擋下 commit、SHALL NOT 讓 GP 下線，只依 `publish-bar-visibility` 不上首頁。

#### Scenario: 上線前就說要當 GP

- **WHEN** ShroomDog 在文章上線前就說它要當 GP
- **THEN** 文章 SHALL 照 MP 流程寫完、以 MP 上線，通過 publish bar 後再升格
- **AND** SHALL NOT 產生 `GP-PENDING` 草稿

#### Scenario: 升格後重評沒過

- **GIVEN** 一篇已升格的 GP
- **WHEN** 之後重跑 Tribunal 有評審沒過，分數寫回 frontmatter
- **THEN** pre-commit 與 CI SHALL NOT 因為它是 GP 而擋下這個 commit
- **AND** 它 SHALL 留在原本的 GP 網址，首頁依 `publish-bar-visibility` 不放它

### Requirement: 新變成 GP 的檔案 SHALL 在 pre-commit 與 CI 通過 publish bar

Pre-commit 與 CI SHALL 用同一支檢查比較基準版本與新版本：新版本是 GP、而基準版本沒有這個檔或它不是 GP 的文章檔（新增、改名或改了 `ticketId`），分數 SHALL 通過 `meetsPublishBar`，否則失敗；`GP-PENDING` 的檔案一律失敗。基準版本已經是 GP 的檔案（例如只寫回分數、下架）SHALL NOT 被這條檢查。取不到基準版本時 SHALL 失敗，不得當成通過。

#### Scenario: 升格的文章沒過 publish bar

- **WHEN** 一個變更把 MP 改成 GP（含 `git mv` 改名），而新的 GP 檔沒通過 `meetsPublishBar`
- **THEN** pre-commit 與 CI SHALL 失敗，並指出檔案

#### Scenario: 升格的文章通過 publish bar

- **WHEN** 一個變更把通過 `meetsPublishBar` 的 MP 改成 GP
- **THEN** 這條檢查 SHALL NOT 失敗

#### Scenario: 既有 GP 寫回較低的分數

- **GIVEN** 一個檔案在基準版本已經是 GP
- **WHEN** 變更只改了它的分數，而新分數沒通過 `meetsPublishBar`
- **THEN** 這條檢查 SHALL NOT 失敗

#### Scenario: 新增 GP-PENDING 檔

- **WHEN** 一個變更新增 `gp-pending-` 或 `en-gp-pending-` 檔
- **THEN** pre-commit 與 CI SHALL 失敗

### Requirement: GP 列表 SHALL 只列公開的招牌文章，首頁沒有能放的 GP 時不顯示 GP 區

GP 系列頁（`/gu-log-picks`、`/en/gu-log-picks`）與首頁的 GP 區 SHALL 只列公開的 GP，排除下架墓碑與示範文 GP-1。首頁 SHALL 只在至少有一篇過 publish bar、能上首頁的 GP 時輸出 GP 區，最多放最新的 3 篇；一篇都沒有時，首頁 SHALL NOT 輸出 GP 區。GP 系列頁 SHALL 一律回 200，沒有可列的 GP 時顯示中性的空狀態。

#### Scenario: 讀者開啟 GP 系列頁

- **WHEN** 讀者開啟 `/gu-log-picks` 或 `/en/gu-log-picks`
- **THEN** 頁面 SHALL 回 200，只列公開的 GP，SHALL NOT 列出墓碑或 GP-1

#### Scenario: GP 系列頁沒有可列的文章

- **WHEN** 沒有可列的 GP，讀者開啟 GP 系列頁
- **THEN** 繁中頁 SHALL 顯示「還沒有招牌文章。」，英文頁 SHALL 顯示 "No signature picks yet."
- **AND** 頁面 SHALL NOT 宣稱 GP 暫停或改版中

#### Scenario: 首頁沒有能放的 GP

- **WHEN** 沒有任何過 publish bar、能上首頁的 GP，讀者開啟繁中或英文首頁
- **THEN** 首頁 SHALL NOT 輸出 GP 區的標題、副標、空狀態或「查看全部」
- **AND** 其他系列的區塊 SHALL 照常顯示

#### Scenario: 首頁有能放的 GP

- **WHEN** 至少有一篇過 publish bar、能上首頁的 GP
- **THEN** 首頁 SHALL 顯示 GP 區，最多放最新的 3 篇

### Requirement: 改系列 SHALL 只用一支指令，兩種語言一起搬

已上線的文章在 GP 與 MP 之間移動 SHALL 使用 `scripts/reclassify-post.mjs <ticketId> <GP|MP>`。跑一次 SHALL 取目標系列 counter 的 next 號並推進、既有的語言檔一起搬、每個舊的公開網址在 `brand-taxonomy` 的遷移清單加一筆、舊別名與 repo 內的連結改指新文章，最後跑 `scripts/validate-posts.mjs`。

#### Scenario: 已上線的 GP 改回 MP

- **GIVEN** `GP-N` 有繁中與英文檔，MP counter 的 next 是 `M`
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs GP-N MP`
- **THEN** 兩個檔 SHALL 都是 `MP-M`，檔名與 slug 改成 `mp-M-`／`en-mp-M-` 開頭，日期與標題 slug 不變
- **AND** MP counter 的 next SHALL 變成 `M + 1`，GP counter SHALL 不變
- **AND** `quality/brand-taxonomy-post-migration.json` SHALL 每個語言多一筆舊 slug 到新 slug 的項目，摘要計數照舊由項目算出

#### Scenario: 已上線的 MP 升格成 GP

- **GIVEN** `MP-N` 通過 `meetsPublishBar`，ShroomDog 指定它是 GP
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs MP-N GP`
- **THEN** 這篇 SHALL 取 GP counter 的 next 號，GP counter SHALL 推進
- **AND** 舊的 MP 網址 SHALL 以 HTTP 308 轉到新的 GP 網址

#### Scenario: 只有一個語言檔

- **GIVEN** 一個 GP／MP ticket 只有繁中檔
- **WHEN** 它被改系列
- **THEN** SHALL 只搬這個檔、只替它的網址加遷移項目，SHALL NOT 產生英文檔

#### Scenario: 舊別名直接指向新文章

- **GIVEN** 遷移清單已有一筆 `newSlug` 是這篇目前 slug 的項目（例如 SP 時代的別名）
- **WHEN** 這篇被改系列
- **THEN** 那筆項目 SHALL 直接指向新的 slug，轉址 SHALL NOT 先經過被撤下的 slug

#### Scenario: repo 內的連結跟著搬

- **GIVEN** 其他文章或 repo 內的頁面連到被改系列的文章
- **WHEN** 指令執行
- **THEN** 連結 SHALL 改指對應語言的新網址，讀者看得到的 ticket 標籤 SHALL 顯示新 ticket

#### Scenario: 搬完驗證失敗

- **WHEN** 最後的 `scripts/validate-posts.mjs` 失敗
- **THEN** 指令 SHALL 以非 0 結束並印出 validator 的輸出

### Requirement: 改系列 SHALL 在動手前拒絕不合法的移動

`scripts/reclassify-post.mjs` SHALL 先檢查輸入，下列情況 SHALL 以非 0 結束、什麼都不改：目標不存在、不是 GP 或 MP、還沒上線（`PENDING`）、已下架、已在目標系列，或移到 GP 卻沒通過 `meetsPublishBar`。publish bar 只是升格門檻：GP 改回 MP 不需要通過。

#### Scenario: 沒過 publish bar 的升格

- **GIVEN** `MP-N` 缺少某位評審的分數，或有評審沒過
- **WHEN** 操作者要把它移到 GP
- **THEN** 指令 SHALL 在改任何檔案、counter 或遷移清單之前以非 0 結束
- **AND** 訊息 SHALL 說明要先通過 publish bar 才能成為 GP

#### Scenario: 已下架的文章

- **GIVEN** `GP-N` 是 `status: taken-down`
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs GP-N MP`
- **THEN** 指令 SHALL 以非 0 結束、什麼都不改，墓碑網址 SHALL 留在原處

#### Scenario: 不在範圍的 ticket

- **WHEN** ticket 是 SD 或 Lv、是 `MP-PENDING` 或 `GP-PENDING`、不存在，或已經在目標系列
- **THEN** 指令 SHALL 以非 0 結束、什麼都不改

#### Scenario: 沒過 publish bar 的 GP 改回 MP

- **GIVEN** 一篇已上線的 GP，之後的 Tribunal 分數沒過 publish bar
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs GP-N MP`
- **THEN** 指令 SHALL NOT 因為沒過 publish bar 而拒絕
