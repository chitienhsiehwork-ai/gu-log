## Purpose

定義 GP（Gu-log Picks）這個招牌系列：誰能指定 GP、怎麼由 MP 升格、升格要過的門檻、`scripts/reclassify-post.mjs` 怎麼搬檔、列表與首頁怎麼呈現，以及 gp-pipeline 為什麼不寫 GP。GP 的寫作與 grounding 規則跟 MP 相同，以 `editorial-charter` 為準。

## ADDED Requirements

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

### Requirement: GP MUST 由 MP 升格而來

每篇 GP SHALL 先照 MP 流程寫成 MP，ShroomDog 指定後用 `scripts/reclassify-post.mjs` 升格；升格當下 SHALL 已有 Tribunal PASS（判定以 `tribunal-scoring-dimensions` 為準）。還沒上線的改成 `GP-PENDING`，已上線的配新的 GP 號、舊網址轉到新網址，做法見本 spec 的改系列要求。PASS 是升格門檻，不是持續條件：升格後重評沒過 SHALL NOT 擋下 commit、SHALL NOT 讓 GP 下線，只依 `publish-bar-visibility` 不上首頁。

#### Scenario: 升格後重評沒過

- **GIVEN** 一篇已升格的 GP
- **WHEN** 之後重跑 Tribunal 有評審沒過，分數寫回 frontmatter
- **THEN** pre-commit 與 CI SHALL NOT 因為它是 GP 而擋下這個 commit
- **AND** 它 SHALL 留在原本的 GP 網址，首頁依 `publish-bar-visibility` 不放它

### Requirement: GP 列表 SHALL 只列公開的招牌文章，沒有時首頁不顯示 GP 區

GP 系列頁（`/gu-log-picks`、`/en/gu-log-picks`）與首頁的 GP 區 SHALL 只列公開的 GP，排除下架墓碑與示範文 GP-1。首頁有可列的 GP 時照舊放最新、過 publish bar 的前 3 篇；一篇都沒有時，首頁 SHALL NOT 輸出 GP 區。GP 系列頁 SHALL 一律回 200，沒有可列的 GP 時顯示中性的空狀態。

#### Scenario: 讀者開啟 GP 系列頁

- **WHEN** 讀者開啟 `/gu-log-picks` 或 `/en/gu-log-picks`
- **THEN** 頁面 SHALL 回 200，只列公開的 GP，SHALL NOT 列出墓碑或 GP-1

#### Scenario: GP 系列頁沒有可列的文章

- **WHEN** 沒有可列的 GP，讀者開啟 GP 系列頁
- **THEN** 繁中頁 SHALL 顯示「還沒有招牌文章。」，英文頁 SHALL 顯示 "No signature picks yet."
- **AND** 頁面 SHALL NOT 宣稱 GP 暫停或改版中

#### Scenario: 首頁沒有可列的 GP

- **WHEN** 沒有可列的 GP，讀者開啟繁中或英文首頁
- **THEN** 首頁 SHALL NOT 輸出 GP 區的標題、副標、空狀態或「查看全部」
- **AND** 其他系列的區塊 SHALL 照常顯示

#### Scenario: 首頁有可列的 GP

- **WHEN** 至少有一篇可列的 GP
- **THEN** 首頁 SHALL 顯示 GP 區，最多放最新、過 publish bar 的 3 篇

### Requirement: 改系列 SHALL 只用一支指令，兩種語言一起搬

文章在 GP 與 MP 之間移動 SHALL 使用 `scripts/reclassify-post.mjs <ticketId> <GP|MP>`。已上線的文章跑一次 SHALL 取目標系列 counter 的 next 號並推進、既有的語言檔一起搬、每個舊的公開網址在 `brand-taxonomy` 的遷移清單加一筆、舊別名與 repo 內的連結改指新文章，最後跑 `scripts/validate-posts.mjs`。

#### Scenario: 已上線的 GP 改回 MP

- **GIVEN** `GP-N` 有繁中與英文檔，MP counter 的 next 是 `M`
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs GP-N MP`
- **THEN** 兩個檔 SHALL 都是 `MP-M`，檔名與 slug 改成 `mp-M-`／`en-mp-M-` 開頭，日期與標題 slug 不變
- **AND** MP counter 的 next SHALL 變成 `M + 1`，GP counter SHALL 不變
- **AND** `quality/brand-taxonomy-post-migration.json` SHALL 每個語言多一筆舊 slug 到新 slug 的項目，摘要計數照舊由項目算出

#### Scenario: 已上線的 MP 升格成 GP

- **GIVEN** `MP-N` 的分數達到 Tribunal PASS，ShroomDog 指定它是 GP
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

### Requirement: 上線前的草稿 SHALL 用同一支指令換系列

還沒上線的 `MP-PENDING`／`GP-PENDING` 草稿，指令 SHALL 把每個既有語言檔改名成目標系列的 pending 開頭（日期與標題 slug 不變），`ticketId` 換成目標系列的 `PENDING`；SHALL NOT 配號、改 counter、寫遷移清單或改連結。同一個 pending ticket 有好幾篇草稿時，操作者 SHALL 指定繁中檔名。

#### Scenario: 上線前指定成 GP

- **GIVEN** `mp-pending-` 的繁中與英文草稿分數達到 Tribunal PASS，ShroomDog 指定它是 GP
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs MP-PENDING GP`
- **THEN** 兩個檔 SHALL 都是 `GP-PENDING`，檔名改成 `gp-pending-`／`en-gp-pending-` 開頭
- **AND** `scripts/article-counter.json` 與遷移清單 SHALL 不變，之後配號 SHALL 用 GP counter

#### Scenario: 好幾篇草稿共用 pending ticket

- **GIVEN** 有兩篇 `MP-PENDING` 草稿
- **WHEN** 操作者只給 `MP-PENDING`、沒給檔名
- **THEN** 指令 SHALL 以非 0 結束、什麼都不改，並要求改用繁中檔名

### Requirement: 改系列 SHALL 在動手前拒絕不合法的移動

`scripts/reclassify-post.mjs` SHALL 先檢查輸入，下列情況 SHALL 以非 0 結束、什麼都不改：目標不存在、不是 GP 或 MP、已下架、已在目標系列、pending ticket 有歧義，或移到 GP 卻沒有達到 Tribunal PASS 的分數（`tribunal-scoring-dimensions`）。PASS 只是升格門檻：GP 改回 MP 不需要 PASS。

#### Scenario: 沒有 PASS 的升格

- **GIVEN** `MP-N` 或 `MP-PENDING` 草稿缺少某位評審的分數，或有評審沒過
- **WHEN** 操作者要把它移到 GP
- **THEN** 指令 SHALL 在改任何檔案、counter 或遷移清單之前以非 0 結束
- **AND** 訊息 SHALL 說明要先有 Tribunal PASS 才能成為 GP

#### Scenario: 已下架的文章

- **GIVEN** `GP-N` 是 `status: taken-down`
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs GP-N MP`
- **THEN** 指令 SHALL 以非 0 結束、什麼都不改，墓碑網址 SHALL 留在原處

#### Scenario: 不在範圍的 ticket

- **WHEN** ticket 是 SD 或 Lv、不存在，或已經在目標系列
- **THEN** 指令 SHALL 以非 0 結束、什麼都不改

#### Scenario: 沒過 PASS 的 GP 改回 MP

- **GIVEN** 一篇已上線的 GP，之後的 Tribunal 分數沒過 PASS
- **WHEN** 操作者執行 `scripts/reclassify-post.mjs GP-N MP`
- **THEN** 指令 SHALL NOT 因為沒有 PASS 而拒絕

### Requirement: gp-pipeline SHALL NOT 撰寫、改寫或評審 GP

GP 只能由 MP 升格，所以 gp-pipeline 會撰寫、改寫或評審 GP 的入口遇到 GP 時 SHALL 以 exit code 1 失敗，SHALL NOT 改用其他系列繼續。這些入口是：`run` 處理 GP（含 `--prefix GP` 與工作目錄裡會被沿用的 GP 草稿），除非是 `run --file <GP 檔>` 從 `translate` 或 `deploy` 恢復；`write --prefix GP`；`review`、`refine` 的 `--ticket-id` 或草稿 frontmatter 的 `ticketId` 是 GP；`ralph` 的目標檔是 GP 檔，也就是檔名系列（含 `en-` 前綴）或 frontmatter 的 `ticketId` 是 GP。

#### Scenario: 用 run 從網址寫 GP

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix GP`，有沒有帶 `--dry-run` 都一樣
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄、抓取來源或呼叫任何模型，`scripts/article-counter.json` SHALL 不變

#### Scenario: 以 GP 檔從寫作或評審步驟恢復

- **WHEN** 操作者以 `run --file <gp- 開頭的檔案>` 執行，沒有帶 `--from-step`，或 `--from-step` 是 `translate` 之前的步驟
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型，GP 檔 SHALL 不變

#### Scenario: 從放著 GP 草稿的工作目錄恢復

- **WHEN** 操作者以 `run --work-dir <目錄>` 從 `write` 之後的步驟恢復（帶 `--file` 時只算 `translate` 之前的步驟），而目錄裡的 `draft-v1.mdx` 或 `final.mdx` 是 GP，不論 `--prefix` 或 `--file` 是哪個系列
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，工作目錄裡的檔案 SHALL 不變，也 SHALL NOT 產生新的文章檔

#### Scenario: 單步 write、review 或 refine 處理 GP

- **WHEN** 操作者執行 `gp-pipeline write --prefix GP --source <檔案>`，或 `review`、`refine` 的 `--ticket-id` 是 `GP-PENDING`，或沒帶 `--ticket-id` 但草稿的 `ticketId` 是 `GP-PENDING`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，也 SHALL NOT 產生或改動工作目錄裡的草稿

#### Scenario: 單步 ralph 處理 GP 檔

- **WHEN** 操作者以 GP 檔執行 `gp-pipeline ralph --file <檔名>`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 執行 `scripts/tribunal.sh` 或 post-fixer，目標檔 SHALL 不變

#### Scenario: MP 與 SD 不受影響

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix MP` 或 `--prefix SD`，或以 MP、SD 檔執行 `gp-pipeline ralph --file`
- **THEN** 這條要求 SHALL NOT 擋下這次執行，步驟與 exit code SHALL 維持原樣

### Requirement: 拒絕 GP SHALL 發生在任何副作用之前，並指向先寫 MP

上一條要求的拒絕 SHALL 發生在建立工作目錄、外部工具與 provider 的 preflight（例如 yt-dlp）、抓取來源、模型呼叫、counter 異動與任何檔案寫入之前；`--dry-run` SHALL NOT 改變這個判斷。錯誤訊息 SHALL 說明 pipeline 不直接寫 GP：先用 `--prefix MP` 寫成 MP，GP 只能在 ShroomDog 指定後由 MP 升格；並列出 GP 仍可用的步驟。

#### Scenario: 錯誤訊息指向 MP

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix GP`
- **THEN** 錯誤訊息 SHALL 含 `--prefix MP`，並說明 GP 由 ShroomDog 指定後從 MP 升格

#### Scenario: 缺少 yt-dlp 時仍先擋 GP

- **WHEN** 環境裡沒有 yt-dlp，操作者執行 `gp-pipeline run <YouTube 網址> --prefix GP`
- **THEN** 指令 SHALL 以 exit code 1 結束，而不是缺少 yt-dlp 的 exit code 10

### Requirement: GP SHALL 仍可使用 pipeline 的非寫作步驟

GP 的 `counter`、`fetch`、`eval`、`dedup`、`translate`、`credits`、standalone `deploy`，以及 `run --file <GP 檔>` 從 `translate` 或 `deploy` 開始的恢復，SHALL 照常運作，行為與 exit code SHALL NOT 因上面的拒絕而改變。已改成 `GP-PENDING` 的文章 SHALL 能用這些步驟從 GP counter 配號並發布。

#### Scenario: 上線前指定的 GP 配號

- **GIVEN** 繁中與英文草稿已用 `scripts/reclassify-post.mjs` 改成 `gp-pending-` 檔
- **WHEN** 操作者執行 standalone `deploy --active-file <gp-pending 檔>`，或 `run --file <gp-pending 檔> --from-step deploy`
- **THEN** pipeline SHALL 從 GP counter 配號並改名，MP counter SHALL 不變

#### Scenario: 替 GP 檔補英文版

- **WHEN** 操作者執行 `translate --file <既有 GP 檔>` 或 `run --file <既有 GP 檔> --from-step translate`
- **THEN** pipeline SHALL 照 MP 相同的翻譯流程產生英文 sidecar
- **AND** SHALL NOT 對英文版跑 GP 專屬的逐字檢查

### Requirement: 寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 GP

`write`、`review`、`refine` 的說明，`run`、`candidate` 與 root help 裡描述可撰寫系列的文字，以及 `run`、`write` 缺少 `--prefix` 時列出的可用系列，SHALL NOT 把 GP 列為 pipeline 可以撰寫的系列，也 SHALL NOT 描述 GP 專屬的步驟。`run --help` SHALL 說明 GP 由 MP 升格、GP 檔只能從 `translate` 或 `deploy` 恢復。`counter`、`dedup`、`deploy` 等非寫作指令的說明 SHALL 繼續列出 GP。

#### Scenario: 查看 run 的說明

- **WHEN** 操作者執行 `gp-pipeline run --help`
- **THEN** 說明 SHALL NOT 列出 `post-fixer` 或 `source-distance` 這類 GP 專屬步驟，也 SHALL NOT 把 GP 描述成導讀
- **AND** SHALL 說明 GP 由 MP 升格、GP 檔只能從 `translate` 或 `deploy` 恢復

#### Scenario: 以退役的 source-distance 步驟恢復

- **WHEN** 操作者執行 `gp-pipeline run --from-step source-distance`
- **THEN** 指令 SHALL 以未知步驟的錯誤、exit code 1 結束，SHALL NOT 建立工作目錄或呼叫任何模型

#### Scenario: 非寫作指令繼續列出 GP

- **WHEN** 操作者執行 `gp-pipeline counter bump --help` 或 `gp-pipeline deploy --help`
- **THEN** 說明列出的系列 SHALL 繼續包含 GP
