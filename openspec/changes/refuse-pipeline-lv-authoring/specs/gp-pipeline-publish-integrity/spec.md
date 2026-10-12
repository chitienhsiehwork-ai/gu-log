## ADDED Requirements

### Requirement: gp-pipeline SHALL NOT 撰寫或改寫 Lv，也 SHALL NOT 替 Lv 蓋 pipeline 署名

會撰寫或改寫 Lv 正文，或會把 pipeline 署名（`translatedBy.pipeline`、`pipelineUrl`）寫進 Lv 的入口，遇到 Lv 時 SHALL 以 exit code 1 失敗，SHALL NOT 改用其他系列繼續執行。這些入口是：`run` 處理 Lv，除非是 `run --file <Lv 檔>` 從 `translate` 或 `deploy` 恢復；`write --prefix Lv`；`review`、`refine` 的 `--ticket-id` 或草稿 frontmatter 的 `ticketId` 是 Lv ticket；`credits`、`ralph` 的目標檔是 Lv 檔，也就是檔名系列是 Lv（含 `levelup-` 與 `en-` 前綴），或 frontmatter 的 `ticketId` 是 Lv ticket。

#### Scenario: 以 Lv 檔從寫作或評審步驟恢復

- **WHEN** 操作者以 `run --file <lv- 或 levelup- 開頭的檔案>` 執行，沒有帶 `--from-step`，或 `--from-step` 是 `translate` 之前的任何步驟（例如 `write`、`refine`、`ralph`）
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型，Lv 檔 SHALL 維持不變

#### Scenario: 沒有 Lv 檔的 run

- **WHEN** 操作者執行 `gp-pipeline run --prefix Lv --from-step deploy`，沒有帶 `--file`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型

#### Scenario: 單步 write 寫 Lv

- **WHEN** 操作者執行 `gp-pipeline write --prefix Lv --source <source-tweet.md>`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型，也 SHALL NOT 產生 `draft-v1.mdx`

#### Scenario: 單步 review 或 refine 處理 Lv 草稿

- **WHEN** 操作者以 `--ticket-id Lv-PENDING` 執行 `gp-pipeline review` 或 `gp-pipeline refine`，或沒帶 `--ticket-id`，但草稿 frontmatter 的 `ticketId` 是 `Lv-PENDING`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，也 SHALL NOT 改動工作目錄裡的草稿

#### Scenario: 單步 ralph 或 credits 處理 Lv 檔

- **WHEN** 操作者以 Lv 檔執行 `gp-pipeline ralph --file <檔名>` 或 `gp-pipeline credits --file <路徑>`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 執行 `scripts/tribunal.sh` 或 post-fixer，目標檔 SHALL 維持不變

#### Scenario: SD 不受影響

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix SD`，或以 SD 檔執行 `gp-pipeline ralph --file`
- **THEN** 這條要求 SHALL NOT 擋下這次執行，SD 的步驟與 exit code SHALL 維持原樣

### Requirement: 拒絕 Lv SHALL 發生在任何副作用之前，並指向 Lv 寫作流程

上一條要求的拒絕 SHALL 發生在建立工作目錄、外部工具與 provider 的 preflight（例如 yt-dlp）、抓取來源、模型呼叫、counter 異動與任何檔案寫入之前；`--dry-run` SHALL NOT 改變這個判斷。錯誤訊息 SHALL 說明 pipeline 不撰寫 Lv、指向 `CONTRIBUTING.md` 的 Lv 寫作流程，並列出 Lv 仍可用的步驟。

#### Scenario: 用 run 從網址寫 Lv

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix Lv`，有沒有帶 `--dry-run` 都一樣
- **THEN** 指令 SHALL 以 exit code 1 結束，錯誤訊息 SHALL 指向 `CONTRIBUTING.md` 的 Lv 寫作流程
- **AND** SHALL NOT 建立工作目錄、抓取來源或呼叫任何模型
- **AND** `scripts/article-counter.json` SHALL 維持不變

#### Scenario: 缺少 yt-dlp 時仍先擋 Lv

- **WHEN** 環境裡沒有 yt-dlp，操作者執行 `gp-pipeline run <YouTube 網址> --prefix Lv`
- **THEN** 指令 SHALL 以 exit code 1 結束，而不是缺少 yt-dlp 的 exit code 10

### Requirement: Lv SHALL 仍可使用 pipeline 的非寫作步驟

Lv 的 `counter`、`fetch`、`eval`、`dedup`、`translate`、standalone `deploy`，以及 `run --file <Lv 檔>` 從 `translate` 或 `deploy` 開始的恢復，SHALL 照常運作，行為與 exit code SHALL NOT 因上一條要求改變。

#### Scenario: 手寫 Lv 通過 Tribunal 後產生英文版

- **WHEN** 操作者以 `run --file <既有 Lv 檔> --from-step translate` 或 `translate --file <既有 Lv 檔>` 執行
- **THEN** pipeline SHALL 依檔名把這次執行視為 Lv，並照既有流程產生英文 sidecar

#### Scenario: 替手寫 Lv 配號

- **WHEN** 操作者執行 `gp-pipeline counter bump --prefix Lv`
- **THEN** 指令 SHALL 照常配出下一個 Lv 號碼

### Requirement: 寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv

`write`、`review`、`refine` 的說明，`run`、`candidate` 與 root help 裡描述可撰寫系列的文字，以及 `run`、`write` 缺少 `--prefix` 時列出的可用系列，SHALL NOT 把 Lv 列為 pipeline 可以撰寫的系列。`run --help` SHALL 說明 Lv 檔只能從 `translate` 或 `deploy` 恢復。`counter`、`dedup`、`deploy` 等非寫作指令的說明與錯誤訊息 SHALL 繼續列出 Lv。

#### Scenario: 查看 write 的說明

- **WHEN** 操作者執行 `gp-pipeline write --help`
- **THEN** `--prefix` 的說明 SHALL 只列出 GP、MP、SD
- **AND** 說明 SHALL NOT 宣稱 `write` 可以撰寫 Lv

#### Scenario: write 沒帶 prefix

- **WHEN** 操作者執行 `gp-pipeline write --source <檔案>`，沒有帶 `--prefix`
- **THEN** 指令 SHALL 以 exit code 1 結束，錯誤訊息列出的可用系列 SHALL 是 GP、MP、SD，SHALL NOT 包含 Lv

#### Scenario: 查看 counter 的說明

- **WHEN** 操作者執行 `gp-pipeline counter bump --help`
- **THEN** `--prefix` 的說明 SHALL 繼續列出 Lv
