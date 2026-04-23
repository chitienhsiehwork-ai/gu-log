> **Status legend**（2026-04-24 更新）：`[READY]` 現在可做；`[DONE]` 已完成；`[WITHDRAWN]` 本 change 不再做、見 design.md 對應 Decision。`tribunal-safe-parallelism` 已在 2026-04-23 archive（PR #153–#156），原本 `[BLOCKED]` 的 Group 全放行。

## 1. Quota helper 抽共用 [READY]

- [ ] 1.1 新建 `scripts/tribunal-quota-lib.sh`，把 `get_effective_remaining()` / `compute_sleep()` / `compute_tier_name()` 從 `tribunal-quota-loop.sh` 搬過去
- [ ] 1.2 `tribunal-quota-loop.sh` 改 `source "$SCRIPT_DIR/tribunal-quota-lib.sh"`
- [ ] 1.3 `tribunal-batch-runner.sh` 拿掉假的 `claude --usage` 檢查，改 `source tribunal-quota-lib.sh` 用真 helper
- [ ] 1.4 兩邊共用 `QUOTA_FLOOR=3` / `RESUME_THRESHOLD=10` 常數（從 lib 匯出）

## 2. usage-monitor 去 VM 硬相依 [DONE]

- [x] 2.1 Vendor `~/clawd/scripts/usage-monitor.sh` 到 `scripts/usage-monitor.sh`（從 VM 拉最新版）
- [x] 2.2 VM-first / vendored fallback 解析（**暫時住在 `tribunal-quota-loop.sh`**；Group 1 完成時搬到 `tribunal-quota-lib.sh`）
- [x] 2.3 Daemon 啟動時 log 用的是哪一份（路徑 + mtime），方便除錯
- [x] 2.4 `scripts/usage-monitor.sh` 檔頭加 `VENDORED FROM` 區塊（路徑 + 日期 + 重新 vendor 指令）

## 3. Engine dispatch（shell 預設，TS opt-in shadow）[READY]

- [ ] 3.1 `tribunal-quota-loop.sh` worker `spawn_worker` 分岐加 `TRIBUNAL_ENGINE` env var（預設 `shell`、可設 `ts`）
- [ ] 3.2 `shell` 分岐保持現狀 `bash tribunal-all-claude.sh "$article"`；`ts` 分岐呼叫 `pnpm tribunal:run "$POST_PATH"`
- [ ] 3.3 `scripts/tribunal-v2-run.ts` 加 daemon-friendly exit codes：0 = PASS、1 = FAIL、3 = NEEDS_REVIEW、75 = skipped（已 claim）、77 = stopped by request、其他 = 系統錯誤
- [ ] 3.4 `scripts/tribunal-v2-run.ts` 加 `--json-status` mode，最後一行印 JSON 狀態（slug / 結果 / 每 stage loop 數 / quota 剩餘 / worker_id）給 daemon 解析
- [ ] 3.5 `scripts/tribunal-v2-run.ts` 支援 `claude-opus-4-6[1m]` / `claude-opus-4-7[1m]` model id（跟 shell engine parity）
- [ ] 3.6 Shadow 驗證：在 worktree 手動跑 1 ~ 2 篇 TS engine，對比同篇的 shell engine pipeline 結果（writer-constraints 未被違反、judge scores 差距 < 0.5）
- [ ] 3.7 **不**在本 change 內切 production 預設為 TS — 收錄到 design.md Open Questions，待 shadow 跑 20 篇 no-regression 後另起切換 PR

## 4. Feature branch + PR 模式 [WITHDRAWN]

見 design.md Decision 3（撤回理由）。Production 已用 `RC_PUSH_LOCK` 序列化 tribunal 直推 main，PR 逐篇 auto-merge 在 5-worker 吞吐量下變成 throughput ceiling + GitHub rate limit 風險。

- [~] 4.1 **撤回**：不做每篇一分支
- [~] 4.2 **撤回**：不做 auto-PR 開立
- [~] 4.3 **撤回**：不做 PR labeling
- [~] 4.4 **撤回**：不做 auto-merge
- [~] 4.5 **撤回**：不做 branch cleanup
- [~] 4.6 **撤回**：不做 fail-path push-branch

若未來某類 tribunal 結果要人工 gated review（例：model quality 事件後的 SP-175-aftermath 系列），會另起 `tribunal-gated-review` change 處理，**只對特定 tag** 走 PR 路徑。

## 5. 告警 [READY]

- [ ] 5.1 新建 `scripts/tribunal-alert.sh`，介面：`tribunal-alert.sh <severity> <title> <body>` — 讀 `TRIBUNAL_ALERT_WEBHOOK` env、無 webhook 時寫 `.score-loop/logs/alerts-<date>.log`
- [ ] 5.2 新建 `scripts/tribunal-alert@.service`（systemd template unit），呼叫 `tribunal-alert.sh crash $1 "..."`
- [ ] 5.3 `tribunal-loop.service` 加 `OnFailure=tribunal-alert@%n.service`
- [ ] 5.4 `tribunal-quota-loop.sh` STOP 迴圈內計時累計，`STOP_MINUTES > 720`（12h）時呼 `tribunal-alert.sh warning "long-stop" "..."`，同條件 1h 冷卻
- [ ] 5.5 `tribunal-quota-loop.sh` 連續 fail 計數，第 3 篇 fail 呼 `tribunal-alert.sh error "consecutive-fail" "..."`，觸發後重置計數
- [ ] 5.6 同 hash error 1h 冷卻，避免洗版

## 6. 指標 [READY]

Worker-aware layout：per-worker 寫 jsonl 免加 flock；supervisor aggregate 合併成日 summary。

- [ ] 6.1 `tribunal-all-claude.sh` 每篇跑完 append 一行到 `.score-loop/metrics/daily-<date>-worker-<id>.jsonl`（env var 讀 `TRIBUNAL_WORKER_ID`）
- [ ] 6.2 JSONL 欄位：`{slug, worker_id, engine, result, stages: [{name, loops}], quota_start, quota_end, duration_sec, finished_at}`
- [ ] 6.3 Supervisor 午夜跨日 or daemon 啟動時跑 aggregator：把所有 worker jsonl 合併成 `.score-loop/metrics/daily-<date>.json`（schema 見 design.md）
- [ ] 6.4 `.gitignore` 加 `.score-loop/metrics/*.jsonl`（raw 不追）但 `.score-loop/metrics/*.json`（日 summary）可追
- [ ] 6.5 Aggregator handle worker worktree 跨 worktree jsonl 收集（從 `~/clawd/projects/gu-log-worker-*/` 收到主 repo）

## 7. Dry-run + 驗證 [FINAL — 做 all READY 之後]

- [ ] 7.1 `bash scripts/tribunal-quota-loop.sh --dry-run` 列未跑文章 + 當前 quota + engine 顯示
- [ ] 7.2 在 worktree 手動跑 1 篇 TS engine（opt-in）實跑到 tribunal 結果輸出，驗證 exit code + `--json-status` 正確
- [ ] 7.3 Shadow 對比：同一篇 article 跑 shell engine vs TS engine，人工比較 tribunal 輸出（judge scores、writer-constraints 遵守程度）
- [ ] 7.4 手動 trigger 一次告警：unset webhook 驗 log 寫入、set 假 webhook 驗 HTTP POST
- [ ] 7.5 手動 trigger 一次 metrics aggregation：跑幾篇（dry-run fixture 也可）後確認 daily-*.json 生得對、多 worker jsonl 合併正確
- [ ] 7.6 `pnpm exec vitest run tests/tribunal-v2/` 全綠
- [ ] 7.7 `pnpm exec astro check` 沒新 type error
- [ ] 7.8 `openspec validate add-tribunal-v2-daemon --strict` 過

## 8. 文件 [READY]

現有 `docs/tribunal-runbook.md`（PR #156）已覆蓋 deploy / drain / observability / troubleshooting 大部分。本 change 只補 daemon-specific 新項目：

- [ ] 8.1 **不**另寫 `scripts/TRIBUNAL_DAEMON.md` — 改為在 `docs/tribunal-runbook.md` 補章節：`## TRIBUNAL_ENGINE opt-in`（如何 shadow 跑 TS engine）、`## Alerting`（webhook + log 位置）、`## Metrics`（daily json schema）
- [ ] 8.2 更新 `CLAUDE.md` Quality 段：補提 TS engine shadow + metrics location，去掉舊的「daemon 未串 v2」描述
- [ ] 8.3 VM deploy 步驟沿用 `tribunal-runbook.md` 既有流程，**不**重複文件化

## 9. 清理 [READY]

- [ ] 9.1 確認 `.results/` 裡該留的檔案（ralph-sp175*.log、sp-175-rewrite-rescore/）保留、過氣的已 trash
- [ ] 9.2 `scores/dedup-eval-20260421-205735.md` 移到 `openspec/changes/add-librarian-dupcheck/` 或 `.results/` 下，不要留在 `scores/` 根（避免污染 tribunal-progress.json 的同目錄）
- [ ] 9.3 `.gitignore` revert 要決定：`.results/` 要不要繼續追？本 change 建議繼續 ignore、只把特別有價值的 evidence 檔挑出來放別處

## 10. PR + 最終驗證 [FINAL]

- [ ] 10.1 Commit 整條工作到 feature branch，push，`gh pr create --draft`
- [ ] 10.2 在 PR description 連結 `add-tribunal-ops-policy`、`add-librarian-dupcheck` 做交叉說明
- [ ] 10.3 自己跑 `openspec show add-tribunal-v2-daemon` 最後一次 sanity check
