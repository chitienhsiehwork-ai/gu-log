## ADDED Requirements

### Requirement: Tribunal 發布器 SHALL 收斂已存在於 main 的成品

Tribunal 發布器 SHALL 將已符合最新 `origin/main` 的有效 PASS 成品推進至終結狀態，不得虛構實際上沒有發生的發布生命週期。

#### Scenario: 整批通過驗證的選取內容已符合 main

- **WHEN** 發布器已 fetch `origin/main`
- **AND** 每個被選取的成品都通過既有發布器 validation gate
- **AND** 將所有被選取的 zh-tw 與現有 en 成品路徑 materialize 後，對該 `origin/main` 沒有 staged diff
- **THEN** 發布器 SHALL 原子地把每個被選取項目轉為 `published`
- **AND** 每個項目 SHALL 記錄 `publicationMethod: "already_on_main"`、本輪成功 fetch 後 materialized worktree exact HEAD SHA 的 `mainCommit` 與 `updatedAt`
- **AND** 發布器 SHALL 清除這些項目上過時的批次、PR 與 merge metadata
- **AND** 發布器 SHALL NOT 為 no-diff 選取內容建立批次、remote branch、PR 或 merge 紀錄

#### Scenario: 已收斂的成品不會再次入選

- **WHEN** 先前的 no-diff 選取內容已收斂為 `published`
- **THEN** 後續發布器執行 SHALL NOT 再把這些項目當成 `ready_for_batch` 選取
- **AND** 後方仍可發布的 PASS 成品 SHALL 保持可推進

#### Scenario: 任一被選取的成品路徑與 main 不同

- **WHEN** 任一被選取的 zh-tw 成品或現有 en sidecar 與最新 `origin/main` 不同
- **THEN** 發布器 SHALL NOT 對該選取內容使用 already-on-main shortcut
- **AND** 發布器 SHALL 保留既有 validation、批次、PR 與 merge 生命週期

#### Scenario: 相同成品未通過驗證

- **WHEN** 成品符合最新 `origin/main`，但未通過既有發布器 validation gate
- **THEN** 發布器 SHALL 保留既有 `validation_blocked` 行為
- **AND** 發布器 SHALL NOT 透過 no-diff reconciliation 將該成品標為 `published`

#### Scenario: Fresh origin/main fetch 失敗

- **WHEN** 發布器無法成功 refresh `origin/main`
- **THEN** 發布器 SHALL NOT 執行 already-on-main reconciliation
- **AND** 發布器 SHALL NOT 建立批次、remote branch 或 PR
- **AND** 既有發布器狀態帳本 SHALL 保持 byte-identical

#### Scenario: Atomic ledger replacement 失敗

- **WHEN** 發布器無法完成同目錄 temp-file 寫入、驗證或 rename
- **THEN** 原發布器狀態帳本 SHALL 保持 byte-identical
- **AND** 發布器 SHALL 清理未完成的 temp-file
- **AND** 下次執行 SHALL 能重新嘗試同一批 entry

### Requirement: 發布器候選收集 SHALL 在批次上限正常停止

Tribunal 發布器 SHALL 在 `--apply` 選取時至多列舉設定的批次上限，不得把較長 eligible queue 的正常截斷視為 producer failure；未傳入 limit 的報表收集 SHALL 保留完整計數。

#### Scenario: Eligible queue 超過設定的批次上限

- **WHEN** 可發布 PASS 成品數量超過 `MAX_BATCH`
- **THEN** 發布器 SHALL 依既有 deterministic order 至多選取 `MAX_BATCH` 筆成品
- **AND** 候選收集 SHALL 在沒有 Broken pipe 或其他 truncation error 的狀態下結束
- **AND** 尚未入選的 eligible 成品 SHALL 保留給後續批次
