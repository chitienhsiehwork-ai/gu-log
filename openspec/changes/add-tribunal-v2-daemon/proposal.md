## Why

Tribunal 品質 pipeline 要在 clawd-vm 上 24/7 跑，偵測剩餘 quota → 抓未跑過 tribunal 的文章 → 自動消化。現有實作（2026-04-22 `tribunal-quota-loop.sh`）有四個實質問題：

1. **Engine 不對**：呼叫的是舊的 shell pipeline（`tribunal-all-claude.sh`），沒吃到 tribunal v2 的 worthiness gate、final-vibe 相對門檻、writer-constraints 這些關鍵守護
2. **Quota 偵測假的**：`tribunal-batch-runner.sh` 用 `claude --usage`，這個 flag 根本不存在，所以永遠 fall-through 「continuing optimistically」；只有 `tribunal-quota-loop.sh` 那支的 `usage-monitor.sh --json` 是真的
3. **直推 main**：違反 2026-04-22 新規的 feature-branch + PR 政策；tribunal 重寫的每篇都該有自己的 PR，讓 Vercel preview 先跑 + revert 可鎖定
4. **無告警、無指標**：daemon 悶倒、quota 吃光、連續失敗都沒人知道；只有 systemd journal 跟 `.score-loop/logs/` 埋在那

外部依賴 `~/clawd/scripts/usage-monitor.sh` 不在 repo 內，新機器起不來。把這四件事打包成一個 spec'd capability，未來改動可追、可審。

## What Changes

- **NEW capability `tribunal-daemon`**：把 24/7 loop 當成一個正式的 spec'd 能力 — quota 感知、文章選取、engine 選擇、branch/PR 紀律、生命週期、告警/指標都在裡面
- 預設 engine 從 shell `tribunal-all-claude.sh` → TS `tribunal-v2-run.ts`；保留 `TRIBUNAL_ENGINE=shell|ts` env var 作 fallback，v2 出 regression 時 daemon 不會整個悶倒
- 修 `tribunal-batch-runner.sh` 假的 quota 檢查；抽共用 helper（`scripts/tribunal-quota-lib.sh`）給 batch runner 跟 quota-loop 兩邊用
- 把 `usage-monitor.sh` vendor 一份到 `scripts/`（去掉 `~/clawd/scripts/` 硬相依）
- 每篇文章走 `tribunal/<slug>` feature branch + draft PR，不再直推 main
- 最小告警 hook：systemd `OnFailure=` 觸發 crash 通知；sustained STOP > 12h 告警；連續 3 篇 fail 告警。透過 `TRIBUNAL_ALERT_WEBHOOK` env var 導 Slack / Discord
- 最小指標：每日 `.score-loop/metrics/daily-<date>.json` 紀錄 throughput（文章數）、每 stage 通過率、quota 燃燒曲線

**BREAKING**: daemon 不再直推 main — operator 操作介面改變（看 PR 而非直接 `git log main`）。

## Capabilities

### New Capabilities

- `tribunal-daemon`: 24/7 quota-aware 的 tribunal 執行器。定義生命週期（start/stop/restart/kill-switch）、quota 偵測契約、文章選取規則、engine 選擇、feature-branch + PR 政策、告警/指標介面。

### Modified Capabilities

無。`tribunal-ops-policy`（另一個 change）定義「何時停 daemon」、本 change 定義「daemon 平常怎麼跑」— 互補不衝突，各自維護自己的 spec。

## Impact

### 受影響的程式 / 腳本

- `scripts/tribunal-quota-loop.sh` — 加 engine dispatch、告警 hook、branch 建立
- `scripts/tribunal-batch-runner.sh` — 替掉假的 quota 檢查、加 branch/PR 流程
- `scripts/tribunal-all-claude.sh` — 保留作為 fallback，header 標註 `LEGACY`
- `scripts/tribunal-v2-run.ts` — 加 daemon-friendly exit codes、JSON stdout mode、非 0 exit 時印可追問題訊息
- `scripts/tribunal-quota-lib.sh` — **新增**，抽出共用 quota helper
- `scripts/usage-monitor.sh` — **新增**，vendor fallback（優先讀 `~/clawd/scripts/` 版，找不到才用 repo 內）
- `scripts/tribunal-alert.sh` — **新增**，共用告警 dispatcher
- `scripts/tribunal-loop.service` — 加 `OnFailure=` hook

### 依賴

- 無新 npm / system deps
- 可選：`TRIBUNAL_ALERT_WEBHOOK` env var（Slack / Discord webhook URL）

### 與其他 openspec change 的關係

- `add-tribunal-ops-policy`（policy-only，policy = 何時停）— 互補
- `tribunal-model-pinning-strategy`（0/19 tasks）— 本 change 不碰 model 選擇，但 daemon dispatch 到 v2 pipeline 後會自動吃 v2 的 model pinning 結果
- `wire-tribunal-scores-to-frontmatter`（0/15 tasks）— 本 change 不碰 frontmatter 寫入邏輯；等另一邊落地後 daemon 自動吃到
- `add-librarian-dupcheck`（0/18 tasks）— 本 change 不碰 dupCheck；目前 `pipeline.ts` 有 WIP 把 dupCheck 回退掉，這個決策落在另一個 change 裡

### 部署

- Target：clawd-vm（Hetzner VPS）既有 systemd user service
- OAuth token 照舊在 `~/.cc-cron-token`
- 進度 SSOT 仍是 `scores/tribunal-progress.json`
