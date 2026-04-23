> **Status legend**：`[READY]` 可立即做、不會跟 `feat/tribunal-safe-parallelism` 撞車；`[BLOCKED]` 會動到 safe-parallelism 正在改的核心檔（`tribunal-quota-loop.sh` 主體、push 序列化、progress flock），等 safe-parallelism merge 再動。

## 1. Quota helper 抽共用 [BLOCKED on safe-parallelism]

- [ ] 1.1 新建 `scripts/tribunal-quota-lib.sh`，把 `get_effective_remaining()` / `compute_sleep()` / `compute_tier_name()` 從 `tribunal-quota-loop.sh` 搬過去
- [ ] 1.2 `tribunal-quota-loop.sh` 改 `source "$SCRIPT_DIR/tribunal-quota-lib.sh"`
- [ ] 1.3 `tribunal-batch-runner.sh` 拿掉假的 `claude --usage` 檢查，改 `source tribunal-quota-lib.sh` 用真 helper
- [ ] 1.4 兩邊共用 `QUOTA_FLOOR=3` / `RESUME_THRESHOLD=10` 常數（從 lib 匯出）

## 2. usage-monitor 去 VM 硬相依 [READY]

- [x] 2.1 Vendor `~/clawd/scripts/usage-monitor.sh` 到 `scripts/usage-monitor.sh`（從 VM 拉最新版）
- [x] 2.2 VM-first / vendored fallback 解析（**暫時住在 `tribunal-quota-loop.sh`**；等 Group 1 把 helper 抽到 `tribunal-quota-lib.sh` 時再搬）
- [x] 2.3 Daemon 啟動時 log 用的是哪一份（路徑 + mtime），方便除錯
- [x] 2.4 `scripts/usage-monitor.sh` 檔頭加 `VENDORED FROM` 區塊（路徑 + 日期 + 重新 vendor 指令）

## 3. Engine dispatch（TS vs shell）[BLOCKED on safe-parallelism]

- [ ] 3.1 `tribunal-quota-loop.sh` 加 `TRIBUNAL_ENGINE` env var（`ts` 為預設、`shell` 為 fallback）
- [ ] 3.2 `ts` 分岐呼叫 `pnpm tribunal:run "$POST_PATH"`；`shell` 分岐呼叫現有 `bash tribunal-all-claude.sh "$article"`
- [ ] 3.3 `scripts/tribunal-v2-run.ts` 加 daemon-friendly exit codes：0 = PASS、1 = FAIL、3 = NEEDS_REVIEW、其他 = 系統錯誤
- [ ] 3.4 `scripts/tribunal-v2-run.ts` 加 `--json-status` mode，最後一行印 JSON 狀態（slug / 結果 / 每 stage loop 數 / quota 剩餘）給 daemon 解析
- [ ] 3.5 `scripts/tribunal-all-claude.sh` 檔頭加 `# LEGACY: use TRIBUNAL_ENGINE=ts by default. This path is retained as fallback only.`

## 4. Feature branch + PR 模式 [BLOCKED on safe-parallelism]

- [ ] 4.1 `tribunal-quota-loop.sh` 每篇文章前 `git checkout -b tribunal/$(date +%F)-<slug>`（不跳過重名，已存在就 suffix -N）
- [ ] 4.2 Stage commits 照舊、push 到 remote 後 `gh pr create --draft --title "tribunal(<slug>): ..." --body ...`
- [ ] 4.3 `gh pr edit --add-label tribunal-auto` 讓 PR 清單可過濾
- [ ] 4.4 Daemon 計算 pipeline 結果：全 PASS + 無降級 → `gh pr ready && gh pr merge --auto --squash`；否則保 draft
- [ ] 4.5 跑完 checkout 回 main、`git branch -D tribunal/...` 清理 local branch
- [ ] 4.6 Error path：任何 stage fail，push 已跑的 stage commits 到 remote（讓 PR 可 review），不刪分支

## 5. 告警 [READY]

- [ ] 5.1 新建 `scripts/tribunal-alert.sh`，介面：`tribunal-alert.sh <severity> <title> <body>` — 讀 `TRIBUNAL_ALERT_WEBHOOK` env、無 webhook 時寫 `.score-loop/logs/alerts-<date>.log`
- [ ] 5.2 新建 `scripts/tribunal-alert@.service`（systemd template unit），呼叫 `tribunal-alert.sh crash $1 "..."`
- [ ] 5.3 `tribunal-loop.service` 加 `OnFailure=tribunal-alert@%n.service`
- [ ] 5.4 `tribunal-quota-loop.sh` STOP 迴圈內計時累計，`STOP_MINUTES > 720`（12h）時呼 `tribunal-alert.sh warning "long-stop" "..."`，同條件 1h 冷卻
- [ ] 5.5 `tribunal-quota-loop.sh` 連續 fail 計數，第 3 篇 fail 呼 `tribunal-alert.sh error "consecutive-fail" "..."`，觸發後重置計數
- [ ] 5.6 同 hash error 1h 冷卻，避免洗版

## 6. 指標 [BLOCKED on safe-parallelism]

- [ ] 6.1 `tribunal-quota-loop.sh` 每篇跑完 append 一行到 `.score-loop/metrics/daily-<date>.jsonl`（JSONL 格式好 append）
- [ ] 6.2 午夜（或每次 daemon 啟動）跑 aggregator：把 JSONL → `.score-loop/metrics/daily-<date>.json`（design.md 的 schema）
- [ ] 6.3 `.gitignore` 加 `.score-loop/metrics/*.jsonl`（raw 不追）但 `.score-loop/metrics/*.json`（日 summary）可追

## 7. Dry-run + 驗證 [FINAL — 做 all READY + BLOCKED 之後]

- [ ] 7.1 `bash scripts/tribunal-quota-loop.sh --dry-run` 列未跑文章 + 當前 quota，engine 顯示 TS/shell
- [ ] 7.2 在 worktree 手動跑 1 篇 TS engine 實跑：PR 建立、stage commits、auto-merge 成功
- [ ] 7.3 在 worktree 手動跑 1 篇 `TRIBUNAL_ENGINE=shell` 實跑：同樣驗證到 auto-merge
- [ ] 7.4 手動 trigger 一次告警：unset webhook 驗 log 寫入、set 假 webhook 驗 HTTP POST
- [ ] 7.5 `pnpm exec vitest run tests/tribunal-v2/` 全綠
- [ ] 7.6 `pnpm exec astro check` 沒新 type error
- [ ] 7.7 `openspec validate add-tribunal-v2-daemon` 過

## 8. 文件 [READY]

- [ ] 8.1 Daemon runbook 寫到 `scripts/TRIBUNAL_DAEMON.md`：如何 start / stop / check status / 切 engine / 讀 metrics / 看告警
- [ ] 8.2 更新 `CLAUDE.md`「Quality: Vibe Scoring + Tribunal」段落，提到 daemon 模式 + TS engine 預設
- [ ] 8.3 `systemctl --user enable tribunal-loop.service` 的 deployment 步驟（**不**在本 change 執行，交 operator）

## 9. 清理 [READY]

- [ ] 9.1 確認 `.results/` 裡該留的檔案（ralph-sp175*.log、sp-175-rewrite-rescore/）保留、過氣的已 trash
- [ ] 9.2 `scores/dedup-eval-20260421-205735.md` 移到 `openspec/changes/add-librarian-dupcheck/` 或 `.results/` 下，不要留在 `scores/` 根（避免污染 tribunal-progress.json 的同目錄）
- [ ] 9.3 `.gitignore` revert 要決定：`.results/` 要不要繼續追？本 change 建議繼續 ignore、只把特別有價值的 evidence 檔挑出來放別處

## 10. PR + 最終驗證 [FINAL]

- [ ] 10.1 Commit 整條工作到 feature branch，push，`gh pr create --draft`
- [ ] 10.2 在 PR description 連結 `add-tribunal-ops-policy`、`add-librarian-dupcheck` 做交叉說明
- [ ] 10.3 自己跑 `openspec show add-tribunal-v2-daemon` 最後一次 sanity check
