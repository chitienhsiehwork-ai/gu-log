# Review: Tribunal Quota-Aware Continuous Loop

**Reviewer**: reviewer-quota
**Date**: 2026-04-08
**Spec**: `specs/tribunal-quota-loop.md`

## Verdict: CONDITIONAL PASS

Spec 整體架構合理，quota 機制跟 VM 現有 infra 吻合。但 pseudocode 有一個會導致 runtime error 的 bug，加上幾個 gap 需要 Builder 在實作時處理。沒有 blocker-level 問題，但 Builder 必須注意以下 findings。

---

## Acceptance Criteria Pre-check

這些是 spec 定義的 AC。因為還沒實作，這裡評估的是 **spec 是否充分定義了每個 AC 的實作方式**。

- [x] Loop script 架構 — 清楚定義 while-true + adaptive sleep
- [x] Quota via `usage-monitor.sh --json` — **已在 VM 驗證，output 格式完全吻合 spec**
- [x] Effective remaining = min(five_hr, weekly) — Python extraction logic 正確
- [x] 3% floor + STOP mode — 定義清楚
- [x] Hysteresis 10% resume — 定義清楚
- [x] 5-tier adaptive sleep — 表格完整
- [x] Newest → oldest ordering — 引用 existing function
- [x] systemd auto-restart — unit file 有 `Restart=on-failure`
- [x] Old cron removal — 明確列出
- [x] batch-runner preserved — 明確列出 "Keep as-is"
- [x] Logging — 定義清楚
- [ ] **Pre-check before article start** — pseudocode 有 post-sleep re-check，但見 BUG #1
- [x] Dry-run flag — 提及但未在 pseudocode 中實作（minor gap）

---

## BUG #1 (MUST FIX): Float comparison in bash

**嚴重度**: High — 會導致 runtime error

`get_effective_remaining()` 透過 Python 回傳 float（如 `13.0`），但 pseudocode 用 bash integer comparison：

```bash
(( pct > 50 ))           # → syntax error: invalid arithmetic operator ".0"
[ "$remaining" -lt 0 ]   # → integer expression expected
```

**Evidence**:
```
$ bash -c 'pct=13.0; if (( pct > 50 )); then echo yes; fi'
bash: ((: 13.0: syntax error: invalid arithmetic operator (error token is ".0")

$ bash -c 'r=13.0; [ "$r" -lt 0 ]'
bash: [: 13.0: integer expression expected
```

**Fix**: Python 端 `print(int(min(...)))` 或 bash 端 `printf '%.0f'`。

---

## GAP #1: `get_unscored_articles` 未定義

Pseudocode 寫 `articles=$(get_unscored_articles)  # reuse existing function`，但這個 function 定義在 `tribunal-batch-runner.sh` 裡（line 70-99），不是 shared helper。新 loop script 需要：
- 複製該 function 進來，或
- 抽到 `score-helpers.sh`

**Not a spec blocker** — Builder 自然會處理，但 spec 應該明確指出 source。

---

## GAP #2: `tribunal-all-claude.sh` 失敗不應 kill loop

Pseudocode 裡：
```bash
bash scripts/tribunal-all-claude.sh "$next_article"
```

如果 Builder 照慣例加 `set -euo pipefail`（兩個 existing scripts 都用），那 `tribunal-all-claude.sh` exit 1（article FAIL）會直接終止整個 loop。Systemd 會 restart（60s delay），但這代表**每個 FAIL 的 article 都浪費 60 秒 restart penalty**。

**應該**: `bash scripts/tribunal-all-claude.sh "$next_article" || tlog "Article failed, continuing..."`

---

## GAP #3: systemd token 傳遞方式矛盾

Spec 的 unit file 同時寫了：
- Line 199: `Environment=CLAUDE_CODE_OAUTH_TOKEN=%h/.cc-cron-token-content` ← 設成 file path string，不是 token 內容
- Line 201: `ExecStartPre=/bin/bash -c 'export ...'` ← spec 自己也說這不會 work

然後 line 216 說 "Builder should use EnvironmentFile or wrapper script"。

**建議**: 直接在 spec 裡定一個 thin wrapper pattern（跟 `cc-cron-tribunal.sh` 一樣），別讓 Builder 猜：
```bash
#!/bin/bash
export CLAUDE_CODE_OAUTH_TOKEN=$(head -1 "$HOME/.cc-cron-token")
exec bash scripts/tribunal-quota-loop.sh
```

---

## Planner 的三個問題

### Q1: Sleep durations (5m/30m/2h) — reasonable?

**Reasonable. ✓**

| Tier | Sleep | 實際 cycle time (含 ~25min tribunal) | Articles/hr |
|------|-------|--------------------------------------|-------------|
| BURN | 0s | ~25min | ~2.4 |
| CRUISE | 5min | ~30min | ~2 |
| CONSERVE | 30min | ~55min | ~1 |
| SCARCE | 2hr | ~2hr25min | ~0.4 |

CONSERVE 讓 5hr window 有時間恢復（~20%/hr recovery rate）。SCARCE 跟現有 cron 的 2hr 間隔一致。合理。

### Q2: Hysteresis 10% resume — too conservative?

**稍微 conservative 但安全。可接受。**

- 一次 tribunal run（4 stage × Opus/Sonnet/Haiku）大約消耗 2-5% quota
- 如果 resume at 5%，跑一篇可能馬上回到 <3% → 無限 bounce
- 10% 至少能跑 1-2 篇才回到 scarce zone
- 3% → 10% recovery 在 5hr window 下大約需要 20-30 分鐘
- 不會因為 hysteresis 太高而顯著減少 throughput

### Q3: systemd vs wrapper script for deployment?

**systemd 是正確選擇。✓**

Evidence:
- VM 已有 6+ systemd user services running（`openclaw-gateway`, `openclaw-watchdog`, `xmcp`, etc.）
- `Linger=yes` 已設（services survive logout）
- 失敗的 `ralph-daemon.service` 是 transient unit（不同 approach），不代表 systemd 本身有問題
- tmux/nohup 沒有 auto-restart、resource limits、journal logging

---

## Additional Findings

### 1. 舊的 `ralph-daemon.service` 應清理
VM 上有一個 failed `ralph-daemon.service`。部署新 service 時應先清掉：
```bash
systemctl --user reset-failed ralph-daemon.service
systemctl --user disable ralph-daemon.service 2>/dev/null || true
```

### 2. `tribunal-batch-runner.sh` line 149 有 existing bug
```bash
local rc=0  # ← `local` outside function, should be just `rc=0`
```
Out of scope for this spec，但 Builder 如果碰到可以順手修。

### 3. Dry-run 未在 pseudocode 中實作
AC 列了 `--dry-run` flag，但 pseudocode 沒有展示。Builder 需自行實作（參考 `tribunal-batch-runner.sh` 的 dry-run pattern）。

### 4. Git pull conflict handling
Pseudocode 的 `git pull --rebase origin main` 沒有 error handling。如果 rebase conflict，loop 會 crash → systemd restart → 再 crash → infinite restart loop。應加 `|| { git rebase --abort 2>/dev/null; tlog "WARN: git pull failed"; }`。

### 5. Quiet hours 依賴 `tribunal-all-claude.sh` 內部處理
Spec 正確指出不需要在 loop 層重複 quiet hours logic。✓ 已驗證 `tribunal-all-claude.sh` 有 `is_quiet_hours()` + `wait_for_quiet_hours_end()`。

---

## VM Infrastructure Verification

| Check | Result |
|-------|--------|
| `usage-monitor.sh --json` 存在且可執行 | ✓ 回傳正確 JSON |
| Claude entry 格式吻合 spec | ✓ `five_hr_remaining_pct`, `weekly_remaining_pct` 都在 |
| Python extraction `min(14.0, 13.0)` = `13.0` | ✓ 正確 |
| 2-minute file cache | ✓ source code 確認 `_USAGE_CACHE_TTL=120` |
| `~/.cc-cron-token` 存在 | ✓ 109 bytes, `-rw-------` |
| python3 可用 | ✓ Python 3.12.3 |
| systemd user services 可用 | ✓ `Linger=yes`, 6+ existing services |
| 現有 cron entry | ✓ `0 */2 * * * .../cc-cron-tribunal.sh` |

---

## Summary

| Category | Verdict |
|----------|---------|
| Architecture | ✓ PASS — continuous loop + adaptive sleep 是正確 approach |
| Quota mechanism | ✓ PASS — `usage-monitor.sh` verified, format matches |
| Sleep tiers | ✓ PASS — reasonable and well-justified |
| Hysteresis | ✓ PASS — slightly conservative but safe |
| Deployment (systemd) | ✓ PASS — correct for this VM |
| Pseudocode correctness | ✗ **BUG** — float comparison will crash |
| Completeness | ⚠ **GAPS** — unscored fn source, error handling, token passing |

**Overall: CONDITIONAL PASS** — Builder 可以開始實作，但必須修 float bug 並注意 4 個 gaps。
