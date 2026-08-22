## ADDED Requirements

### Requirement: Publisher autopilot SHALL 收斂已存在於 main 的 artifact

Publisher autopilot SHALL 將已符合 fresh `origin/main` 的有效 PASS artifact 推進至終結狀態，不得虛構實際上沒有發生的發布 lifecycle。

#### Scenario: 整批通過驗證的選取內容已符合 main

- **WHEN** publisher 已 fetch `origin/main`
- **AND** 每個被選取的 artifact 都通過既有 publisher validation gate
- **AND** 將所有被選取的 zh-tw 與現有 en artifact 路徑 materialize 後，對該 `origin/main` 沒有 staged diff
- **THEN** publisher SHALL 原子地把每個被選取 entry 轉為 `published`
- **AND** 每個 entry SHALL 記錄 `publicationMethod: "already_on_main"`、精確 `mainCommit` 與更新時間
- **AND** publisher SHALL 清除這些 entry 上過時的 batch、PR 與 merge metadata
- **AND** publisher SHALL NOT 為 no-diff 選取內容建立 batch、remote branch、PR 或 merge 紀錄

#### Scenario: 已收斂的 artifact 不會再次入選

- **WHEN** 先前的 no-diff 選取內容已收斂為 `published`
- **THEN** 後續 publisher 執行 SHALL NOT 再把這些 entry 當成 `ready_for_batch` 選取
- **AND** 後方仍可發布的 PASS artifact SHALL 保持可推進

#### Scenario: 任一被選取的 artifact 路徑與 main 不同

- **WHEN** 任一被選取的 zh-tw artifact 或現有 en sidecar 與 fresh `origin/main` 不同
- **THEN** publisher SHALL NOT 對該選取內容使用 already-on-main shortcut
- **AND** publisher SHALL 保留既有 validation、batch、PR 與 merge lifecycle

#### Scenario: 相同 artifact 未通過驗證

- **WHEN** artifact 符合 fresh `origin/main`，但未通過既有 publisher validation gate
- **THEN** publisher SHALL 保留既有 `validation_blocked` 行為
- **AND** publisher SHALL NOT 透過 no-diff reconciliation 將該 artifact 標為 `published`

### Requirement: Publisher 候選收集 SHALL 在批次上限正常停止

Publisher autopilot SHALL 至多列舉設定的批次上限，不得把較長 eligible queue 的正常截斷視為 producer failure。

#### Scenario: Eligible queue 超過設定的批次上限

- **WHEN** 可發布 PASS artifact 數量超過 `MAX_BATCH`
- **THEN** publisher SHALL 依既有 deterministic order 至多選取 `MAX_BATCH` 筆 artifact
- **AND** 候選收集 SHALL 在沒有 Broken pipe 或其他 truncation error 的狀態下結束
- **AND** 尚未入選的 eligible artifact SHALL 保留給後續批次
