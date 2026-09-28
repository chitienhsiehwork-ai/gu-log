## ADDED Requirements

### Requirement: GP 暫停期間 gp-pipeline SHALL 在 ingress 拒絕 GP 寫作與發布

在導讀新格式的 change 重新開放 GP 之前，下列會為 GP 產生新文章或配置 GP 號碼的入口 SHALL 在 ingress 以「GP 暫停中」錯誤結束：

- `run`：這次處理的是 GP。
- standalone `deploy`：這次處理的是 GP。
- `counter bump`：`--prefix` 是 GP，包含未指定時的預設值。
- `write`：`--prefix` 是 GP，包含未指定時的預設值。
- `review`、`refine`：ticket 是 GP ticket，包含未指定時的預設值。

`run` 與 standalone `deploy` 判斷是否為 GP 的依據 SHALL 是這次要處理的文章：有 `--file`（`run`）或 `--active-file`（standalone `deploy`）時，以檔名依 repo canonical 慣例對應的系列為準（包含既有 Lv 文章的 `levelup-` 前綴）；明確指定的 `--prefix` 與檔名系列不一致時，指令 SHALL 在 ingress 以 exit code 1 失敗；沒有檔案時才以 `--prefix` 為準，包含未指定時的預設值 GP。

拒絕 SHALL 發生在建立或寫入工作目錄、抓取來源、解析 runtime profile、provider preflight、模型呼叫、counter 異動、檔案 rename 與 git 操作之前。Exit code SHALL 是 1，也就是 gp-pipeline 既有 ingress 拒絕（例如非 canonical prefix）使用的一般錯誤。錯誤訊息 SHALL 包含「GP 暫停中」並指向 `editorial-charter`；pipeline SHALL NOT 自動改用其他系列繼續執行。

CLI 入口之外，pipeline 的整條執行與發布步驟收到 GP 時 SHALL 同樣以「GP 暫停中」錯誤結束，不依賴 CLI 先擋下。

本 requirement 只涵蓋上述入口：唯讀或只評分的指令（例如 `counter next`、`ralph`）、只替既有文章補英文檔的 `translate`，以及 `fetch`、`eval`、`dedup`、`candidate`、`status`、`doctor` 不受影響。MP、SD 與 Lv 的流程、步驟與 exit code SHALL 不變。

#### Scenario: 沒指定 prefix 的 run

- **WHEN** 操作者執行 `gp-pipeline run <url>`，沒有帶 `--prefix` 也沒有帶 `--file`
- **THEN** 指令 SHALL 以 exit code 1 結束，錯誤訊息包含「GP 暫停中」與 `editorial-charter`
- **AND** SHALL NOT 建立工作目錄、抓取來源、解析 runtime profile 或呼叫任何模型

#### Scenario: 以既有 GP 檔案恢復或發布

- **WHEN** 操作者以 `run --file <既有 GP 檔> --from-step <任一步驟>` 恢復 GP，或以 GP 的 pending 檔執行 standalone `deploy`
- **THEN** 指令 SHALL 以 exit code 1 與「GP 暫停中」錯誤結束
- **AND** `scripts/article-counter.json`、`src/content/posts/` 與 git 狀態 SHALL 維持不變

#### Scenario: counter bump 使用預設 prefix

- **WHEN** 操作者執行 `gp-pipeline counter bump`，沒有帶 `--prefix`，或帶 `--prefix GP`
- **THEN** 指令 SHALL 以 exit code 1 與「GP 暫停中」錯誤結束
- **AND** `scripts/article-counter.json` SHALL 維持不變

#### Scenario: 以既有非 GP 檔案恢復時沒帶 prefix

- **WHEN** 操作者執行 `run --from-step translate --file <既有 MP 檔或 levelup- 開頭的 Lv 檔>`，沒有帶 `--prefix`
- **THEN** pipeline SHALL 依檔名把這次執行視為 MP 或 Lv
- **AND** SHALL NOT 因 `--prefix` 的預設值 GP 而以「GP 暫停中」拒絕

#### Scenario: prefix 與檔案系列不一致

- **WHEN** 操作者明確帶 `--prefix GP` 並以 MP 檔作為 `--file` 或 `--active-file`，或反過來
- **THEN** 指令 SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息 SHALL 同時列出兩個系列
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型

#### Scenario: 單步寫作指令收到 GP

- **WHEN** 操作者以 GP prefix 執行 `write`，或以 GP ticket 執行 `review` 或 `refine`
- **THEN** 指令 SHALL 在呼叫任何模型前以 exit code 1 與「GP 暫停中」錯誤結束

#### Scenario: 繞過 CLI 直接執行 pipeline

- **WHEN** 程式直接以 GP 呼叫 pipeline 的整條執行或發布步驟，沒有經過 CLI 入口
- **THEN** pipeline SHALL 回「GP 暫停中」錯誤
- **AND** SHALL NOT 執行任何步驟，也 SHALL NOT 異動 counter、文章檔案或 git

#### Scenario: 其他系列不受影響

- **WHEN** 操作者以 `--prefix MP` 執行 `gp-pipeline run <url>`
- **THEN** pipeline SHALL 照 MP 既有流程執行，本 requirement SHALL NOT 改變其步驟或 exit code

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

## MODIFIED Requirements

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
