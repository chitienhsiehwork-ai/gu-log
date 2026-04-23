## Context

gu-log 的 tribunal 系統是 quality gate：四 judge（Vibe / Fresh Eyes / FactLib / Final Vibe）過審才放文章上 production。gu-log 目前有 940 篇文章，持續增長。「24/7 自動消化」的設計動機：

- Claude API quota 每 5 小時 / 每週會 refresh — 閒置 quota 是真的浪費，不是節省
- 新文章由兩種來源進：clawd（VM 上的自動翻譯 pipeline）跟 CC/Obsidian（Mac 上手動寫）— tribunal 要能不區分來源、看到 unscored 就消化
- Tribunal 需要人不在場仍然穩定跑；失敗要能自己重啟，不要靜悄悄死掉

### 現狀（本 change rebase 後，含 PR #152 / #153 / #154 / #155 / #156）

Production on clawd-vm 2026-04-24：`tribunal-loop.service` 跑 **5 workers** × `claude-opus-4-6[1m]`（vibe scorer + writer 都吃 1M context），per-dispatch worker worktree sync，tribunal commit 直接進 main。

| 元件 | 狀態 |
|---|---|
| `tribunal-quota-loop.sh` | 449 行 supervisor，worker pool + claim + per-dispatch sync + drain + `--workers N`（PR #153 / #156） |
| `tribunal-run-control.sh` | PR #152 起 + PR #153 補：stop signal / file flag、`rc_try_claim` / `rc_release_claim` / `rc_gc_stale_claims`、`RC_PROGRESS_LOCK` / `RC_PUSH_LOCK` |
| `tribunal-worker-bootstrap.sh` | PR #153 新增：`create / status / sync / remove / remove-all`，管 `gu-log-worker-<id>` 多 worktree |
| `tribunal-all-claude.sh` | 4-stage shell pipeline，daemon 實際呼叫的 hot path；progress R-M-W 全 flock-wrap；commit/fetch/rebase/push 走 RC_PUSH_LOCK（PR #153） |
| `tribunal-batch-runner.sh` | 仍有假的 `claude --usage` 檢查（本 change Group 1 要收攏） |
| `src/lib/tribunal-v2/pipeline.ts` | TS v2 pipeline（worthiness gate / final-vibe / writer-constraints），**daemon 仍沒呼叫**（本 change Group 3） |
| `scripts/tribunal-v2-run.ts` | v2 entry point，daemon 未串 |
| `scripts/tribunal-loop.service` | `KillMode=mixed` / `TimeoutStopSec=3600` / `CPUQuota=200%` / `MemoryMax=2G` / 預設 `--workers 5`（PR #156） |
| `scripts/usage-monitor.sh` | 本 change Group 2 vendored 過來；daemon `tribunal-quota-loop.sh` 已跟 `~/clawd/scripts/usage-monitor.sh` 雙路 resolve |
| `docs/tribunal-runbook.md` | PR #156 新增，deploy / drain / observability / troubleshooting 都在這 |

### Ralph Loop（2026-03-22 舊版）留下的教訓

本 daemon 的歷史血脈是 2026-03-22 的 Ralph Loop（post `sd-10-20260322-ralph-loop-quality-system.mdx`）。那時是單一 scorer agent 掃全站。退場後核心學到的：

1. **Shell ≠ Agent**：Agent smart but unreliable；Code stupid but reliable。commit / push / 狀態轉換 這類「會影響世界」的決定放 shell；LLM 只做 judgement
2. **Quota 真的能吃爆**：`sp-94` 無限重試踩過；永久狀態（`EXHAUSTED` / `OPUS46_TRIED_3_TIMES`）是必要的
3. **JSON progress file 勝過 DB**：可 `cat`、可 `git diff`、壞了手動 edit 就能重跑
4. **`flock` 防重入**：多個 cron / daemon 實例同時起會互打
5. **Dry-run 一定要有**：deploy 前先看會吃什麼

## Goals / Non-Goals

### Goals（本 change 範圍內仍要做的）

- Daemon 有走 tribunal v2 TS pipeline 的選項（env var 切換），保留 shell 為 production default
- Quota 偵測一份 helper 搞定，batch runner 跟 quota-loop 兩邊共用
- Daemon 悶倒 / quota 爆 / 連續失敗時，有告警通道通知 operator
- 有最小日指標（throughput、pass rate、quota 燃燒曲線）
- Daemon 在新機器上起得來 — `usage-monitor.sh` 不再是 VM 硬相依 ✓（Group 2 已完成）

### Non-goals（已由其他 change 解掉，本 change 不動）

- **Graceful stop + drain 語意** — `tribunal-graceful-run-control`（archived 2026-04-23、PR #152）。本 change sup pervisor 直接沿用
- **多 worker 並行 / claim race / flock 序列化 / worker worktree isolation / push 序列化** — `tribunal-safe-parallelism`（archived 2026-04-23、PR #153–#156）。5-worker supervisor + `RC_PUSH_LOCK` + `RC_PROGRESS_LOCK` 都已 production
- **每篇文章走 feature branch + draft PR**（原 Goal 之一）— **本 change 撤回**。理由見下方 Decision 3 revision。Tribunal 跑完 **直接 commit 到 main**，由 `RC_PUSH_LOCK` + `git fetch-rebase-push` retry 處理 concurrent write；跟 production 5-worker 吞吐量哲學一致

### Non-Goals

- **不**實作新的 judge 或改 tribunal 架構（judge 數量、pass bar 都照舊）
- **不**碰 model pinning（屬於 `tribunal-model-pinning-strategy` 那個 change）
- **不**碰 dupCheck / frontmatter wire（那些各自有 openspec change 在處理）
- **不**做 dashboard UI（metrics 只到 JSON 檔，讀取方式交給後續）
- **不**搬到 Kubernetes / Docker / 其他平台（繼續 systemd on VPS）

## Dependencies on landed openspec changes

- **`tribunal-graceful-run-control`** — archived 2026-04-23、透過 PR #152 落地。本 change 的 daemon 直接繼承 graceful stop + drain 語意（`scripts/tribunal-run-control.sh`），不再自己實作
- **`tribunal-safe-parallelism`** — archived 2026-04-23、透過 PR #153–#156 落地。Worker pool、claim、`RC_PROGRESS_LOCK`、`RC_PUSH_LOCK`、per-dispatch worktree sync 全進 main。本 change 的後續實作 MUST 直接建在這組介面之上：
  - Engine dispatch（Group 3）要走 `tribunal-all-claude.sh` 已有的 flock-wrapped progress R-M-W 跟 push lock，不另發明
  - Alerting（Group 5）跟 metrics（Group 6）的寫入點共用 `.score-loop/` 既有目錄結構（state / claims / logs）
  - 5-worker production 是 hot path，任何新增 logic 都要 **worker-aware**（例：告警訊息帶 worker id）

## Execution order（rebase 後重新評估）

`tribunal-safe-parallelism` 已落地後，本 change tasks.md 不再有 BLOCKED 組：

- **Done**：
  - Group 2（usage-monitor 去 VM 硬相依）✓
- **READY now（原本標 BLOCKED，因依賴已 merge 可放行）**：
  - Group 1（quota helper 抽共用）
  - Group 3（engine dispatch TS vs shell）
  - Group 6（metrics） — 寫入位置改成 per-worker jsonl + 彙總
- **READY**（一開始就 READY）：
  - Group 5（告警）
  - Group 8（文件） — 大部分已被 `docs/tribunal-runbook.md` 覆蓋，只補 daemon-specific 項目
  - Group 9（清理）
- **撤回 / 重新定位**：
  - **Group 4（feature branch + PR per article）— 撤回**。Production 直接 commit 到 main、`RC_PUSH_LOCK` 序列化 push，跟高吞吐量 5-worker 哲學一致；逐篇 PR 的 review benefit 對 auto-tribunal 價值不對等。若 CEO 將來想要人工 review 某類文章，會另開 gated-review change 處理
- **FINAL**：
  - Group 7（dry-run + 驗證）+ Group 10（PR + 最終驗證） — 全做完才跑

## Decisions

### 1. Engine 選擇：shell 留為 production default，TS 走 opt-in

**選擇**：Daemon 繼續 dispatch 到 `scripts/tribunal-all-claude.sh`（shell, 4-stage, production 已驗證），新增 `TRIBUNAL_ENGINE=ts` opt-in 切到 `scripts/tribunal-v2-run.ts`（TS，有 worthiness gate / final-vibe / writer-constraints）。

**為什麼不再推「TS 為預設」**：2026-04-24 production 已是 5-worker shell engine × `claude-opus-4-6[1m]` 全速燒 quota（PR #156）。shell 路徑剛吃進 per-dispatch worker sync、flock-wrapped progress、push lock；此刻切預設到 TS = 砍掉 production 的穩定性。TS 該以 shadow / opt-in 驗證 1 ~ 2 週再談切預設。

**為什麼不是「繼續 shell、砍掉 TS」**：v2 的 writer-constraints（URL / 標題 / frontmatter / 你我代名詞不准動）是 shell 版沒有的 — SP-175 / SP-177 model 劣化事件裡 rewriter 偷改標題 URL 就是在 shell engine 發生的。TS engine 是 regression net，要保留可切換路徑。

**為什麼語言選 TypeScript 不是 Python**：
- v2 pipeline 已 400+ 行 TS 寫完、有 vitest 測試；切 Python = 丟掉所有資產重寫
- 瓶頸是 LLM call 延遲，不是語言速度
- Repo 主棧是 Astro / MDX / `tsx`，Python 在 core path 是外來者
- Python 的強項（ML / scientific libs）此場景用不到 — 我們只是在編排 `claude -p` CLI call
- 多加一個語言 = 多一套 lint / test / CI / dep management 要顧

**與 `[1m]` context 的互動**：shell engine 現在跑 `claude-opus-4-6[1m]`；TS engine 若要保持 parity，`scripts/tribunal-v2-run.ts` 呼叫 Anthropic SDK 時 MUST 支援同樣的 model id 字串（Group 3.3 / 3.4 要寫進來）。

### 2. Quota 偵測：抽共用 helper `scripts/tribunal-quota-lib.sh`

**選擇**：抽出 `get_effective_remaining()` / `compute_sleep()` / `compute_tier_name()` 到 `scripts/tribunal-quota-lib.sh`，batch runner 跟 quota-loop 兩邊 `source` 進來用。

**為什麼**：目前 `tribunal-batch-runner.sh` 用假的 `claude --usage`（flag 不存在，永遠樂觀放過），`tribunal-quota-loop.sh` 用 `usage-monitor.sh --json`（真的會動）— 兩邊不一致是真 bug。收攏成單一 source of truth。

**Floor / threshold**：
- Floor 3% 保留（CEO 個人用 reserve）
- Resume threshold 10%（hysteresis，避免在 3% 附近抖動）
- STOP 後每 30 分鐘檢查一次
- `usage-monitor.sh --json` 無法讀時 → 保守休 10 分鐘再試

### 3. [撤回] Feature branch + PR 模式 — 不在本 change 範圍

**原本的選擇**：每篇文章走 `tribunal/<YYYY-MM-DD>-<slug>` 分支、draft PR、auto-merge。

**撤回的理由**（2026-04-24 更新）：

- PR #153 起 tribunal commit 走 `flock -x 10 ... 9>>RC_PUSH_LOCK` 序列化，5 workers 同時完工也不會互撞 push — feature-branch 的 concurrent-write 保險已經不需要
- PR 逐篇 auto-merge 在 5-worker 吞吐量下變成 **throughput ceiling**：每小時 10–30 篇文章 × 每篇 push + PR 建立 + CI + auto-merge = GitHub API rate limit 風險 + 可預期的 review noise
- `tribunal-runbook.md` 已記錄現狀 deploy flow：tribunal commit 直接上 main，revert 用 `git revert <sha>`。相比 PR 路徑，revert 成本相當
- 2026-04-22 CLAUDE.md 的 feature branch + PR 新規是寫給「人類或 CC 手動做 task」的場合；tribunal 是 auto-loop，不在那條規則的目標對象

**若將來真的要做**：會以獨立 change 提案（名稱 tentative：`tribunal-gated-review`），而且只針對特定 tag（例：`--tag=controversial` / `--tag=sp-175-aftermath` 系列）走 PR 審查，其他照舊直推 main。本 change 不納入。

### 4. 告警：systemd `OnFailure=` + 自訂 long-STOP / consecutive-fail hooks

**選擇**：三道告警線：

| 條件 | 偵測方式 | 動作 |
|---|---|---|
| Daemon crash | systemd `OnFailure=tribunal-alert@%n.service` | 觸發 webhook + journal dump |
| STOP > 12h（quota 一直不回來） | quota-loop.sh STOP 迴圈內自己計時 | 觸發 webhook |
| 連續 3 篇 fail | quota-loop.sh 內連續計數 | 觸發 webhook |

**Webhook**：`TRIBUNAL_ALERT_WEBHOOK` env var（optional）。未設時告警寫到 `.score-loop/logs/alerts-<date>.log`，不發外部通知。

**為什麼不用 Prometheus / OpenTelemetry**：過度工程化。單一 VM 單一 daemon 不需要 push gateway。簡單 webhook + tail log 就夠。

### 5. 指標：日 JSON 檔，不做 dashboard

**選擇**：每日寫一份 `.score-loop/metrics/daily-<YYYY-MM-DD>.json`，格式：

```json
{
  "date": "2026-04-23",
  "articlesProcessed": 12,
  "articlesPassed": 10,
  "articlesFailed": 2,
  "stageFailures": { "stage1": 1, "stage3": 1 },
  "quotaMinPct": 4,
  "quotaMaxPct": 68,
  "stopMinutes": 45,
  "generatedAt": "2026-04-24T00:05:00+08:00"
}
```

**為什麼不做 dashboard**：YAGNI。後續真的需要 trend 分析再說；目前 `cat` / `jq` 即可用。

### 6. WIP 合約：pipeline.ts 的 revert 照舊

**選擇**：worktree 帶過來的 `pipeline.ts` revert（拔掉 `persistScoreToFrontmatter()` + dupCheck-only FAIL 分支）**保留**。

**為什麼**：
- `wire-tribunal-scores-to-frontmatter`（0/15 tasks）這個 change 本來就還沒 merge — revert 只是對齊 spec 的 current state
- dupCheck 被回退是因為 dedup judge precision 80%（見 `scores/dedup-eval-20260421-205735.md`） — 不夠準就先不開 gate，交給 `add-librarian-dupcheck` 那個 change 決定什麼時候 re-enable
- Daemon 本身不該先行把這些 feature 掛進來 — 會把兩個 change 的權衡混在同一個 PR

## Risks / Trade-offs

### [TS pipeline 生產未驗證] 切到 v2 後跑不動

- **風險**：vitest 只能 mock runner，LLM call 實際跑起來可能有 edge case
- **緩解**：預設走 TS 但 `TRIBUNAL_ENGINE=shell` 5 秒可切回；先在 1-2 篇新文章上手動跑 TS engine 驗證，再啟 daemon auto dispatch

### [TS engine fork 走偏] shell engine 繼續演化但 TS engine 沒跟上

- **風險**：shell engine 是 production default，會持續補 bug / 調 model pin；TS engine 在 opt-in shadow 狀態，容易 drift
- **緩解**：TS shadow 運行後要定期對比兩 engine 結果（writer-constraints 是否被違反、judge scores 落差）；打出明確的「TS engine 可切預設」門檻並放進 Group 3 驗收

### [Quota vendor 漂移] `usage-monitor.sh` VM 版跟 vendor 版不同步

- **風險**：未來 `~/clawd/scripts/usage-monitor.sh` 更新了，repo 內版本沒跟上，行為分叉
- **緩解**：daemon 優先讀 `~/clawd/scripts/` 版，找不到才 fallback 到 repo 內；每次 daemon 啟動 log 用的是哪份；VM 版更新時 CI 提醒檢查 vendor

### [Alert noise] 連續 fail 3 次的門檻太低會一直叫

- **風險**：SP-175 / SP-177 那類 model quality 事件可能連續觸發，告警疲勞
- **緩解**：告警觸發後有 1h 冷卻，同 hash 的 error 不重複發；門檻後續視實戰調整

### [Daemon 改寫品質] Auto-merge 的 tribunal 改寫可能偷塞壞東西

- **風險**：tribunal rewriter 可能改壞東西但 judge 放水沒抓到（SP-175 前例）
- **緩解**：writer-constraints（URL / 標題 / frontmatter / 你我代名詞）v2 pipeline 已強制；任何違反直接 revert loop；加上 PR diff 對 humans 可見，事後可追可 revert。極端失控時走 `add-tribunal-ops-policy` 的 pause 機制

## Migration Plan（rebase onto 新 main 後）

1. **階段 1 — Dry-run 驗證** ✓ 已完成（2026-04-23）：
   - Vendor `usage-monitor.sh` 到 `scripts/` + VM-first fallback resolver
   - Dry-run 在 Mac 跑過，證明 vendored fallback 對 442 篇 unscored 列表正常
2. **階段 2 — Quota helper 抽共用（Group 1）**：
   - 把 `get_effective_remaining()` / `compute_sleep()` / `compute_tier_name()` + `QUOTA_FLOOR` / `RESUME_THRESHOLD` 搬到 `scripts/tribunal-quota-lib.sh`
   - `tribunal-quota-loop.sh` + `tribunal-batch-runner.sh` 兩邊 source 進來，拿掉 batch-runner 假的 `claude --usage`
3. **階段 3 — Engine dispatch opt-in（Group 3）**：
   - `scripts/tribunal-v2-run.ts` 加 daemon-friendly exit codes + `--json-status` + 支援 `claude-opus-4-6[1m]` model id
   - `tribunal-quota-loop.sh` worker dispatch 加 `TRIBUNAL_ENGINE` 分岐（預設 shell，opt-in ts）
   - 在 worktree 手動 shadow 跑 1 ~ 2 篇 TS engine，對比同篇 shell engine 的 pipeline.ts 結果
4. **階段 4 — 告警（Group 5）**：
   - 寫 `scripts/tribunal-alert.sh`、`tribunal-alert@.service`
   - `tribunal-loop.service` 加 `OnFailure=`；supervisor 內加 long-STOP 12h / consecutive-fail 3 觸發
   - 手動 trigger 一次告警確認能到 webhook
5. **階段 5 — 指標（Group 6）**：
   - `tribunal-all-claude.sh` 跑完 append 一行 worker-scoped jsonl 到 `.score-loop/metrics/daily-<date>-worker-<id>.jsonl`
   - supervisor 午夜或啟動時 aggregate 成 `.score-loop/metrics/daily-<date>.json`
6. **階段 6 — VM deploy**：
   - 透過 `tribunal-runbook.md` 既有 deploy flow：Mac push → VPS `git pull` → `systemctl --user stop tribunal-loop` drain → restart
   - 新指令 `touch .score-loop/control/stop-graceful` 已是 production-proven 路徑

## Open Questions

1. TS engine shadow 跑幾篇 / 多久才算「可切預設」？建議：連續 20 篇 no-regression（writer-constraints 未違反、judge scores 差距 < 0.5）+ 1 週穩定期
2. `tribunal-all-claude.sh` 要不要加 deprecation warning 印到 stderr？— 在 TS engine 確定切預設前先不加，避免 production noise
3. 連續 fail 門檻 3 篇是不是太嚴？或該看 fail 率（例如一天內 > 30% fail）— 先 3 篇，戰後調
4. Metrics jsonl per-worker 還是單一共用？— per-worker 寫入不用 flock，aggregator 讀時合併；先走 per-worker 省鎖
