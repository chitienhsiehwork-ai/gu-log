## 1. Controller 核心函式（scripts/tribunal-quota-loop.sh）

- [ ] 1.1 加 `get_dual_quota_readings()` — 呼叫 `usage-monitor.sh --json`，回傳 5hr_pct, 5hr_resets_at, 7day_pct, 7day_resets_at, extra_used, extra_limit（分開回傳，不取 min）
- [ ] 1.2 加 `compute_ideal_rate()` — 輸入 remaining_pct, floor_pct, time_until_refresh_sec，回傳 %/秒 速率。usable ≤ 0 回傳 0
- [ ] 1.3 加 `controller_tick()` — 前饋補償（扣 active_workers * ARTICLE_COST_PCT）+ 雙軌 compute_ideal_rate + 取 max(cooldown)，回傳 cooldown_sec 和 recommended_workers
- [ ] 1.4 加 inactive window 處理 — resets_at 為 null 或過去時間時，該視窗 cooldown=MIN_COOLDOWN（不構成限制）
- [ ] 1.5 加 extra usage 安全閥 — extra_used/extra_limit > 80% 時回傳 MAX_COOLDOWN, workers=0
- [ ] 1.6 加 `quota_history_append()` — 追加 JSONL 行到 `.score-loop/state/quota-history.jsonl`
- [ ] 1.7 加 `quota_controller_write_state()` — 覆寫 `.score-loop/state/quota-controller.json`

## 2. 自動校準

- [ ] 2.1 加 `calibrate_article_cost()` — 讀 quota-history.jsonl 的 dispatch/complete 配對，用 EMA (alpha=0.3) 算 ARTICLE_COST_PCT
- [ ] 2.2 冷啟動邏輯：history 不足 5 筆時回傳保守預設 5.0（偏高防超燒）
- [ ] 2.3 每篇文章完成後呼叫 calibrate，更新 controller 內部的 ARTICLE_COST_PCT
- [ ] 2.4 校準只在 single-worker 模式下計算 delta（多 worker 時 delta 混雜，跳過校準）

## 3. 整合到主迴圈

- [ ] 3.1 移除 `compute_sleep()` 和 `compute_tier_name()` 函式
- [ ] 3.2 移除 STOP block（30 分鐘輪詢 + RESUME_THRESHOLD 10% 遲滯邏輯）
- [ ] 3.3 在 dispatch 迴圈頂端呼叫 `controller_tick()`，傳入 active_workers 數量
- [ ] 3.4 用回傳的 cooldown_sec 取代固定 10s cooldown
- [ ] 3.5 recommended_workers 跟記憶體 autoscale 的 effective_workers 取 `min()`
- [ ] 3.6 加 `--legacy-quota` CLI 旗標：啟用時跳過 controller，使用舊 GO/STOP 邏輯
- [ ] 3.7 usage-monitor 不可用時進入 fallback 模式（cooldown=600s, workers=1, state="fallback"）

## 4. Batch runner 修復

- [ ] 4.1 移除 `scripts/tribunal-batch-runner.sh` 中壞掉的 `claude --usage` 呼叫
- [ ] 4.2 改用 `usage-monitor.sh --json` 或 `get_dual_quota_readings()` 查額度

## 5. 觀測與文件

- [ ] 5.1 寫 `scripts/tests/test-quota-controller.sh`，至少涵蓋以下 test cases：
  - dual curve computation（正常雙視窗）
  - conservative merge（5hr vs 7day 哪個 binding）
  - floor stop（remaining ≤ 3%）
  - near-refresh acceleration（time < 5min）
  - inactive window handling（resets_at null/past）
  - in-flight feedforward compensation（active workers 扣除）
  - cold start default（ARTICLE_COST_PCT=5.0）
  - extra usage safety valve（> 80%）
  - legacy mode bypass
  - fallback on error
- [ ] 5.2 啟動時 rotate quota-history.jsonl — 清除 7 天以上的舊紀錄
- [ ] 5.3 更新 `docs/tribunal-runbook.md` — 加 Quota Controller 章節
- [ ] 5.4 更新 `openspec/specs/tribunal-run-control/spec.md` — 用 delta spec 的內容合併更新

## 6. 驗證

- [ ] 6.1 `openspec validate tribunal-closed-loop-quota-controller` 通過
- [ ] 6.2 `openspec validate --all` 通過
- [ ] 6.3 `bash scripts/tests/test-quota-controller.sh` 全部 PASS
- [ ] 6.4 部署前手動跑 1-2 篇文章，記錄 pre/post quota delta，確認 ARTICLE_COST_PCT 量級
- [ ] 6.5 VPS 上跑 1 worker 處理 2-3 篇文章，確認 quota-history.jsonl 正確寫入、cooldown 動態調整
