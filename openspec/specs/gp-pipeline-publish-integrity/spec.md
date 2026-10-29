# gp-pipeline-publish-integrity Specification

## Purpose

`gp-pipeline`（`tools/gp-pipeline/`）發佈與補救路徑（standalone deploy 的檔名建構、write→translate 的雙語契約、frontmatter 的 YAML 序列化、成功報告的產物證據）SHALL fail closed：不得產生格式錯誤的檔名、不實的 help text、無效 YAML frontmatter，或回報不存在的英文產物。

## Requirements

### Requirement: standalone deploy 缺檔名槽位 SHALL fail closed

`gp-pipeline deploy` SHALL 在 bump ticket counter、rename 任何檔案、或 commit/push 之前，驗證 `--date-stamp`（格式 `YYYYMMDD`）、`--author-slug`、`--title-slug` 三者皆非空。任一槽位缺漏或格式錯誤時，`deploy` SHALL 回傳描述性錯誤，且 SHALL NOT 修改 `scripts/article-counter.json`、rename 任何檔案、或產生 git commit。`deploy` SHALL NOT 嘗試從 pending 檔名反推這些槽位——pending 檔名格式（`<prefix>-pending-YYYYMMDD-<author>-<title>.mdx`）對 author/title 邊界本質上是 ambiguous 的，猜測式 derive 可能靜默產出格式正確但語意錯誤的檔名。

#### Scenario: standalone deploy 三個槽位全缺

- **WHEN** operator 執行 `gp-pipeline deploy --active-file mp-pending-20260717-x-y.mdx`，未帶 `--date-stamp`/`--author-slug`/`--title-slug`
- **THEN** 指令 SHALL 以非零 exit code 失敗，錯誤訊息 SHALL 指名缺少的 flag
- **AND** `scripts/article-counter.json` SHALL 維持不變
- **AND** `src/content/posts/` 下 SHALL NOT 有任何檔案被 rename 或建立

#### Scenario: standalone deploy 帶格式錯誤的 date-stamp

- **WHEN** operator 執行 `gp-pipeline deploy --active-file <pending>.mdx --date-stamp 2026-07-17 --author-slug x --title-slug y`（date-stamp 不是 `YYYYMMDD` 格式）
- **THEN** 指令 SHALL 在任何 counter bump 或檔案異動之前失敗

#### Scenario: run pipeline 不受影響

- **WHEN** 以 `--prefix MP` 執行的完整 `gp-pipeline run <url>` pipeline 執行到 deploy 步驟
- **THEN** deploy SHALL 一如既往成功，因為 `ralph.go` 一定會在 deploy 之前填好 `DateStamp`/`AuthorSlug`/`TitleSlug`

### Requirement: pipeline help text 與自動翻譯 SHALL 誠實一致

`gp-pipeline` 的 root help SHALL NOT 宣稱 `write` 產出 zh-tw + en MDX pair——它只產 zh-tw。SHALL 存在一個自動 `translate` 步驟，在 zh-tw 文章通過 tribunal（Ralph）之後產出 en sidecar，符合 CONTRIBUTING.md 的 zh-tw-first SOP。tribunal 未過分數時，`translate` SHALL 被跳過（記錄，非錯誤），pipeline SHALL 繼續以既有 best-effort 語意只 deploy zh-tw。

#### Scenario: run 通過 tribunal 時產出雙語

- **WHEN** `gp-pipeline run <url>` 完成 `ralph` 步驟且 `RalphPassed = true`
- **THEN** `translate` 步驟 SHALL 執行，在 `deploy` 之前於 `src/content/posts/` 產出 `en-` sidecar 檔案
- **AND** 該 en 檔案的 frontmatter SHALL 有 `lang: "en"`

#### Scenario: run 未過 tribunal 時只 deploy zh-tw

- **WHEN** `gp-pipeline run <url>` 完成 `ralph` 步驟且 `RalphPassed = false`
- **THEN** `translate` 步驟 SHALL 被跳過且不產生錯誤
- **AND** `deploy` SHALL 只以 zh-tw 檔案繼續（既有 best-effort 行為不變）

#### Scenario: standalone translate 用於補救

- **WHEN** operator 執行 `gp-pipeline translate --file <已在 src/content/posts/ 的既有 zh-tw 檔案>`
- **THEN** 指令 SHALL 用與 `write`/`refine` 相同的 writer LLM chain 產出對應的 `en-` sidecar

#### Scenario: help text 準確性

- **WHEN** operator 執行 `gp-pipeline --help`
- **THEN** `write` 那一行 SHALL NOT 宣稱產出 en MDX 檔案
- **AND** SHALL 有一行 `translate` 描述其真實行為（en sidecar，gate 在 tribunal 過分數）

### Requirement: frontmatter 自由文字純量 SHALL 永遠序列化成合法 YAML

不論上游 LLM writer 第一次寫稿時選了什麼引號策略，`source` frontmatter 純量 SHALL
在檔案落地 `src/content/posts/` 前（`ralph` frontmatter normalization 這一關）先以 YAML
解析器解碼成語意字串，再由完整 YAML 純量編碼器確定性地重新序列化。

對現有行導向 `source:` 路徑可讀取的合法單一實體行字串純量（包含跳脫引號、反斜線、
Unicode、冒號、井字號，以及以 escape 表示的換行、定位與控制字元），解析、序列化、
再次解析後的語意值 SHALL 與原值完全相同，且 SHALL NOT 重複跳脫。block scalar 與跨
實體行 quoted scalar 不在此 requirement 的支援語法內。若完整編碼器無法序列化語意
字串，pipeline SHALL fail closed，不得退回只處理部分字元的手刻引號函式。
`scripts/validate-posts.mjs` SHALL 繼續使用真 YAML 解析器，讓任何欄位的無效 YAML 在
validate 階段被擋下。

#### Scenario: 帶撇號的 source label 最終落地合法 YAML

- **WHEN** write 步驟的 LLM 輸出裡 `source:` 的值（例如 `Simon Willison's Weblog`）用了不安全或缺漏的引號
- **THEN** 經過 `ralph` 步驟後，該檔案的 `source:` 那一行 SHALL 是合法 YAML（可被無錯解析）
- **AND** 對該檔案跑 `node scripts/validate-posts.mjs` SHALL NOT 因無效 YAML 而拒絕它

#### Scenario: validate-posts 能抓到真正無效的 YAML

- **WHEN** 某個 frontmatter 欄位含有未跳脫、無效的 YAML（例如未終止的 quoted scalar）
- **THEN** `node scripts/validate-posts.mjs` SHALL 失敗，錯誤訊息 SHALL 指出該檔案
- **AND** 這個失敗 SHALL 發生在 deploy 步驟呼叫 `pnpm run build` 之前

#### Scenario: 既有文章庫不受影響

- **WHEN** `scripts/validate-posts.mjs` 使用真 YAML 解析器解析 frontmatter
- **THEN** 每一篇既有已發佈文章的 frontmatter SHALL 依然能被成功解析

#### Scenario: 合法跳脫引號與反斜線保持語意

- **GIVEN** `source` 是含跳脫引號與反斜線的合法 YAML 純量
- **WHEN** ralph 正規化器解析、重新序列化，再次解析輸出
- **THEN** 第二次解析的語意值 SHALL 等於第一次解析的值
- **AND** 輸出 SHALL NOT 把跳脫標記保留成額外資料字元

#### Scenario: Unicode、冒號與井字號保持語意

- **GIVEN** `source` 語意值含 Unicode、冒號或井字號
- **WHEN** 引號輔助函式序列化後由 YAML 解析器讀回
- **THEN** 解碼值 SHALL 與原語意值完全相同

#### Scenario: 換行、定位與控制字元以合法跳脫表示

- **GIVEN** `source` 語意值含實際換行、定位或控制字元
- **WHEN** 引號輔助函式序列化該值
- **THEN** 輸出 SHALL 是單一合法 YAML 字串純量
- **AND** YAML 解析器讀回的值 SHALL 與原語意值完全相同

#### Scenario: 多行 YAML 語法維持在行導向 getter 邊界外

- **GIVEN** `source` 使用 block scalar 或跨實體行 quoted scalar 語法
- **WHEN** 行導向 frontmatter getter 讀取欄位
- **THEN** 此 change SHALL NOT 宣稱能正規化該語法
- **AND** 完整 frontmatter validator 仍 SHALL 依真 YAML parser 判斷整份文件是否合法

#### Scenario: 無效 writer 純量維持受限補救

- **GIVEN** writer 產生解析器無法接受的 `source` 純量
- **WHEN** ralph 正規化器執行
- **THEN** 既有有限度的 delimiter recovery MAY 處理常見錯誤引號
- **AND** 補救出的語意字串仍 SHALL 交給完整 YAML 純量編碼器寫回

### Requirement: 補救成功 JSON SHALL 回報實際寫出的英文產物

`gp-pipeline run --json` 成功時，若 pipeline 已產生英文對應檔，`enFilename` SHALL 回報
`PostsDir` 內實際存在之 regular file 的 basename。正式發佈檔案存在時 SHALL 優先回報
正式名稱；尚未產生正式檔案但翻譯步驟已寫出暫用檔案時 SHALL 回報暫用 basename。只有
未產生英文產物時才可省略欄位。

#### Scenario: 既有正式文章缺英文檔時執行翻譯補救

- **GIVEN** 既有中文正式文章尚無標準 `en-` 對應檔
- **WHEN** `run --from-step translate --file <existing>.mdx --json` 成功寫出英文檔
- **THEN** 報告的 `enFilename` SHALL 等於實際寫出的檔案 basename
- **AND** SHALL NOT 因 `State.ENFilename` 尚空而省略欄位

#### Scenario: 預填暫用名稱但未寫檔時不得回報

- **GIVEN** `RalphPassed=false`，且 `ActiveENFilename` 已預填但對應檔案不存在
- **WHEN** `run --dry-run --json` 成功結束
- **THEN** 報告 SHALL 省略 `enFilename`
- **AND** SHALL NOT 把預定名稱冒充為實際產物

#### Scenario: 正式發佈檔名優先於暫用名稱

- **GIVEN** pipeline 狀態同時有暫用英文檔名與正式發佈英文檔名
- **WHEN** `run --json` 組裝成功報告
- **THEN** `enFilename` SHALL 回報正式發佈檔名

#### Scenario: 沒有英文產物時省略欄位

- **GIVEN** pipeline 未寫出英文對應檔，且沒有正式英文檔名
- **WHEN** `run --json` 組裝成功報告
- **THEN** 報告 SHALL 依 `omitempty` 省略 `enFilename`

### Requirement: recovery guidance SHALL preserve allocated article identity

面向 agent 的 `gp-pipeline` 指引 SHALL 區分「已配置正式號碼的文章」與「全新 PENDING 文章」。既有正式 zh-tw 文章若仍缺英文對應檔，SHALL 經由 `run --from-step translate --file <existing>.mdx` 恢復；既有正式雙語文章若只差發布，SHALL 經由 `run --from-step deploy --file <existing>.mdx` 恢復。這些既有檔路徑 SHALL 保留目前的 ticket ID 與檔名，且 SHALL NOT 進行全新 counter 配號。

獨立 `deploy` SHALL 被說明為全新 PENDING 配號路徑。其 help SHALL 標示 `--date-stamp`、`--author-slug`、`--title-slug` 為這條路徑的必填 flags，並在 counter 或檔案異動之前列出輸入、taxonomy、frontmatter、staged index 與 validator 關卡，也要如實標示僅供測試 flags 的支援範圍。面向 agent 的指引 SHALL 將批准與品質規則指向 `AGENTS.md` 及偵測出的執行環境 playbook，不得複製另一套規則。

#### Scenario: 既有正式中文文章補英文並發布

- **GIVEN** 已配置正式 ticket 的 zh-tw 文章缺少英文對應檔
- **WHEN** 操作者依 skill 執行恢復指令
- **THEN** 指令 SHALL 是 `run --from-step translate --file <existing>.mdx`
- **AND** pipeline SHALL 保留既有 ticket 與檔名

#### Scenario: 既有正式雙語文章恢復發布

- **GIVEN** 已配置正式 ticket 與正式檔名的雙語文章只剩發布
- **WHEN** 操作者依 skill 執行恢復指令
- **THEN** 指令 SHALL 是 `run --from-step deploy --file <existing>.mdx`
- **AND** pipeline SHALL NOT 增加文章 counter 或更改正式檔名

#### Scenario: 全新 PENDING 獨立 deploy 顯示完整契約

- **WHEN** 操作者執行 `gp-pipeline deploy --help`
- **THEN** help SHALL 說明此 subcommand 用於全新 PENDING 配號
- **AND** SHALL 標示 `--date-stamp`、`--author-slug`、`--title-slug` 為該路徑必填
- **AND** SHALL 把驗證與狀態關卡排在 counter bump 與改名之前
- **AND** SHALL 誠實標示僅供測試 flags 在正常執行與 dry-run 下的支援範圍

#### Scenario: approval policy 維持單一真相來源

- **WHEN** agent 讀取 gp-pipeline skill 的副作用指引
- **THEN** skill SHALL 指向 `AGENTS.md` 與 identity detection 選出的執行環境 playbook，取得批准與品質門檻
- **AND** SHALL NOT 另行定義一套批准規則

### Requirement: gp-pipeline 的 Go 測試 SHALL 是 PR 必要檢查

PR Fast Gate SHALL 在既有 workflow 內以一個有執行時間上限的 leaf job 執行 `tools/gp-pipeline` 的完整 Go 測試，並停用測試快取（`go test -count=1 ./...`），且把該 leaf 列進既有 `ci-passed.needs`。`ci-passed` SHALL 只把該 leaf 的結果字面值為 `success` 視為通過。

該 leaf 的執行環境 SHALL 提供 Go 測試會呼叫的 Node 與已安裝的 repo 套件，讓依賴 repo 腳本的測試實際執行，而不是因缺少依賴被略過或失敗。

#### Scenario: Go 測試失敗擋下 merge

- **WHEN** 某個 PR 讓 `tools/gp-pipeline` 的任一 Go 測試失敗
- **THEN** 同一次 workflow run 的 `ci-passed` SHALL NOT 回報 success

#### Scenario: Go 測試 leaf 接在既有聚合

- **WHEN** 檢查 PR Fast Gate workflow
- **THEN** Go 測試 leaf SHALL 出現在 `ci-passed.needs`，設有執行時間上限，並在執行 `go test -count=1 ./...` 前安裝 repo 的 Node 套件
- **AND** repo SHALL NOT 另建脫離 `ci-passed` 的 Go 測試 workflow

### Requirement: gp-pipeline SHALL 以檔名或明確的 `--prefix` 決定系列

`run` 帶 `--file`、standalone `deploy` 帶 `--active-file`、`ralph` 帶 `--file` 時，這次處理的系列 SHALL 以檔名依 repo canonical 慣例對應的系列為準：接受可選的 `en-` 前綴，並認得既有 Lv 文章的 `levelup-` 前綴。明確指定的 `--prefix` 與檔名系列不一致時，指令 SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息 SHALL 同時列出兩個系列，且 SHALL NOT 建立工作目錄或呼叫任何模型。

沒有檔案可以判斷系列時，`--prefix` SHALL 必填、沒有預設值：`run`、`counter` 與 `write` 沒指定 `--prefix` 時，SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息列出可用的系列，SHALL NOT 自動選一個系列繼續。

#### Scenario: 以既有非 GP 檔案恢復時沒帶 prefix

- **WHEN** 操作者執行 `run --from-step translate --file <既有 MP 檔或 levelup- 開頭的 Lv 檔>`，沒有帶 `--prefix`
- **THEN** pipeline SHALL 依檔名把這次執行視為 MP 或 Lv
- **AND** SHALL NOT 要求操作者另外指定 `--prefix`

#### Scenario: prefix 與檔案系列不一致

- **WHEN** 操作者明確帶 `--prefix GP` 並以 MP 檔作為 `--file` 或 `--active-file`，或反過來
- **THEN** 指令 SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息 SHALL 同時列出兩個系列
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型

#### Scenario: 沒帶 prefix 也沒有檔案

- **WHEN** 操作者執行 `gp-pipeline run <url>` 或 `gp-pipeline counter bump`，沒有 `--prefix` 也沒有檔案
- **THEN** 指令 SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息 SHALL 列出可用的系列
- **AND** SHALL NOT 建立工作目錄、呼叫任何模型或改動 `scripts/article-counter.json`

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

### Requirement: write、review 與 refine SHALL NOT 把工作目錄裡的舊產物當成這次的輸出

`write`、`review` 與 `refine` 寫出的 `draft-v1.mdx`、`review.md` 或 `final.mdx` SHALL 是這次寫手的輸出：寫手沒有寫檔時，輸出 SHALL 只取這次回傳的 stdout，沒有 stdout 就 SHALL 失敗，SHALL NOT 沿用工作目錄裡上一次留下的檔。寫手失敗而沒有寫出檔案時，工作目錄裡原本的檔案 SHALL 維持原樣。

#### Scenario: 寫手只用 stdout 回覆

- **WHEN** 工作目錄裡有上一次留下的 `draft-v1.mdx`、`review.md` 或 `final.mdx`，這次 `write`、`review` 或 `refine` 的寫手沒有寫檔、只回傳 stdout
- **THEN** 該檔 SHALL 是這次的 stdout，SHALL NOT 是上一次留下的內容

#### Scenario: 寫手失敗

- **WHEN** 工作目錄裡有上一次留下的 `draft-v1.mdx`、`review.md` 或 `final.mdx`，這次 `write`、`review` 或 `refine` 的寫手失敗、沒有寫出檔案
- **THEN** 指令 SHALL 失敗，該檔 SHALL 維持原本的內容

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
