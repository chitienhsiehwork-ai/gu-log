## ADDED Requirements

### Requirement: Tribunal long-running runtime SHALL use a quota-aware loop

Tribunal 的常駐執行模式 SHALL 以 quota-aware loop 作為正式 runtime，持續掃描未完成文章、依 quota 狀態決定是否 dispatch 新 article。one-shot batch runner MAY 保留作為 cron / manual bounded execution，但 SHALL NOT 被視為 long-running daemon 的唯一入口。

#### Scenario: Quota loop 作為常駐入口

- **WHEN** operator 需要讓 tribunal 整天執行
- **THEN** 系統 SHALL 使用 quota-aware loop runtime
- **AND** runtime SHALL 在 quota 高於 floor 且存在待處理 article 時持續 dispatch 新 article
- **AND** runtime SHALL 在 quota 不足或沒有待處理 article 時進入 wait，而不是永久退出

#### Scenario: Batch runner 保持 bounded 語意

- **WHEN** operator 以 `tribunal-batch-runner.sh --max N` 啟動 tribunal
- **THEN** runner SHALL 在處理至多 `N` 篇 article 後退出
- **AND** 此退出 SHALL 被視為正常 bounded completion，而不是 daemon stop

---

### Requirement: Tribunal SHALL support graceful stop by request

Tribunal runtime SHALL 支援 operator 發出 graceful stop 請求。收到 stop 請求後，runtime SHALL 進入 draining 模式，SHALL NOT dispatch 新 article，但 MAY 讓 current in-flight article 跑到安全邊界後再退出。

#### Scenario: Stop request 在 article dispatch 前生效

- **WHEN** runtime 尚未 dispatch 下一篇 article
- **AND** operator 發出 graceful stop 請求
- **THEN** runtime SHALL NOT 開始新的 article run
- **AND** runtime SHALL 退出並記錄 `stopped_by_request`

#### Scenario: Stop request 在 article 執行中生效

- **WHEN** runtime 正在處理某篇 article
- **AND** operator 發出 graceful stop 請求
- **THEN** runtime SHALL 進入 `draining` 狀態
- **AND** current article SHALL 繼續執行到 article 邊界
- **AND** article 完成後 runtime SHALL 退出
- **AND** runtime SHALL NOT dispatch 下一篇 article

---

### Requirement: Graceful stop safety boundary SHALL be the current article

Graceful stop 的最小 drain 單位 SHALL 是 current article，而不是 current stage、current judge call、或 current sleep block。runtime SHALL 只在 article 尚未開始、article 已完成、或 wait 狀態時退出。

#### Scenario: 不可停在 stage 中途

- **WHEN** article 正在進行 judge / rewrite / build / frontmatter write
- **AND** runtime 收到 graceful stop 請求
- **THEN** runtime SHALL NOT 以此請求直接中止當前 stage
- **AND** runtime SHALL 延後退出到 article 完成後

#### Scenario: Wait state 可立即停止

- **WHEN** runtime 處於 no-article wait、quota-stop wait、或 quiet-hours wait
- **AND** operator 發出 graceful stop 請求
- **THEN** runtime SHALL 在下一次 wait slice 醒來時退出
- **AND** SHALL NOT 等整個 10 分鐘或 30 分鐘 sleep 結束才反應

---

### Requirement: Graceful stop SHALL support both signal and file-based control

Tribunal runtime SHALL 同時接受：
- process signal（至少 `SIGTERM`、`SIGINT`）
- file-based stop flag

兩者都 SHALL 觸發同一套 graceful stop semantics：`stop_requested=true`、進入 draining、停止派新工作、在安全邊界退出。

#### Scenario: systemd stop 透過 SIGTERM 觸發 graceful stop

- **WHEN** service manager 對 tribunal runtime 發送 `SIGTERM`
- **THEN** runtime SHALL 將此視為 graceful stop request
- **AND** SHALL 進入 `draining`
- **AND** SHALL 在安全邊界退出

#### Scenario: Operator 透過 stop flag 觸發 graceful stop

- **WHEN** operator 建立 runtime 定義的 stop flag 檔案
- **THEN** runtime SHALL 在下一個 control check 看到該 flag
- **AND** SHALL 進入 `draining`
- **AND** SHALL 在安全邊界退出

---

### Requirement: Long waits SHALL be interruptible

任何大於短 cooldown 的等待（例如 no-article、quota-stop、quota-unreadable、quiet-hours）SHALL 使用 interruptible wait，而不是單次長 sleep。interruptible wait SHALL 以短切片週期檢查 stop request 與當前等待條件。

#### Scenario: Quota-stop wait 可被 stop request 打斷

- **WHEN** runtime 因 quota 低於 floor 而進入等待
- **AND** operator 在等待期間發出 stop request
- **THEN** runtime SHALL 在下一個 wait slice 退出
- **AND** SHALL 記錄 `stopped_by_request`

#### Scenario: Quiet-hours wait 可被 stop request 打斷

- **WHEN** runtime 因 quiet hours 而等待
- **AND** operator 發出 stop request
- **THEN** runtime SHALL 不必等 quiet hours 結束
- **AND** SHALL 在下一個 wait slice 退出

---

### Requirement: Runtime SHALL emit explicit lifecycle states

Tribunal runtime SHALL 在 log 或 state artifact 中明確區分至少以下 lifecycle states：
- `running`
- `draining`
- `idle_wait`
- `stopped_by_request`
- `stopped_by_quota`

#### Scenario: Operator 能分辨 stop 原因

- **WHEN** runtime 結束或進入等待
- **THEN** log / state SHALL 清楚標示是 operator request、quota stop、還是 idle wait
- **AND** operator SHALL 能從輸出判斷「它是被要求停下」還是「只是暫停等待條件恢復」
