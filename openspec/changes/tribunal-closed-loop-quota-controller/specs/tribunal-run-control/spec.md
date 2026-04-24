# tribunal-run-control — Delta Spec

Changes to existing tribunal-run-control specification for the closed-loop quota controller.

## MODIFIED Requirements

### Requirement: Tribunal long-running runtime SHALL use a quota-aware loop

Tribunal 的常駐執行模式 SHALL 以 quota-aware loop 作為正式 runtime，持續掃描未完成文章、依 quota 狀態決定是否 dispatch 新 article。one-shot batch runner MAY 保留作為 cron / manual bounded execution，但 SHALL NOT 被視為 long-running daemon 的唯一入口。

**Quota-aware loop SHALL 使用閉迴路回饋控制器（定義於 `tribunal-quota-controller` spec）取代二元 GO/STOP 邏輯。** Runtime SHALL 在每次 dispatch 前呼叫 controller，根據回傳的 cooldown_sec 和 recommended_workers 調整派送節奏。

#### Scenario: Quota loop 作為常駐入口

- **WHEN** operator 需要讓 tribunal 整天執行
- **THEN** 系統 SHALL 使用 quota-aware loop runtime
- **AND** runtime SHALL 在每次 dispatch 前呼叫 controller 計算 cooldown
- **AND** runtime SHALL 按 controller 回傳的 cooldown_sec 等待後再 dispatch 下一篇
- **AND** runtime SHALL 在 controller 回傳 workers=0 時進入 wait，而不是永久退出

#### Scenario: Batch runner 保持 bounded 語意

- **WHEN** operator 以 `tribunal-batch-runner.sh --max N` 啟動 tribunal
- **THEN** runner SHALL 在處理至多 `N` 篇 article 後退出
- **AND** 此退出 SHALL 被視為正常 bounded completion，而不是 daemon stop

#### Scenario: Controller 取代舊 GO/STOP 二元制

- **WHEN** runtime 查詢 quota 狀態
- **THEN** runtime SHALL NOT 使用舊的 compute_sleep() / compute_tier_name() 二元邏輯
- **AND** runtime SHALL 使用 controller_tick() 回傳的連續值
- **AND** RESUME_THRESHOLD (10%) 遲滯邏輯 SHALL 被移除（controller 自然漸進加速取代）

### Requirement: Runtime SHALL emit explicit lifecycle states

Tribunal runtime SHALL 在 log 或 state artifact 中明確區分至少以下 lifecycle states：
- `running`
- `draining`
- `idle_wait`
- `stopped_by_request`
- `stopped_by_quota`
- `pacing` (NEW — controller 在連續調速中)
- `fallback` (NEW — usage-monitor 不可用，使用保守預設)

#### Scenario: Operator 能分辨 stop 原因

- **WHEN** runtime 結束或進入等待
- **THEN** log / state SHALL 清楚標示是 operator request、quota floor、controller pacing、fallback、還是 idle wait
- **AND** operator SHALL 能從輸出判斷「它是被要求停下」還是「controller 正在調速」還是「只是暫停等待條件恢復」

#### Scenario: Controller pacing 狀態可觀測

- **WHEN** controller 正在連續調速中
- **THEN** state SHALL 顯示 `pacing` 而非舊的 `running`
- **AND** quota-controller.json SHALL 包含 cooldown_sec 和 binding_constraint
