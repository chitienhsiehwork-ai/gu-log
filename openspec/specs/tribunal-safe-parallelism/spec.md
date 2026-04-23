# tribunal-safe-parallelism Specification

## Purpose
TBD - created by archiving change tribunal-safe-parallelism. Update Purpose after archive.
## Requirements
### Requirement: Tribunal parallelism SHALL run at article granularity

Tribunal 的平行化 SHALL 以 article 為單位。每個 worker 一次處理一篇完整 article；系統 SHALL NOT 在單篇 article 內把 judges / stages 分拆給多個 workers 並行處理。

#### Scenario: Two workers process two different articles

- **WHEN** runtime 設定 `workers = 2`
- **AND** backlog 至少有兩篇待處理 article
- **THEN** worker A MAY 處理 article X，worker B MAY 處理 article Y
- **AND** 每個 worker SHALL 對自己那篇文章跑完整 tribunal lifecycle

---

### Requirement: Article dispatch SHALL use exclusive claiming

在任何時間點，每篇 article SHALL 只被一個 worker claim。worker 在開始執行前 SHALL 先完成 atomic claim；claim 失敗者 SHALL 不得執行該 article。

#### Scenario: 兩個 workers 同時看見同一篇 article

- **WHEN** worker A 與 worker B 幾乎同時嘗試取得 article X
- **THEN** 只有其中一個 worker SHALL claim 成功
- **AND** 另一個 worker SHALL 收到 `already_claimed` / `already_running` 類型結果
- **AND** 失敗者 SHALL 改挑下一篇或回到 idle，而不是繼續執行 article X

#### Scenario: Claimed article 完成後釋放 ownership

- **WHEN** worker 完成 article X（不論 PASS、FAIL、或 EXHAUSTED）
- **THEN** article X 的 claim SHALL 被釋放
- **AND** 其他 worker 之後才可重新評估是否需要處理該 article

---

### Requirement: Collision SHALL be reported as skipped, not success

若 worker 嘗試執行一篇已被 claim 或已被另一個 tribunal instance 鎖住的 article，系統 SHALL 回報 `skipped` / `already_running` 類型結果，SHALL NOT 把此情況記為 PASS、success、或 processed completion。

#### Scenario: Per-article lock collision

- **WHEN** `tribunal-all-claude.sh` 發現 article X 已有 tribunal lock
- **THEN** script SHALL 回傳明確的 collision / skipped 狀態碼
- **AND** 上層 runner SHALL 將其計為 `skipped`
- **AND** batch / supervisor summary SHALL NOT 增加 `passed`

---

### Requirement: Shared progress state SHALL be concurrency-safe

任何對 shared progress state 的 read-modify-write（包含 article status、stage status、topLevelAttempts）都 SHALL 在同一套序列化機制下執行，以避免 lost update。

#### Scenario: Two workers update different articles concurrently

- **WHEN** worker A 與 worker B 幾乎同時更新 shared progress state
- **THEN** 寫入序列化機制 SHALL 保證兩者的更新都被保留
- **AND** SHALL NOT 發生後寫入覆蓋前寫入的 lost update

#### Scenario: Stage progress 與 article status 共用一致鎖

- **WHEN** runtime 更新某篇文章的 stage status 與最終 article status
- **THEN** 這些寫入 SHALL 走同一套鎖定規則
- **AND** operator SHALL 不會看到 stage / article 狀態互相矛盾的半更新狀態

---

### Requirement: Parallel workers SHALL use isolated git worktrees

每個 parallel worker SHALL 在獨立 git worktree 中執行 rewrite、build、與 git side effects。兩個 workers SHALL NOT 共用同一個 repo working tree 進行 tribunal execution。

#### Scenario: Worker isolation during rewrite and build

- **WHEN** worker A 處理 article X，worker B 處理 article Y
- **THEN** worker A 的 rewrite / build 產物 SHALL 限制在 worktree A
- **AND** worker B 的 rewrite / build 產物 SHALL 限制在 worktree B
- **AND** 兩者 SHALL NOT 互相覆蓋 working tree 狀態

---

### Requirement: Shared sync side effects SHALL be serialized

即使 workers 使用獨立 worktrees，對共享 git branch / remote 的 sync side effects（例如 pull、rebase、push、或等效整合步驟）仍 SHALL 被序列化，以避免競態與衝突放大。

#### Scenario: Two workers finish near the same time

- **WHEN** worker A 與 worker B 幾乎同時完成各自文章
- **THEN** shared sync mechanism SHALL 序列化兩者的 push / integration
- **AND** SHALL NOT 無鎖同時 push 到同一個共享 branch

---

### Requirement: Parallel supervisor SHALL honor graceful drain semantics

Parallel supervisor SHALL 沿用 `tribunal-graceful-run-control` 定義的 graceful stop contract。收到 stop request 後，supervisor SHALL 停止 claim / dispatch 新 article，並等待所有 in-flight workers 完成 current article 後再退出。

#### Scenario: Stop request while two workers are active

- **WHEN** worker A 與 worker B 各自正在處理一篇 article
- **AND** operator 發出 graceful stop request
- **THEN** supervisor SHALL NOT 再 claim 新 article
- **AND** worker A 與 worker B SHALL 繼續執行到各自 current article 的 article boundary
- **AND** 兩者完成後 supervisor SHALL 退出

#### Scenario: One worker idle, one worker active during stop

- **WHEN** worker A 正在執行 article，worker B 處於 idle
- **AND** operator 發出 graceful stop request
- **THEN** worker B SHALL 保持 idle，不得再 claim 新 article
- **AND** worker A 完成 current article 後 supervisor SHALL 退出

