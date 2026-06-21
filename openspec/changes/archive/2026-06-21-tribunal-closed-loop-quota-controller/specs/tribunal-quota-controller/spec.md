# tribunal-quota-controller Specification

## Purpose

定義閉迴路回饋控制器的行為規格——根據 Anthropic 訂閱的雙視窗（5 小時 / 7 天）剩餘額度和刷新時間，動態計算 tribunal worker 的派送節奏（cooldown 和 worker 數量），目標是在每個視窗刷新前將 floor 以上的額度全部用完。

## ADDED Requirements

### Requirement: Controller SHALL compute cooldown from dual ideal-consumption curves

Controller SHALL compute separate ideal-consumption curves for both the 5-hour and 7-day quota windows. 每條曲線的理想速率 = `(remaining_pct - QUOTA_FLOOR) / time_until_refresh_sec`。從速率換算出 cooldown = `ARTICLE_COST_PCT / rate`。

#### Scenario: Normal operation with both windows active
- **WHEN** 5hr_pct=59%, 5hr_resets_in=2.3hr, 7day_pct=55%, 7day_resets_in=16.9hr, floor=3%
- **THEN** controller computes two separate cooldown values from the two curves
- **AND** output cooldown is a positive number between MIN_COOLDOWN and MAX_COOLDOWN

#### Scenario: 5-hour window under pressure while weekly is comfortable
- **WHEN** 5hr_pct=10%, 5hr_resets_in=1hr, 7day_pct=60%, 7day_resets_in=5days
- **THEN** 5hr curve produces a higher cooldown than 7day curve
- **AND** 5hr curve dominates as the binding constraint

#### Scenario: Weekly window under pressure while 5-hour is comfortable
- **WHEN** 5hr_pct=80%, 5hr_resets_in=4hr, 7day_pct=8%, 7day_resets_in=2days
- **THEN** 7day curve produces a higher cooldown than 5hr curve
- **AND** 7day curve dominates as the binding constraint

### Requirement: Controller SHALL account for in-flight quota commitment

Controller SHALL subtract estimated in-flight quota (`active_workers * ARTICLE_COST_PCT`) from `remaining_pct` before computing the ideal rate. This prevents over-commitment when usage-monitor cache (2-min TTL) lags behind actual consumption.

#### Scenario: Two workers already in-flight
- **WHEN** remaining_pct=50% (from usage-monitor), active_workers=2, ARTICLE_COST_PCT=5.0
- **THEN** effective_remaining = 50% - (2 * 5.0%) = 40%
- **AND** rate is computed from effective_remaining=40%, not raw remaining=50%

#### Scenario: No workers in-flight
- **WHEN** remaining_pct=50%, active_workers=0
- **THEN** effective_remaining = 50% (no adjustment)

#### Scenario: In-flight adjustment pushes effective below floor
- **WHEN** remaining_pct=10%, active_workers=2, ARTICLE_COST_PCT=5.0, floor=3%
- **THEN** effective_remaining = 10% - 10% = 0% (below floor)
- **AND** controller returns MAX_COOLDOWN and workers=0 (wait for in-flight to finish)

### Requirement: Controller SHALL handle inactive quota windows

Controller SHALL handle the case where a quota window has no active session (resets_at is null, missing, or in the past). An inactive window means its quota is fully available and SHALL NOT constrain dispatch.

#### Scenario: 5-hour window not active (no recent usage)
- **WHEN** 5hr resets_at is null or in the past
- **THEN** 5hr curve produces cooldown=MIN_COOLDOWN (window fully available, no constraint)
- **AND** only the 7-day curve determines the output cooldown

#### Scenario: Both windows inactive (fresh start after long idle)
- **WHEN** both resets_at are null or in the past
- **THEN** cooldown=MIN_COOLDOWN (all quota available, go full speed)

#### Scenario: 7-day window inactive but 5-hour window active
- **WHEN** 7day resets_at is in the past, 5hr_pct=30%, 5hr_resets_in=2hr
- **THEN** only 5hr curve is binding
- **AND** 7day does not constrain

### Requirement: Controller SHALL take the more conservative of two curves

Controller SHALL output the more conservative (longer) cooldown of the two curves: `max(cooldown_5hr, cooldown_7day)`，確保不會在任一視窗上超額消耗。

#### Scenario: 5hr curve is more restrictive
- **WHEN** 5hr curve produces cooldown=300s AND 7day curve produces cooldown=60s
- **THEN** output cooldown=300s
- **AND** binding_constraint="five_hour"

#### Scenario: 7day curve is more restrictive
- **WHEN** 5hr curve produces cooldown=30s AND 7day curve produces cooldown=120s
- **THEN** output cooldown=120s
- **AND** binding_constraint="seven_day"

#### Scenario: Both curves produce similar cooldowns
- **WHEN** 5hr curve produces cooldown=45s AND 7day curve produces cooldown=50s
- **THEN** output cooldown=50s (the larger value)

### Requirement: Controller SHALL naturally stop at quota floor

Controller SHALL return MAX_COOLDOWN and 0 workers when any window's remaining quota ≤ QUOTA_FLOOR (3%)，不需要獨立的 STOP 狀態——公式自然歸零。

#### Scenario: Both windows at floor
- **WHEN** 5hr_pct=3%, 7day_pct=2%
- **THEN** cooldown=MAX_COOLDOWN (1800s)
- **AND** recommended_workers=0

#### Scenario: Barely above floor
- **WHEN** 5hr_pct=4%, 7day_pct=4%, floor=3%
- **THEN** cooldown is very high (close to MAX_COOLDOWN) but finite
- **AND** recommended_workers=1 (minimum possible)

#### Scenario: One window at floor, other comfortable
- **WHEN** 5hr_pct=2% (below floor), 7day_pct=40%
- **THEN** cooldown=MAX_COOLDOWN (5hr usable ≤ 0 → rate=0 → stop)
- **AND** recommended_workers=0

### Requirement: Controller SHALL accelerate near window refresh

Controller SHALL accelerate dispatch rate as `time_until_refresh` approaches zero — the formula `usable / time` naturally drives cooldown toward MIN_COOLDOWN，不需要特殊加速邏輯。

#### Scenario: Window about to refresh with significant remaining quota
- **WHEN** 7day_pct=20%, 7day_resets_in=5min, floor=3%
- **THEN** 7day rate = 17% / 300s → very high rate
- **AND** cooldown approaches MIN_COOLDOWN (10s)

#### Scenario: Window about to refresh with minimal remaining quota
- **WHEN** 7day_pct=4%, 7day_resets_in=2min, floor=3%
- **THEN** 7day rate = 1% / 120s → moderate rate
- **AND** cooldown is moderate (not aggressive burn since only 1% above floor)

#### Scenario: Window refresh imminent (< 1 min)
- **WHEN** time_until_refresh=30s, remaining=10%, floor=3%, ARTICLE_COST_PCT=5.0
- **THEN** rate = 7% / 30s = 0.233 %/s
- **AND** cooldown = 5.0 / 0.233 = 21.4s → clamped to MIN_COOLDOWN (10s)

### Requirement: Controller SHALL self-calibrate article cost from history

Controller SHALL self-calibrate ARTICLE_COST_PCT (average quota % consumed per article) using EMA (alpha=0.3) from quota-history.jsonl entries.

#### Scenario: Cold start with no history
- **WHEN** quota-history.jsonl has fewer than 5 entries
- **THEN** ARTICLE_COST_PCT uses conservative default (5.0 — deliberately high to prevent cold-start quota burn; EMA will converge within 5-10 articles)

#### Scenario: Warm state with sufficient history
- **WHEN** quota-history.jsonl has ≥ 5 entries with valid pre/post quota deltas
- **THEN** ARTICLE_COST_PCT = EMA of observed (pre_pct - post_pct) values
- **AND** alpha=0.3 (recent observations weighted more)

#### Scenario: Observed cost deviates significantly from calibration
- **WHEN** a single article consumes 3x the current ARTICLE_COST_PCT
- **THEN** EMA smooths the outlier (new value shifts ~30% toward the outlier)
- **AND** next cooldown adjusts accordingly

### Requirement: System SHALL log every quota reading to quota-history.jsonl

System SHALL append a JSONL entry to `.score-loop/state/quota-history.jsonl` on every controller_tick execution，記錄完整的量測值和決策結果。

#### Scenario: Normal logging after article dispatch
- **WHEN** controller_tick completes
- **THEN** a JSONL entry is appended containing: ts, five_hr_pct, five_hr_resets_at, seven_day_pct, seven_day_resets_at, extra_used_usd, extra_limit_usd, cooldown_sec, recommended_workers, binding_constraint, article_cost_pct, event

#### Scenario: Daemon startup rotation
- **WHEN** daemon starts
- **THEN** entries older than 7 days are removed from quota-history.jsonl
- **AND** remaining entries are preserved intact

#### Scenario: Log survives daemon restart
- **WHEN** daemon restarts
- **THEN** new entries are appended after existing ones (no truncation)

### Requirement: System SHALL write controller state for observability

System SHALL overwrite `.score-loop/state/quota-controller.json` after every controller decision，提供即時觀測。

#### Scenario: Normal state update
- **WHEN** controller_tick completes successfully
- **THEN** quota-controller.json contains: mode="pacing", five_hr_pct, seven_day_pct, cooldown_sec, recommended_workers, binding_constraint, article_cost_pct, updatedAt

#### Scenario: Usage-monitor unavailable
- **WHEN** usage-monitor.sh returns error or is unreachable
- **THEN** quota-controller.json contains: mode="fallback"
- **AND** cooldown defaults to 600s (10 minutes)
- **AND** recommended_workers=1

### Requirement: Controller SHALL enforce extra-usage safety valve

Controller SHALL monitor Anthropic extra usage (pay-per-use beyond subscription). When `extra_used_usd / extra_limit_usd > 0.8` (80% of monthly extra budget consumed), controller SHALL enter MAX_COOLDOWN to prevent bill overrun.

#### Scenario: Extra usage approaching limit
- **WHEN** extra_used_usd=85, extra_limit_usd=100 (85% consumed)
- **THEN** cooldown=MAX_COOLDOWN, recommended_workers=0
- **AND** state shows mode="extra_limit"

#### Scenario: Extra usage within budget
- **WHEN** extra_used_usd=50, extra_limit_usd=100 (50% consumed)
- **THEN** extra usage does not constrain controller
- **AND** normal dual-curve pacing applies

#### Scenario: Extra usage not enabled
- **WHEN** extra_usage.is_enabled=false
- **THEN** extra usage check is skipped entirely

### Requirement: System SHALL preserve legacy fallback

System SHALL support a `--legacy-quota` flag that preserves the old binary GO/STOP logic as an emergency fallback.

#### Scenario: Legacy mode activated
- **WHEN** daemon started with `--legacy-quota` flag
- **THEN** system uses old binary GO/STOP logic (GO if >3%, STOP if ≤3%)
- **AND** no quota-history.jsonl entries are written
- **AND** no quota-controller.json state is written

#### Scenario: Fallback on usage-monitor error without legacy flag
- **WHEN** usage-monitor.sh returns error AND `--legacy-quota` is NOT set
- **THEN** controller enters fallback mode (cooldown=600s, workers=1)
- **AND** state file shows mode="fallback"
- **AND** system retries usage-monitor on next dispatch cycle
