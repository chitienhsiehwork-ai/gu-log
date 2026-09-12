## ADDED Requirements

### Requirement: 無合法自動修復動作的 Tribunal 失敗 SHALL 進入綁定 revision 的 NEEDS_REVIEW

當 judge 已產生合法的內容失敗判定，且文章政策明確禁止任何可改變讀者可見輸入的自動修復動作時，Tribunal SHALL 將文章轉為現行 Tribunal 版本的 `NEEDS_REVIEW`，而非再次自動評分或以 `EXHAUSTED` 表示。終態 SHALL 綁定失敗階段與 reader-visible revision、保留真實失敗證據，SHALL NOT 增加頂層內容嘗試次數，且 SHALL NOT 假造 PASS。只有 GP source-preservation no-rewrite policy 符合此自動 transition；其他 no-rewrite invocation 或 operational failure SHALL NOT 被推論為相同終態。

#### Scenario: GP 首次有效失敗後停止自動重派

- **WHEN** GP 文章在 source-preservation policy 禁止自動改寫時收到符合 schema 的 judge 失敗判定
- **THEN** runner SHALL 原子寫入現行 Tribunal 版本的 `NEEDS_REVIEW`、失敗階段、reader revision 與 machine-readable reason
- **AND** SHALL 保留真實的失敗分數證據
- **AND** SHALL NOT 增加頂層內容嘗試次數
- **AND** quota loop、bounded batch runner 與同 revision 的手動執行 SHALL NOT 再次呼叫 judge

#### Scenario: Score-only GP 失敗維持診斷用途

- **WHEN** GP 文章在 `--score-only` 診斷模式得到符合 schema 的 judge 失敗判定
- **THEN** runner SHALL 維持既有不具權威性的 rc `1`
- **AND** SHALL NOT 寫入 authoritative `NEEDS_REVIEW`
- **AND** SHALL NOT 回報 exit code `3`

#### Scenario: 後端分數 metadata 不會解除 NEEDS_REVIEW

- **WHEN** `NEEDS_REVIEW` 文章只有 Tribunal 分數、model provenance、timestamp 或其他非 reader-visible metadata 改變
- **THEN** reader revision SHALL 維持相同
- **AND** 文章 SHALL 維持 `NEEDS_REVIEW`
- **AND** scheduler SHALL NOT 把 metadata 寫入視為修稿後的重新評分資格

#### Scenario: Reader-visible 修正重新開案

- **WHEN** 現行 Tribunal 版本的 `NEEDS_REVIEW` 文章，其 reader-visible canonical content 已改變
- **THEN** runner 與 scheduler SHALL 將它視為可重新評分
- **AND** SHALL 清除舊 terminal transition 對新 revision 的阻擋
- **AND** 新 revision SHALL 從必要階段重新接受真實 judges 判定

#### Scenario: Operator 明確 requeue 同 revision

- **WHEN** operator 對現行 Tribunal 版本的 `NEEDS_REVIEW` 文章執行明確 requeue command
- **THEN** progress ledger SHALL 在同一把 progress lock 下記錄 requeue timestamp、reason 與遞增 count
- **AND** SHALL 保留既有失敗證據
- **AND** 下一次 dispatch SHALL 允許恰好一次重新判斷
- **AND** 若同 revision 再次得到有效且無可修復的失敗判定，文章 SHALL 再次回到 `NEEDS_REVIEW`

#### Scenario: Tribunal contract 版本更新重新開案

- **WHEN** 文章儲存的 Tribunal 版本低於現行 Tribunal 版本
- **THEN** 既有版本重設 contract SHALL 優先重新開案
- **AND** 舊版 `NEEDS_REVIEW` SHALL NOT 永久阻擋新版 contract 的重新判斷

#### Scenario: Judge 執行期間 reader revision 漂移

- **WHEN** runner 在 judge 前取得 revision A，但 terminal transition 前 current revision 已變為 B
- **THEN** runner SHALL NOT 把針對 revision A 的失敗判定綁成 revision B 的 `NEEDS_REVIEW`
- **AND** SHALL NOT 增加頂層內容嘗試次數
- **AND** SHALL 以可觀測的 operational outcome 結束，讓 revision B 之後接受完整重新評分

#### Scenario: Reader revision 無法計算

- **WHEN** manual runner 或任一 scheduler 無法讀取 post 或計算 reader revision
- **THEN** 該路徑 SHALL fail closed 且 SHALL NOT 呼叫 judge
- **AND** SHALL NOT 覆蓋既有失敗或終態證據
- **AND** SHALL 輸出可採取行動的 operational warning 或 error，而非 `NEEDS_REVIEW`

### Requirement: 操作性失敗 SHALL NOT 被誤分類為 NEEDS_REVIEW

Quota suspension、timeout、runner crash、unreadable output、malformed score、lock collision、stop request、writer infrastructure failure 與其他未產生符合 schema 內容失敗判定的 operational outcome SHALL 保留既有可恢復或 drain 語意。Tribunal SHALL NOT 只因 `ALLOW_REWRITE=0`、`--only-stage`、`--score-only` 或 writer unavailable 就建立 `NEEDS_REVIEW`。

#### Scenario: Malformed judge output remains runner error

- **WHEN** judge 沒有產生符合 schema 的分數或 runner 無法讀取結果
- **THEN** 文章 SHALL 使用既有 `RUNNER_ERROR` 或對應 operational outcome
- **AND** SHALL NOT 寫入內容型 `NEEDS_REVIEW`
- **AND** SHALL NOT 增加頂層內容嘗試次數

#### Scenario: Non-GP judge-only run fails

- **WHEN** non-GP 文章以 `--only-stage` 或其他 judge-only mode 得到有效失敗判定
- **THEN** runner SHALL 保留既有 bounded/manual failure 語意
- **AND** SHALL NOT 套用 GP source-preservation 的 `NEEDS_REVIEW` reason

#### Scenario: Non-GP rewrite path remains bounded

- **WHEN** non-GP 文章的 policy 允許 writer 修復且 judge 回報有效失敗判定
- **THEN** Tribunal SHALL 繼續使用既有 bounded rewrite、rejudge 與頂層嘗試 contract
- **AND** 此變更 SHALL NOT 提前把該文章終止為 `NEEDS_REVIEW`

### Requirement: NEEDS_REVIEW SHALL 可觀測且不得發布

Canonical scheduler、publisher status 與 monitor snapshot SHALL 把現行 Tribunal 版本的 `NEEDS_REVIEW` 與 `FAILED`、`EXHAUSTED`、`RUNNER_ERROR` 分開呈現。發布器 SHALL 讀取現行 Tribunal 版本，且只選文章層級 status=`PASS`、儲存的 Tribunal 版本不舊於現行版本的項目；任何現存 PASS 階段或舊 PASS metadata 都不得覆蓋文章層級 `NEEDS_REVIEW`。

#### Scenario: Supervisor receives NEEDS_REVIEW exit code

- **WHEN** per-article runner 以 exit code `3` 回報 `NEEDS_REVIEW`
- **THEN** supervisor SHALL 記錄文章與 manual-review outcome
- **AND** SHALL 繼續處理其他安全文章
- **AND** SHALL NOT 把 exit code `3` 計為 PASS、generic failure 或要求全域 drain 的 runner error

#### Scenario: Publisher sees stale PASS evidence and current NEEDS_REVIEW

- **WHEN** progress ledger 的現行文章層級 status 是 `NEEDS_REVIEW`，但文章仍含舊 PASS 階段或分數 metadata
- **THEN** publisher SHALL NOT 建立 publish candidate、branch、commit 或 PR
- **AND** status output SHALL 將該文章計入獨立的 `NEEDS_REVIEW` 數量

#### Scenario: 發布器看到舊版文章層級 PASS

- **WHEN** progress ledger 的文章層級 status 是 `PASS`，但儲存的 Tribunal 版本低於現行 Tribunal 版本
- **THEN** publisher SHALL NOT 建立 publish candidate、branch、commit 或 PR
- **AND** SHALL 將該文章留給現行 Tribunal 版本重新處理

#### Scenario: Operator inspects monitor snapshot

- **WHEN** runtime ledger 含有一筆或多筆 `NEEDS_REVIEW`
- **THEN** monitor snapshot SHALL 顯示 distinct count
- **AND** 近期終態項目 SHALL 包含文章、失敗階段、終態原因與 timestamp，不得輸出 source content 或 secret
