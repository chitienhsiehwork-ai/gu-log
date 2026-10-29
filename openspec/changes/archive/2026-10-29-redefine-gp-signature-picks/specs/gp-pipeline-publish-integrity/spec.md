## RENAMED Requirements

- FROM: `### Requirement: gp-pipeline SHALL NOT 撰寫或改寫 Lv，也 SHALL NOT 替 Lv 蓋 pipeline 署名`
- TO: `### Requirement: gp-pipeline SHALL NOT 撰寫或改寫 Lv 與 GP，也 SHALL NOT 替 Lv 蓋 pipeline 署名`
- FROM: `### Requirement: 拒絕 Lv SHALL 發生在任何副作用之前，並指向 Lv 寫作流程`
- TO: `### Requirement: 拒絕 Lv 與 GP SHALL 發生在任何副作用之前，並依系列指路`
- FROM: `### Requirement: Lv SHALL 仍可使用 pipeline 的非寫作步驟`
- TO: `### Requirement: Lv 與 GP SHALL 仍可使用 pipeline 的非寫作步驟，GP 配號除外`
- FROM: `### Requirement: 寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv`
- TO: `### Requirement: 寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv 或 GP`

## MODIFIED Requirements

### Requirement: gp-pipeline SHALL NOT 撰寫或改寫 Lv 與 GP，也 SHALL NOT 替 Lv 蓋 pipeline 署名

pipeline 不撰寫的系列是 Lv 與 GP（GP 只能由已上線的 MP 升格，見 `gp-signature-picks`）。會撰寫或改寫正文的入口遇到 Lv 或 GP，以及會把 pipeline 署名（`translatedBy.pipeline`、`pipelineUrl`）寫進 Lv 的入口遇到 Lv 時，SHALL 以 exit code 1 失敗，SHALL NOT 改用其他系列繼續執行。這些入口是：`run` 處理 Lv 或 GP（含工作目錄裡會被沿用的草稿），除非是 `run --file <Lv 或 GP 檔>` 從 `translate` 或 `deploy` 恢復；`write --prefix Lv|GP`；`review`、`refine` 的 `--ticket-id` 或草稿 frontmatter 的 `ticketId` 是 Lv 或 GP；`ralph` 的目標檔是 Lv 或 GP 檔，`credits` 的目標檔是 Lv 檔。系列依檔名（含 `levelup-` 與 `en-` 前綴）或 frontmatter 的 `ticketId` 判斷。

#### Scenario: 以 Lv 檔從寫作或評審步驟恢復

- **WHEN** 操作者以 `run --file <lv-、levelup- 或 gp- 開頭的檔案>` 執行，沒有帶 `--from-step`，或 `--from-step` 是 `translate` 之前的任何步驟（例如 `write`、`refine`、`ralph`）
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型，目標檔 SHALL 維持不變

#### Scenario: 沒有 Lv 檔的 run

- **WHEN** 操作者執行 `gp-pipeline run --prefix Lv --from-step deploy`，沒有帶 `--file`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型

#### Scenario: 從放著 Lv 草稿的工作目錄恢復

- **WHEN** 操作者以 `run --work-dir <目錄>` 從 `write` 之後的步驟恢復（帶 `--file` 時只算 `translate` 之前的步驟），而目錄裡的 `draft-v1.mdx` 或 `final.mdx` 是 Lv 或 GP，不論 `--prefix` 或 `--file` 是哪個系列
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，工作目錄裡的檔案 SHALL 維持不變，也 SHALL NOT 產生新的文章檔

#### Scenario: 單步 write 寫 Lv

- **WHEN** 操作者執行 `gp-pipeline write --prefix Lv` 或 `--prefix GP`，帶 `--source <source-tweet.md>`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型，也 SHALL NOT 產生 `draft-v1.mdx`

#### Scenario: 單步 review 或 refine 處理 Lv 草稿

- **WHEN** 操作者以 `--ticket-id Lv-PENDING` 或 `GP-PENDING` 執行 `gp-pipeline review` 或 `refine`，或沒帶 `--ticket-id`，但草稿 frontmatter 的 `ticketId` 是其中之一
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，也 SHALL NOT 改動工作目錄裡的草稿

#### Scenario: 單步 ralph 或 credits 處理 Lv 檔

- **WHEN** 操作者以 Lv 或 GP 檔執行 `gp-pipeline ralph --file <檔名>`，或以 Lv 檔執行 `gp-pipeline credits --file <路徑>`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 執行 `scripts/tribunal.sh` 或 post-fixer，目標檔 SHALL 維持不變

#### Scenario: SD 不受影響

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix SD` 或 `--prefix MP`，或以 SD、MP 檔執行 `gp-pipeline ralph --file`
- **THEN** 這條要求 SHALL NOT 擋下這次執行，步驟與 exit code SHALL 維持原樣

### Requirement: 拒絕 Lv 與 GP SHALL 發生在任何副作用之前，並依系列指路

上一條要求的拒絕 SHALL 發生在建立工作目錄、外部工具與 provider 的 preflight（例如 yt-dlp）、抓取來源、模型呼叫、counter 異動與任何檔案寫入之前；`--dry-run` SHALL NOT 改變這個判斷。錯誤訊息 SHALL 依系列指路並列出仍可用的步驟：Lv 指向 `CONTRIBUTING.md` 的 Lv 寫作流程；GP 說明先用 `--prefix MP` 寫成 MP，上線後由 ShroomDog 指定、用 `scripts/reclassify-post.mjs` 升格。

#### Scenario: 用 run 從網址寫 Lv

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix Lv` 或 `--prefix GP`，有沒有帶 `--dry-run` 都一樣
- **THEN** 指令 SHALL 以 exit code 1 結束；Lv 的錯誤訊息 SHALL 指向 `CONTRIBUTING.md` 的 Lv 寫作流程，GP 的 SHALL 含 `--prefix MP`
- **AND** SHALL NOT 建立工作目錄、抓取來源或呼叫任何模型
- **AND** `scripts/article-counter.json` SHALL 維持不變

#### Scenario: 缺少 yt-dlp 時仍先擋 Lv

- **WHEN** 環境裡沒有 yt-dlp，操作者執行 `gp-pipeline run <YouTube 網址> --prefix Lv` 或 `--prefix GP`
- **THEN** 指令 SHALL 以 exit code 1 結束，而不是缺少 yt-dlp 的 exit code 10

### Requirement: Lv 與 GP SHALL 仍可使用 pipeline 的非寫作步驟，GP 配號除外

Lv 的 `counter`、`fetch`、`eval`、`dedup`、`translate`、standalone `deploy`，以及 `run --file <Lv 檔>` 從 `translate` 或 `deploy` 開始的恢復，SHALL 照常運作，行為與 exit code SHALL NOT 因上一條要求改變。GP 的 `dedup`、`translate`、`credits`，以及 `run --file <已配號的 GP 檔>` 從 `translate` 或 `deploy` 開始的恢復，SHALL 照常運作。GP 號只由 `scripts/reclassify-post.mjs` 配出：`counter bump --prefix GP` 與替 `GP-PENDING` 配號的 `deploy`（含 `run` 的 deploy 步驟）SHALL 在任何異動前以 exit code 1 拒絕。

#### Scenario: 手寫 Lv 通過 Tribunal 後產生英文版

- **WHEN** 操作者以 `run --file <既有 Lv 或 GP 檔> --from-step translate` 或 `translate --file <既有 Lv 或 GP 檔>` 執行
- **THEN** pipeline SHALL 依檔名判斷系列，並照既有流程產生英文 sidecar；GP 照 MP 的流程，SHALL NOT 跑 GP 專屬的逐字檢查

#### Scenario: 替手寫 Lv 配號

- **WHEN** 操作者執行 `gp-pipeline counter bump --prefix Lv`
- **THEN** 指令 SHALL 照常配出下一個 Lv 號碼

#### Scenario: pipeline 不配 GP 號

- **WHEN** 操作者執行 `gp-pipeline counter bump --prefix GP`，或 `deploy --active-file <gp-pending 檔>`
- **THEN** 指令 SHALL 以 exit code 1 結束，GP counter 與檔案 SHALL 維持不變

### Requirement: 寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv 或 GP

`write`、`review`、`refine` 的說明，`run`、`candidate` 與 root help 裡描述可撰寫系列的文字，以及 `run`、`write` 缺少 `--prefix` 時列出的可用系列，SHALL NOT 把 Lv 或 GP 列為 pipeline 可以撰寫的系列，也 SHALL NOT 描述 GP 專屬的步驟。`run --help` SHALL 說明 Lv 與 GP 檔只能從 `translate` 或 `deploy` 恢復、GP 由已上線的 MP 升格。`counter`、`dedup`、`deploy` 等非寫作指令的說明與錯誤訊息 SHALL 繼續列出 Lv；`counter`、`deploy` 的說明 SHALL 說明 GP 號只由 `scripts/reclassify-post.mjs` 配出。

#### Scenario: 查看 write 的說明

- **WHEN** 操作者執行 `gp-pipeline write --help`
- **THEN** `--prefix` 的說明 SHALL 只列出 MP、SD
- **AND** 說明 SHALL NOT 宣稱 `write` 可以撰寫 Lv 或 GP

#### Scenario: write 沒帶 prefix

- **WHEN** 操作者執行 `gp-pipeline write --source <檔案>`，沒有帶 `--prefix`
- **THEN** 指令 SHALL 以 exit code 1 結束，錯誤訊息列出的可用系列 SHALL 是 MP、SD，SHALL NOT 包含 Lv 或 GP

#### Scenario: 查看 counter 的說明

- **WHEN** 操作者執行 `gp-pipeline counter bump --help`
- **THEN** `--prefix` 的說明 SHALL 繼續列出 Lv

#### Scenario: 以退役的 source-distance 步驟恢復

- **WHEN** 操作者執行 `gp-pipeline run --from-step source-distance`
- **THEN** 指令 SHALL 以未知步驟的錯誤、exit code 1 結束，SHALL NOT 建立工作目錄或呼叫任何模型

## REMOVED Requirements

### Requirement: GP SHALL 以導讀流程產出並在發布前蓋章

**Reason**: GP 不再是導讀，而是 ShroomDog 指定、由已上線的 MP 升格的招牌文章（`gp-signature-picks`）；來源距離章也整個退役（`source-distance-stamp`）。pipeline 不再需要 GP 專屬的寫作 prompt、post-fixer 步驟、`source-distance` 步驟、只評分的 `ralph` 分支或英文逐字檢查。

**Migration**: 有來源的新文章一律用 `--prefix MP` 跑 pipeline，上線後由 ShroomDog 指定、用 `scripts/reclassify-post.mjs` 升格成 GP。pipeline 拒絕撰寫 GP、不配 GP 號，改由原本 Lv 的四條要求一併涵蓋（見上方 RENAMED）；`--from-step source-distance` 變成未知步驟。只對 GP 生效的 glossary 術語 context 跟著 GP 分支移除；擋下 `ShroomDogNote` 改成不分系列，見「寫作步驟 SHALL 拒絕含 `ShroomDogNote` 的模型輸出」。

## ADDED Requirements

### Requirement: 寫作步驟 SHALL 拒絕含 `ShroomDogNote` 的模型輸出

`write` 與 `refine`（含 `run` 裡的這兩步）的模型輸出使用或 import `ShroomDogNote` 時，不論系列，該步驟 SHALL 以 exit code 14 失敗。這份輸出 SHALL 移到旁邊留作證據，SHALL NOT 留在草稿的位置，之後的步驟與 `--from-step` 恢復都 SHALL NOT 拿它當草稿，也 SHALL NOT 寫進 `src/content/posts/`。`write` 與 `refine` 的 prompt SHALL 對每個系列說明不得寫 `ShroomDogNote`，`review` SHALL 把它列為 Blocker。

#### Scenario: MP 的 write 寫出 ShroomDogNote

- **WHEN** `gp-pipeline write --prefix MP` 的模型輸出含 `<ShroomDogNote>`
- **THEN** 指令 SHALL 以 exit code 14 結束
- **AND** 工作目錄 SHALL NOT 留下以這份輸出當內容的 `draft-v1.mdx`

#### Scenario: SD 的 refine 寫出 ShroomDogNote

- **WHEN** SD 草稿的 refine 輸出 import 了 `ShroomDogNote`
- **THEN** 該步驟 SHALL 以 exit code 14 失敗
- **AND** 這份輸出 SHALL NOT 成為 `final.mdx`，也 SHALL NOT 進到 `src/content/posts/`
