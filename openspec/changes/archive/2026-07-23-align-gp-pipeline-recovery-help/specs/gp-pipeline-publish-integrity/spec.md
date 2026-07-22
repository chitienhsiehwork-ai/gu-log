## ADDED Requirements

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
