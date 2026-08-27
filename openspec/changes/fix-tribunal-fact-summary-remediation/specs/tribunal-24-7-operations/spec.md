## MODIFIED Requirements

### Requirement: 長時間執行的部署版環境 SHALL 啟用改寫

部署版非互動式 24/7 執行環境（systemd unit／wrapper）SHALL 設定 `GP_WRITER_MODE=codex`，並 SHALL 在派送文章前驗證 Codex 寫手能完成有界的寫入 canary。Canary SHALL 從 `.codex/agents/tribunal-writer.toml` 解析 `tribunal-writer` model，並 SHALL 重用正式寫手專用的 `workspace-write` 沙箱、tmp 排除、無網路邊界、approval policy 與逾時行為。部署版服務與 wrapper SHALL NOT 讀取、匯出或驗證 Claude token 或憑證。Library 預設 MAY 維持 `none`，非部署版互動式編排 MAY 保留 `subagent` 或舊版 `cli` 相容性，但正式 daemon SHALL NOT 以只評分、未消費 broker 或 Claude CLI 寫手模式執行。

部署版 writer 的 frontmatter 權限 SHALL 由 parent runner 依 stage 決定，而非由 writer 自行宣告。只有 FactChecker 失敗後的 bounded rewrite MAY 成對替換既有 zh-tw／English 單行 quoted `summary` 字串純量，並 SHALL 在下一輪 FactChecker 重新驗證；沒有 English sidecar 時 MAY 修正單語摘要。其他 judge rewrite 與 final-build repair SHALL 維持整份 writer frontmatter 不可變。允許的 summary 替換之外，欄位、位置、quote style、行尾與所有 frontmatter bytes SHALL 維持不變。English sidecar 存在時，單邊 summary 變更 SHALL 封閉失敗。Candidate capture、validation、apply 與 CAS rollback SHALL 維持同一個明示 policy；crash recovery SHALL 保持 policy-neutral，依 journal 保存的完整 bytes／identity 維持既有雙語 crash-atomic 邊界。

#### Scenario: 未過關文章由 Codex 改寫而非跳過

- **WHEN** 文章在部署版 daemon 的任一評審階段未過關
- **THEN** Codex Tribunal 寫手 SHALL 使用 `.codex/agents/tribunal-writer.toml` 的 model 接受呼叫
- **AND** 改寫 SHALL 在正式環境專用的寫手沙箱內執行
- **AND** 本次執行 SHALL NOT 記錄 `rewrite skipped (GP_WRITER_MODE=none)`，也不得在沒有改寫時耗盡嘗試次數變成 EXHAUSTED
- **AND** 寫手 log 或進度來源 SHALL 記錄實際 Codex provider／model

#### Scenario: 寫手寫入 canary 在派送前成功

- **WHEN** 部署版 daemon 啟動時 Codex 可用，且 tribunal-writer TOML 有效
- **THEN** 前置檢查 SHALL 要求正式 Codex 寫手執行器在私有專用 canary 工作區寫入固定 sentinel
- **AND** 前置檢查 SHALL 在設定的逾時內驗證完全相同的 sentinel 內容
- **AND** canary SHALL 無權寫入正式 repo、slash tmp 或 `TMPDIR`，也不得存取網路
- **AND** daemon SHALL 只在這項驗證完成後領取或派送文章

#### Scenario: 寫手前置檢查在派送前失敗

- **WHEN** 寫手模式不是 `codex`、Codex 無法使用、tribunal-writer TOML 無效、canary 逾時，或 sentinel 遺失或錯誤
- **THEN** 部署版 daemon SHALL 在領取或派送文章前退出
- **AND** SHALL 輸出可採取行動的寫手前置檢查錯誤
- **AND** SHALL NOT 透過 Claude 重試

#### Scenario: 部署版服務在沒有 Claude CLI 或憑證時仍可執行

- **WHEN** Codex 角色設定與寫入 canary 有效、`PATH` 中沒有 `claude`，且不存在 Claude token 檔或 Claude 憑證環境變數
- **THEN** 部署版服務啟動、wrapper、doctor、文章派送、改寫與額度復原 SHALL 仍然成功
- **AND** 這些路徑 SHALL 全都不得檢查或呼叫 Claude 執行檔
- **AND** 這些路徑 SHALL 全都不得讀取、匯出或驗證 Claude 憑證

#### Scenario: 非部署版相容路徑留在正式環境之外

- **WHEN** 部署版嚴格模式未啟用
- **THEN** 互動式 `subagent`、舊版 `cli` 或 CCC 供應端備援 MAY 維持可用
- **AND** 這些相容路徑 SHALL NOT 滿足或繞過部署版 Codex 寫入 canary 合約

#### Scenario: FactChecker 修正雙語摘要後重新驗證

- **WHEN** FactChecker 因既有 zh-tw `summary` 的事實錯誤判定失敗，且 English sidecar 存在
- **THEN** parent runner MAY 允許 writer 在隔離候選中成對替換兩個既有單行 quoted `summary` 值
- **AND** 兩個語言檔除 summary payload 外的 frontmatter bytes SHALL 完全等於各自 baseline
- **AND** candidate SHALL 先通過既有 post／YAML validation，再以雙語 CAS 套用
- **AND** 下一輪 FactChecker SHALL 重新讀取套用後的文章並依既有 pass bar 判斷
- **AND** summary 替換本身 SHALL NOT 直接取得 PASS

#### Scenario: Writer 嘗試改動受保護 frontmatter

- **WHEN** writer 新增、刪除、搬移或改動非 `summary` frontmatter，改變 summary 的 key／quote style／行結構，產生 duplicate／multi-line／tagged／anchored summary，或只改雙語 pair 的其中一邊
- **THEN** candidate capture SHALL 封閉失敗並保留 canonical pair
- **AND** runner SHALL NOT 把該候選視為成功改寫

#### Scenario: 沒有 English sidecar 的 FactChecker 摘要修正

- **WHEN** FactChecker rewrite 處理沒有 English sidecar 的文章，並只替換既有 zh-tw 單行 quoted `summary` 值
- **THEN** candidate capture MAY 接受該單語摘要候選
- **AND** runner SHALL NOT 為了滿足 paired policy 建立新的 English sidecar
- **AND** 候選仍 SHALL 經過 validation、CAS apply 與下一輪 FactChecker 重評

#### Scenario: 非 FactChecker 路徑嘗試改動摘要

- **WHEN** Librarian、FreshEyes、Vibe 或 final-build repair 的 writer candidate 改動任一 `summary`
- **THEN** candidate capture SHALL 依 preserve-all policy 封閉失敗
- **AND** SHALL NOT 因 writer prompt 或 article prose 升級 frontmatter 權限

#### Scenario: 摘要候選需要 CAS rollback

- **WHEN** 合法 paired-summary candidate 套用後 validation 失敗或 canonical path 發生 race
- **THEN** CAS rollback SHALL 使用與 capture／apply 相同的 transaction policy
- **AND** SHALL NOT 覆寫平行人工編輯

#### Scenario: 摘要候選在雙語 exchange 中途死亡

- **WHEN** 行程在合法 paired-summary candidate 的雙語 exchange 中途終止
- **THEN** policy-neutral crash recovery SHALL 只依 journal 的完整 baseline／candidate bytes 與 identity 判斷
- **AND** 最終 SHALL 收斂成完整 baseline pair 或完整 candidate pair
- **AND** SHALL NOT 產生單語新摘要或丟棄未知 journal 證據
