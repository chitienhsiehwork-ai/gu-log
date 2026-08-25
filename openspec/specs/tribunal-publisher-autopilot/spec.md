# tribunal-publisher-autopilot Specification

## Purpose

定義 Tribunal publisher autopilot 如何把可發布的 PASS artifacts 安全推進至 main、恢復既有 PR state，並沿用保守 merge guard 控制自動合併。

## Requirements

### Requirement: Tribunal runtime SHALL advance publishable PASS artifacts toward main

The long-running Tribunal runtime SHALL periodically attempt to materialize publishable PASS artifacts from the ignored runtime ledger into clean main-targeted publisher PRs.

#### Scenario: Runtime finds publishable PASS artifacts

- WHEN the ignored runtime ledger contains articles with current Tribunal version status PASS
- AND those articles are not blocked by conflict or validation events
- THEN runtime SHALL attempt publisher apply from the runtime ledger
- AND the resulting batch SHALL be based on origin/main
- AND the batch SHALL contain only publishable article artifacts

#### Scenario: Runtime is parked by quota debt

- WHEN runtime enters weekly_debt, five_hour_debt, or another quota-stop mode
- THEN runtime SHALL still continue publisher autopilot attempts on later loop iterations
- AND publishable PASS artifacts SHALL NOT require scoring to resume before they can advance to main

### Requirement: Publisher autopilot SHALL recover and advance publisher PR state

Publisher autopilot SHALL reconcile batch branches, PRs, and merged state so publisher entries do not stay stranded at intermediate states.

#### Scenario: Batch branch was pushed but PR creation previously failed

- WHEN a publisher batch entry is in branch_pushed
- AND no open or merged PR exists for the batch branch
- THEN autopilot SHALL create the missing PR
- AND it SHALL label the PR tribunal-publisher
- AND it SHALL transition the affected entries to pr_open

#### Scenario: Publisher PR is still draft

- WHEN an open publisher PR exists for a batch
- AND the PR is marked draft
- THEN autopilot SHALL mark the PR ready for review before attempting merge automation

#### Scenario: Publisher PR was merged

- WHEN a publisher batch branch has a merged PR into main
- THEN autopilot SHALL transition every entry in that batch to published
- AND it SHALL record merge metadata sufficient for audit and later reconciliation

### Requirement: Publisher autopilot SHALL use the existing conservative merge guard

Publisher autopilot SHALL NOT bypass branch protection or merge publisher PRs by ad hoc logic. It SHALL delegate merge eligibility to the existing gu-log auto-merge guard.

#### Scenario: Publisher PR checks are green and paths are allowlisted

- WHEN an open ready-for-review publisher PR targets main
- AND required checks are green
- AND the PR diff satisfies the existing auto-merge path guard
- THEN autopilot SHALL invoke the gu-log auto-merge guard for that PR

#### Scenario: Publisher PR checks are still pending

- WHEN an open publisher PR has not finished required checks
- THEN autopilot SHALL NOT treat that as fatal
- AND it SHALL leave the PR open for a later retry

#### Scenario: Publisher PR touches disallowed paths

- WHEN the auto-merge guard denies the PR because changed paths are outside the allowlist
- THEN autopilot SHALL NOT bypass that decision
- AND it SHALL leave the PR for explicit operator review

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
