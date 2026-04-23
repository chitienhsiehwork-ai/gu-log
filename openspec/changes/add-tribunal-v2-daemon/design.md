## Context

gu-log 的 tribunal 系統是 quality gate：四 judge（Vibe / Fresh Eyes / FactLib / Final Vibe）過審才放文章上 production。gu-log 目前有 940 篇文章，持續增長。「24/7 自動消化」的設計動機：

- Claude API quota 每 5 小時 / 每週會 refresh — 閒置 quota 是真的浪費，不是節省
- 新文章由兩種來源進：clawd（VM 上的自動翻譯 pipeline）跟 CC/Obsidian（Mac 上手動寫）— tribunal 要能不區分來源、看到 unscored 就消化
- Tribunal 需要人不在場仍然穩定跑；失敗要能自己重啟，不要靜悄悄死掉

### 現狀（本 change rebase 後，含 PR #152 graceful-run-control）

| 元件 | 狀態 |
|---|---|
| `tribunal-quota-loop.sh` | 被 PR #152 重構成 quota-aware + graceful stop loop，呼叫 `tribunal-run-control.sh` |
| `tribunal-run-control.sh` | PR #152 新增，stop-file-based 控制介面（start / stop / status / drain） |
| `tribunal-batch-runner.sh` | `claude --usage` 檢查是假的 — flag 不存在，永遠 fall-through（本 change 要修） |
| `tribunal-all-claude.sh` | 舊 4-stage shell pipeline，daemon 目前實際呼叫的 |
| `src/lib/tribunal-v2/pipeline.ts` | TS v2 pipeline，有 worthiness gate / final-vibe / writer-constraints，**但 daemon 沒呼叫** |
| `scripts/tribunal-v2-run.ts` | v2 entry point，手動可跑，daemon 未串 |
| `scripts/tribunal-loop.service` | systemd unit，有 `Restart=on-failure`，沒 `OnFailure=` 告警 |
| `~/clawd/scripts/usage-monitor.sh` | 真正會動的 quota 偵測，**在 repo 外** |

### Ralph Loop（2026-03-22 舊版）留下的教訓

本 daemon 的歷史血脈是 2026-03-22 的 Ralph Loop（post `sd-10-20260322-ralph-loop-quality-system.mdx`）。那時是單一 scorer agent 掃全站。退場後核心學到的：

1. **Shell ≠ Agent**：Agent smart but unreliable；Code stupid but reliable。commit / push / 狀態轉換 這類「會影響世界」的決定放 shell；LLM 只做 judgement
2. **Quota 真的能吃爆**：`sp-94` 無限重試踩過；永久狀態（`EXHAUSTED` / `OPUS46_TRIED_3_TIMES`）是必要的
3. **JSON progress file 勝過 DB**：可 `cat`、可 `git diff`、壞了手動 edit 就能重跑
4. **`flock` 防重入**：多個 cron / daemon 實例同時起會互打
5. **Dry-run 一定要有**：deploy 前先看會吃什麼

## Goals / Non-Goals

### Goals

- Daemon 預設走 tribunal v2 TS pipeline，但保留 shell fallback（env var 切換）
- Quota 偵測一份 helper 搞定，batch runner 跟 quota-loop 兩邊共用
- 每篇文章走 feature branch + draft PR，不再直推 main
- Daemon 悶倒 / quota 爆 / 連續失敗時，有告警通道通知 operator
- 有最小日指標（throughput、pass rate、quota 燃燒曲線）
- Daemon 在新機器上起得來 — `usage-monitor.sh` 不再是 VM 硬相依

### Non-goals（本 change 已不處理，已由其他 change 解掉）

- **Graceful stop + drain 語意** — 由 `tribunal-graceful-run-control`（archived 2026-04-23、PR #152 落地）處理。本 change 的 daemon 直接沿用已落地的 stop-file 控制介面
- **多 worker 並行 / claim race / flock 序列化** — 由 `tribunal-safe-parallelism`（進行中，branch `feat/tribunal-safe-parallelism`）處理。本 change 只處理 single-worker lifecycle

### Non-Goals

- **不**實作新的 judge 或改 tribunal 架構（judge 數量、pass bar 都照舊）
- **不**碰 model pinning（屬於 `tribunal-model-pinning-strategy` 那個 change）
- **不**碰 dupCheck / frontmatter wire（那些各自有 openspec change 在處理）
- **不**做 dashboard UI（metrics 只到 JSON 檔，讀取方式交給後續）
- **不**搬到 Kubernetes / Docker / 其他平台（繼續 systemd on VPS）

## Dependencies on in-flight / landed openspec changes

- **`tribunal-graceful-run-control`** — archived 2026-04-23、透過 PR #152 落地。本 change 的 daemon 直接繼承 graceful stop + drain 語意（`scripts/tribunal-run-control.sh`），不再自己實作。Goals 的「daemon 要能 graceful 停機」已由 PR #152 滿足
- **`tribunal-safe-parallelism`** — 進行中，branch `feat/tribunal-safe-parallelism` / worktree `/Users/shroom/gu-log-tribunal-runtime`。負責：article claim contract、skip/collision semantics、shared progress flock、worktree isolation、push 序列化、parallel supervisor。本 change 的實作 MUST 尊重以下介面：
  - 不預設 parallel，預設 single-worker（跟 PR #152 一致）
  - Feature-branch + PR push 路徑 MUST 跟 safe-parallelism 的 push lock 共用同一把鎖（具體鎖檔路徑等 safe-parallelism 先落地再定）
  - Quota helper 抽共用（Group 1）MUST 等 safe-parallelism 先動完同一批檔案（避免 rebase 地獄）

## Execution order（Group dependency map）

本 change tasks.md 分 10 個 Group，依跟 `tribunal-safe-parallelism` 的 conflict 風險分兩批：

- **READY（跟 safe-parallelism 無衝突，可立即做）**：
  - Group 2（usage-monitor 去 VM 硬相依）
  - Group 5（告警）
  - Group 8（文件）
  - Group 9（清理）
- **BLOCKED（等 `feat/tribunal-safe-parallelism` merge 再做）**：
  - Group 1（quota helper 抽共用 → 會動 `tribunal-quota-loop.sh` 核心）
  - Group 3（engine dispatch → 同一支檔案）
  - Group 4（feature branch + PR → 會跟 safe-parallelism 的 push lock 打架）
  - Group 6（指標 → 進度寫入路徑跟 safe-parallelism 的 flock 共用）
- **FINAL**：
  - Group 7（dry-run + 驗證）+ Group 10（PR + 最終驗證） — 全做完才跑

## Decisions

### 1. Engine 選擇：TS 為預設，shell 為 fallback

**選擇**：Daemon dispatch 到 `scripts/tribunal-v2-run.ts`（TS）為預設；`TRIBUNAL_ENGINE=shell` 可切回 `tribunal-all-claude.sh`。

**為什麼不是「全面切 TS 不留 shell」**：v2 pipeline 已有 vitest 覆蓋但尚未生產驗證過一整批。若 v2 出 regression，daemon 不該整個悶倒 — env var 能 5 秒內切回 shell，有緩衝空間。

**為什麼不是「繼續 shell」**：v2 的 worthiness gate、final-vibe 相對門檻、writer-constraints（URL / 標題 / frontmatter / 你我代名詞）是 shell 版沒有的品質守護。繼續跑 shell 就是把這些守護關掉。

**為什麼語言選 TypeScript 不是 Python**：
- v2 pipeline 已 400+ 行 TS 寫完、有 vitest 測試；切 Python = 丟掉所有資產重寫
- 瓶頸是 LLM call 延遲，不是語言速度
- Repo 主棧是 Astro / MDX / `tsx`，Python 在 core path 是外來者
- Python 的強項（ML / scientific libs）此場景用不到 — 我們只是在編排 `claude -p` CLI call
- 多加一個語言 = 多一套 lint / test / CI / dep management 要顧

### 2. Quota 偵測：抽共用 helper `scripts/tribunal-quota-lib.sh`

**選擇**：抽出 `get_effective_remaining()` / `compute_sleep()` / `compute_tier_name()` 到 `scripts/tribunal-quota-lib.sh`，batch runner 跟 quota-loop 兩邊 `source` 進來用。

**為什麼**：目前 `tribunal-batch-runner.sh` 用假的 `claude --usage`（flag 不存在，永遠樂觀放過），`tribunal-quota-loop.sh` 用 `usage-monitor.sh --json`（真的會動）— 兩邊不一致是真 bug。收攏成單一 source of truth。

**Floor / threshold**：
- Floor 3% 保留（CEO 個人用 reserve）
- Resume threshold 10%（hysteresis，避免在 3% 附近抖動）
- STOP 後每 30 分鐘檢查一次
- `usage-monitor.sh --json` 無法讀時 → 保守休 10 分鐘再試

### 3. Feature branch + PR 模式

**選擇**：每篇文章走 `tribunal/<YYYY-MM-DD>-<slug>` 分支，跑完後開 draft PR 到 main。

**分支命名**：`tribunal/2026-04-23-sp-180-example`（日期 + ticket + slug）

**PR draft 誰 merge**：
- 所有 stage PASS 且 Stage 4 沒降級 → daemon 自動轉 ready（非 draft）、auto-merge
- 有 stage fail 或 Stage 4 降級 → 保 draft，等 operator 人工審查

**為什麼不直推 main**：
- 2026-04-22 CLAUDE.md 新規：solo repo 也走 feature branch + PR，Vercel preview 先跑一次、revert 時不沾其他 commit
- Tribunal 改寫有品質風險（SP-175 / SP-177 model quality 事件是佐證），PR 是保險槓

**為什麼不是每篇都保 draft 等人工 merge**：那就變 human bottleneck 了，違反「24/7 自動消化」初衷。Auto-merge 的條件收嚴就好。

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

### [PR 氾濫] 每篇文章一個 PR，可能一天 10+ PR 塞爆 Github

- **風險**：review burden（雖然大部分會 auto-merge，但 draft PR 的還是得看）
- **緩解**：auto-merge 門檻收嚴（全 PASS + 無降級 → ready）；失敗 PR 留 draft 每日一次批次看。配 GitHub CLI alias 批量操作

### [Quota vendor 漂移] `usage-monitor.sh` VM 版跟 vendor 版不同步

- **風險**：未來 `~/clawd/scripts/usage-monitor.sh` 更新了，repo 內版本沒跟上，行為分叉
- **緩解**：daemon 優先讀 `~/clawd/scripts/` 版，找不到才 fallback 到 repo 內；每次 daemon 啟動 log 用的是哪份；VM 版更新時 CI 提醒檢查 vendor

### [Alert noise] 連續 fail 3 次的門檻太低會一直叫

- **風險**：SP-175 / SP-177 那類 model quality 事件可能連續觸發，告警疲勞
- **緩解**：告警觸發後有 1h 冷卻，同 hash 的 error 不重複發；門檻後續視實戰調整

### [Daemon 改寫品質] Auto-merge 的 tribunal 改寫可能偷塞壞東西

- **風險**：tribunal rewriter 可能改壞東西但 judge 放水沒抓到（SP-175 前例）
- **緩解**：writer-constraints（URL / 標題 / frontmatter / 你我代名詞）v2 pipeline 已強制；任何違反直接 revert loop；加上 PR diff 對 humans 可見，事後可追可 revert。極端失控時走 `add-tribunal-ops-policy` 的 pause 機制

## Migration Plan

1. **階段 1 — Dry-run 驗證（本 change 範圍內）**：
   - Vendor `usage-monitor.sh` 到 `scripts/`，但 daemon 仍優先讀 `~/clawd/scripts/`
   - 抽出 `tribunal-quota-lib.sh`，修好兩邊 quota 檢查
   - 在 worktree 內 `bash scripts/tribunal-quota-loop.sh --dry-run` 確認列表跟 quota 對
2. **階段 2 — Engine dispatch（本 change 範圍內）**：
   - `tribunal-v2-run.ts` 加 daemon-friendly exit codes
   - `tribunal-quota-loop.sh` 加 `TRIBUNAL_ENGINE` 分岐
   - 手動驗證：1 篇 TS engine 實跑、1 篇 shell engine 實跑，兩邊都能 commit 到 feature branch
3. **階段 3 — Feature branch + PR（本 change 範圍內）**：
   - Branch 建立 / PR 開 / auto-merge 全套流程在非 daemon 模式驗證過
4. **階段 4 — 告警 + 指標（本 change 範圍內）**：
   - 寫 `tribunal-alert.sh`、加 systemd `OnFailure=`、加日指標寫入
   - 手動 trigger 一次告警確認能到 webhook
5. **階段 5 — VM deploy（在另一個 PR / change 裡）**：
   - 不在本 change 範圍；交給 operator 決定時機 `systemctl --user restart tribunal-loop.service`

## Open Questions

1. Auto-merge 的 CI gate 要不要 block on Vercel preview 成功？（目前 gu-log Vercel auto-deploy，preview url 需要時間）— 傾向「先不 block」，後續看 `chore/branch-pr-mode` 那邊共識
2. `tribunal-all-claude.sh` 要不要加 deprecation warning 印到 stderr？— 輕量、建議加
3. 連續 fail 門檻 3 篇是不是太嚴？或該看 fail 率（例如一天內 > 30% fail）— 先 3 篇，戰後調
