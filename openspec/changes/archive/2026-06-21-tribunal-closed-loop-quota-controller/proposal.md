## Why

Tribunal 的額度管理目前是二元制 GO/STOP：剩餘額度 > 3% 就全力燒（10 秒 cooldown），≤ 3% 就完全停機（每 30 分鐘輪詢一次）。473+ 篇待評文章的積壓下，這個策略會在幾小時內燒光整個視窗的額度，然後閒置到下次刷新。**閒置的額度就是浪費的錢。**

需要一個閉迴路回饋控制器，讓系統根據「剩餘額度 vs 剩餘時間」的理想消耗曲線動態調速——太快就降速、太慢就加速——目標是刷新前 1 分鐘剛好把 floor 以上的額度全部用完。

## What Changes

- **新增閉迴路控制器**：取代 `compute_sleep()` 和 `compute_tier_name()` 的二元 GO/STOP 邏輯，改為連續調速。每次派 worker 前計算理想 cooldown 和建議 worker 數。
- **雙軌制（5 小時 + 7 天視窗）**：分別對兩個 Anthropic 額度視窗各算一條理想消耗曲線，取較保守的輸出（`max(cooldown_5hr, cooldown_7day)`）。
- **額度歷史紀錄**：每次量測追加到 `.score-loop/state/quota-history.jsonl`，留下可追蹤的證據，長期可偵測額度總量變化。
- **Controller 狀態檔**：`.score-loop/state/quota-controller.json` 即時顯示控制器狀態（mode、cooldown、binding constraint）。
- **自動校準**：每篇文章的實際額度消耗用 EMA 回饋到 `ARTICLE_COST_PCT`，冷啟動用保守預設。
- **修復 batch runner 壞掉的額度查詢**：`claude --usage` 不存在，改用 `usage-monitor.sh --json`。
- **Legacy 退路**：加 `--legacy-quota` 旗標保留舊 GO/STOP 行為。

## Capabilities

### New Capabilities
- `tribunal-quota-controller`: 閉迴路回饋控制器——雙軌理想曲線計算、連續調速、額度歷史紀錄、自動校準、controller 狀態觀測

### Modified Capabilities
- `tribunal-run-control`: 更新 "quota-aware loop" requirement，從 GO/STOP 二元制改為連續控制。移除 RESUME_THRESHOLD 遲滯邏輯（controller 自然漸進加速取代）。

## Impact

- **scripts/tribunal-quota-loop.sh** — 主要修改目標：移除 GO/STOP 邏輯，加入 controller 函式，整合到 dispatch 迴圈
- **scripts/tribunal-batch-runner.sh** — 修復壞掉的 `claude --usage`，改用 `usage-monitor.sh`
- **docs/tribunal-runbook.md** — 新增 Quota Controller 操作章節
- **openspec/specs/tribunal-run-control/spec.md** — 更新 quota-aware requirement
- **依賴**：VPS 上的 `~/clawd/scripts/usage-monitor.sh`（已存在，打 `api.anthropic.com/api/oauth/usage`，有 2 分鐘快取）
- **不影響**：graceful stop、記憶體 autoscaling、worker worktree 管理、claim 鎖——這些機制維持不變
