## ADDED Requirements

### Requirement: gp-pipeline SHALL NOT 撰寫 Lv 正文

會跑到 write、review 或 refine 的入口遇到 Lv 時，SHALL 在 ingress 以 exit code 1 失敗。這些入口是：`run` 處理 Lv（`--prefix Lv`，或 `--file` 是 Lv 檔），而且起點在 refine 之前或與 refine 相同（沒指定起點也算）；`write --prefix Lv`；`review`、`refine` 的 ticket 是 Lv ticket。拒絕 SHALL 發生在建立工作目錄、抓取來源、provider preflight、模型呼叫與 counter 異動之前。錯誤訊息 SHALL 說明 pipeline 不撰寫 Lv、指向 `CONTRIBUTING.md` 的 Lv 寫作流程，並列出 Lv 仍可用的步驟；SHALL NOT 改用其他系列繼續執行。

#### Scenario: 用 run 從網址寫 Lv

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix Lv`
- **THEN** 指令 SHALL 以 exit code 1 結束，錯誤訊息 SHALL 指向 `CONTRIBUTING.md` 的 Lv 寫作流程
- **AND** SHALL NOT 建立工作目錄、抓取來源或呼叫任何模型
- **AND** `scripts/article-counter.json` SHALL 維持不變

#### Scenario: 以 Lv 檔從寫作步驟恢復

- **WHEN** 操作者以 `run --file <lv- 或 levelup- 開頭的檔案>` 執行，沒有帶 `--from-step`，或 `--from-step` 是 `write`、`review` 或 `refine`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型

#### Scenario: 單步 write 寫 Lv

- **WHEN** 操作者執行 `gp-pipeline write --prefix Lv --source <source-tweet.md>`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，也 SHALL NOT 產生 `draft-v1.mdx`

#### Scenario: 單步 review 或 refine 處理 Lv ticket

- **WHEN** 操作者以 Lv ticket（例如 `Lv-PENDING`）執行 `gp-pipeline review` 或 `gp-pipeline refine`
- **THEN** 指令 SHALL 以 exit code 1 結束
- **AND** SHALL NOT 呼叫任何模型，也 SHALL NOT 改動工作目錄裡的草稿

#### Scenario: SD 不受影響

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix SD`
- **THEN** 這條要求 SHALL NOT 擋下這次執行，SD 的步驟與 exit code SHALL 維持原樣

### Requirement: Lv SHALL 仍可使用 pipeline 的非寫作步驟

Lv 的 `counter`、`fetch`、`eval`、`dedup`、`ralph`、`translate`、standalone `deploy`，以及 `run --file <Lv 檔>` 從 `ralph`、`translate` 或 `deploy` 開始的恢復，SHALL 照常運作，行為與 exit code SHALL NOT 因上一條要求改變。

#### Scenario: 手寫 Lv 通過 Tribunal 後產生英文版

- **WHEN** 操作者以 `run --file <既有 Lv 檔> --from-step translate` 或 `translate --file <既有 Lv 檔>` 執行
- **THEN** pipeline SHALL 依檔名把這次執行視為 Lv，並照既有流程產生英文 sidecar

#### Scenario: 替手寫 Lv 配號

- **WHEN** 操作者執行 `gp-pipeline counter bump --prefix Lv`
- **THEN** 指令 SHALL 照常配出下一個 Lv 號碼

### Requirement: 寫作指令的 help text SHALL NOT 邀請撰寫 Lv

`write`、`review`、`refine` 的說明，以及 `run`、`candidate` 與 root help 裡描述可撰寫系列的文字，SHALL NOT 把 Lv 列為 pipeline 可以撰寫的系列。`counter`、`dedup`、`deploy` 等非寫作指令的說明 SHALL 繼續列出 Lv。

#### Scenario: 查看 write 的說明

- **WHEN** 操作者執行 `gp-pipeline write --help`
- **THEN** `--prefix` 的說明 SHALL 只列出 GP、MP、SD
- **AND** 說明 SHALL NOT 宣稱 `write` 可以撰寫 Lv

#### Scenario: 查看 counter 的說明

- **WHEN** 操作者執行 `gp-pipeline counter bump --help`
- **THEN** `--prefix` 的說明 SHALL 繼續列出 Lv
