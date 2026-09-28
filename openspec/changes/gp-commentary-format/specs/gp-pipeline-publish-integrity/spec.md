## REMOVED Requirements

### Requirement: GP 暫停期間 gp-pipeline SHALL 在 ingress 拒絕 GP 寫作與發布

**Reason**: 本 change 以導讀格式恢復 GP，暫停期間的 ingress 拒絕不再成立；CLI 入口與 pipeline 層的「GP 暫停中」拒絕一併移除。OpenSpec 不允許 MODIFIED 刪情境，所以整條移除。

**Migration**: 以檔名判斷系列的規則與它的情境移到「gp-pipeline SHALL 以檔名判斷既有文章的系列」；GP 的流程由「GP SHALL 以導讀流程產出並在發布前蓋章」定義。

## ADDED Requirements

### Requirement: gp-pipeline SHALL 以檔名判斷既有文章的系列

`run` 帶 `--file`、standalone `deploy` 帶 `--active-file`、`ralph` 帶 `--file` 時，這次處理的系列 SHALL 以檔名依 repo canonical 慣例對應的系列為準：接受可選的 `en-` 前綴，並認得既有 Lv 文章的 `levelup-` 前綴。明確指定的 `--prefix` 與檔名系列不一致時，指令 SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息 SHALL 同時列出兩個系列，且 SHALL NOT 建立工作目錄或呼叫任何模型。沒有檔案時才以 `--prefix` 為準，包含未指定時的預設值 GP。

#### Scenario: 以既有非 GP 檔案恢復時沒帶 prefix

- **WHEN** 操作者執行 `run --from-step translate --file <既有 MP 檔或 levelup- 開頭的 Lv 檔>`，沒有帶 `--prefix`
- **THEN** pipeline SHALL 依檔名把這次執行視為 MP 或 Lv
- **AND** SHALL NOT 因 `--prefix` 的預設值 GP 而走 GP 流程

#### Scenario: prefix 與檔案系列不一致

- **WHEN** 操作者明確帶 `--prefix GP` 並以 MP 檔作為 `--file` 或 `--active-file`，或反過來
- **THEN** 指令 SHALL 在 ingress 以 exit code 1 失敗，錯誤訊息 SHALL 同時列出兩個系列
- **AND** SHALL NOT 建立工作目錄或呼叫任何模型

### Requirement: GP SHALL 以導讀流程產出並在發布前蓋章

gp-pipeline 處理 GP 時 SHALL 走跟 MP 相同的 `write → review → refine`，這三步的 prompt 使用 GP 導讀契約（見 `editorial-charter`）。refine 之後依序是：會改正文的確定性 post-fixer（例如 kaomoji 與 glossary 連結），讓章涵蓋最終正文；`source-distance`：配對、計分與蓋章，沒過就依 `source-distance-stamp` 回到 refine 改寫；`credits`；只評分的 `ralph`；`translate` 與英文版的逐字檢查；`deploy`。`--from-step` SHALL 接受 `source-distance`，從既有的工作目錄恢復時重新配對與計分，SHALL NOT 重寫草稿。

GP 的 write 與 refine SHALL 收到 glossary 的 canonical 術語 context。`--angle` SHALL 可用於 GP。`write`、`review`、`refine` 單步指令 SHALL 接受 GP。模型輸出含 `ShroomDogNote` 時，該步驟 SHALL 失敗，這段輸出 SHALL NOT 寫進文章。

任何裝有 Claude CLI 的執行環境（本機、CCC、VM）SHALL 能跑完整的 GP 流程，SHALL NOT 需要 GP 專屬的 runtime profile。

#### Scenario: GP 導讀跑完整流程

- **WHEN** 操作者執行 `gp-pipeline run <url> --prefix GP`
- **THEN** 步驟 SHALL 依序是 fetch、dedup、eval、write、review、refine、post-fixer、source-distance、credits、ralph、translate 與英文逐字檢查、deploy
- **AND** `ralph` SHALL NOT 改寫 GP 正文，也 SHALL NOT 跑 post-fixer

#### Scenario: 章涵蓋 post-fixer 之後的正文

- **WHEN** post-fixer 在 refine 或改寫之後改動了正文
- **THEN** 蓋章 SHALL 發生在 post-fixer 之後
- **AND** 部署出去的正文重算的指紋 SHALL 等於章上的指紋

#### Scenario: 寫手收到術語 context

- **WHEN** pipeline 組裝 GP 的 write 或 refine prompt
- **THEN** prompt SHALL 含 glossary 的 canonical 術語 context

#### Scenario: 沒有 runtime profile 的環境跑 GP

- **WHEN** 沒有 runtime profile 的 caller（例如 CCC）執行 GP 的 run
- **THEN** pipeline SHALL NOT 要求 GP 專屬的 profile
- **AND** 寫作與配對 SHALL 都使用 Claude 模型

#### Scenario: 從 source-distance 恢復

- **WHEN** 操作者以 `--from-step source-distance` 恢復一次中斷的 GP run
- **THEN** pipeline SHALL 用工作目錄裡的草稿重新配對與計分
- **AND** SHALL NOT 重跑 write、review 或 refine，除非計分沒過而進入改寫
