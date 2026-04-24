## Context

Tribunal 品質管線在 VPS 上 24/7 執行，用 `tribunal-quota-loop.sh` 持續掃描待評文章並派 worker 跑 4-judge pipeline。每篇文章消耗 4-8 次 `claude -p` 呼叫，耗時 10-60 分鐘。

**現狀問題**：額度管理是二元 GO/STOP——額度 > 3% 就全速（10s cooldown），≤ 3% 就完全停機（每 30 分鐘輪詢）。473+ 篇待評積壓下，系統會在幾小時內燒光視窗額度，然後閒置到刷新。

**額度模型**：Anthropic Max 訂閱有兩個滑動視窗——5 小時和 7 天。兩個視窗各有獨立的使用上限和刷新時間。人（使用者在 Mac 上用 Claude Code）和機器（tribunal 在 VPS 上跑 `claude -p`）共享同一個額度池。

**量測來源**：VPS 上的 `usage-monitor.sh` 打 `api.anthropic.com/api/oauth/usage`（OAuth bearer token + `anthropic-beta: oauth-2025-04-20`），回傳兩個視窗的已用 %、刷新時間戳、以及 extra usage 資訊。有 2 分鐘檔案快取避免 429。

**已知 bug**：`tribunal-batch-runner.sh` 使用不存在的 `claude --usage` 指令查額度。

## Goals / Non-Goals

**Goals:**
- 額度利用率最大化：每個視窗刷新前，floor 以上的額度全部用完
- 零人工介入：controller 全自動，不需要人手動調參數
- 自動適應人的使用：人在用 Claude Code 時 controller 自動降速，不用特別偵測
- 可觀測：controller 決策全部有紀錄，可事後分析和偵測額度總量變化
- 安全退路：`--legacy-quota` 一鍵退回舊邏輯

**Non-Goals:**
- 不改 tribunal 的 4-judge pipeline 本身（Librarian → Fact Checker → Fresh Eyes → Vibe Scorer）
- 不改 graceful stop 機制（SIGTERM / file flag / interruptible wait）
- 不改 worker worktree 管理
- 不改 claim 鎖定機制
- 不新增額度查詢的 API endpoint 或工具（使用現有 `usage-monitor.sh`）

## Decisions

### D1: 閉迴路回饋控制 vs 多檔位固定速率 vs 時間表排程

**選擇**：閉迴路回饋控制。

**替代方案 A（多檔位）**：例如 >50% → 10s, 20-50% → 60s, 3-20% → 300s。需要手動定義檔位邊界，無法自動適應不同的使用模式。

**替代方案 B（時間表）**：例如每天配額 N 篇。需要知道總額度才能分配，無法即時反應人的使用。

**選閉迴路的理由**：公式 `ideal_rate = (remaining - floor) / time_until_refresh` 涵蓋所有邊界情況——接近 floor 自然減速、接近刷新自然加速、人在用時自動讓路——零額外參數、零特殊邏輯。

### D2: 雙軌各自計算 + 取保守 vs 取 min 合併

**選擇**：Scheme C——兩條曲線各自獨立計算 cooldown，取 `max(cooldown_5hr, cooldown_7day)`。

**替代方案（Scheme D）**：7 天為主曲線，5 小時當安全閥（低於某門檻才介入）。需要額外定義安全閥門檻參數。

**選 Scheme C 的理由**：不需要額外參數；5 小時視窗刻度更細（10% of 5hr ≈ 1% of weekly），自動提供高解析度的短期感測。

### D3: 量測頻率——每次 dispatch 前查一次

**選擇**：每次派 worker 前呼叫 `usage-monitor.sh --json` 一次。

**理由**：usage-monitor 有 2 分鐘檔案快取，每次呼叫不一定真的打 API。每篇文章跑 10-60 分鐘，所以實際 API 命中率約每 10-60 分鐘一次。`claude -p` 的 JSON 輸出不含 rate_limits，`claude --usage` 不存在，usage-monitor 是唯一可靠來源。

### D4: 共享額度池——不偵測人的使用

**選擇**：controller 只看剩餘 %，不區分消耗來源。

**理由**：閉迴路本質——觀察輸出（剩餘額度）vs 目標（理想曲線），偏差就修正。人的使用只是一個「干擾」，controller 自動吸收。零協調機制、零偵測邏輯。

### D5: ARTICLE_COST_PCT 自動校準（EMA）

**選擇**：用指數移動平均（alpha=0.3）從歷史紀錄自動校準。

**理由**：不同文章的 cost 差異大（4 次 judge pass-first-try vs 20+ 次 judge+rewrite+retry），固定值不準。EMA 讓近期觀測的權重更高，smoothly 追蹤趨勢。冷啟動用保守預設 5.0（偏高，防止冷啟動超燒），暖機後自動調整。

### D6: 前饋補償——扣除 in-flight worker 的預估消耗

**選擇**：計算 rate 前，先從 remaining_pct 扣除 `active_workers * ARTICLE_COST_PCT`。

**理由**：usage-monitor 有 2 分鐘快取。如果剛 dispatch 了 2 個 worker，下次 controller_tick 看到的 remaining 還沒反映這 2 個 worker 的消耗。不扣除 = 以為 quota 還很多 = 繼續塞 worker = over-commit。前饋補償是閉迴路控制的標準做法，防止觀測延遲造成的超調。

### D7: Extra usage 安全閥

**選擇**：`extra_used / extra_limit > 80%` 時硬停（MAX_COOLDOWN, 0 workers）。

**理由**：extra usage 是真金白銀（$100/月），不是訂閱內含的額度。超過預算會產生帳單。80% 門檻留 20% buffer 給人手動用。

## Risks / Trade-offs

**[Risk] ARTICLE_COST_PCT 校準不準** → 冷啟動預設 5.0（偏高 = 偏慢）+ EMA 自動修正。最差情況：前幾篇文章的 cooldown 偏長，但隨著歷史累積會自動收斂。部署前應先手動跑 1-2 篇確認實際量級。

**[Risk] usage-monitor.sh 不可用（API 錯誤 / OAuth token 過期）** → controller 進入 fallback 模式（cooldown=600s, workers=1），state 顯示 "fallback"。下次 dispatch 時重試。不會 crash。

**[Risk] Controller 震盪** → 量測間隔自然阻尼：每篇文章 10-60 分鐘，controller 每 10-60 分鐘才做一次決策。加上 MIN_COOLDOWN/MAX_COOLDOWN 的夾限，輸出變化有限。

**[Risk] 改壞現有系統** → `--legacy-quota` 旗標一鍵退回舊邏輯。所有非 quota 的機制（graceful stop、autoscaling、claiming）完全不動。

**[Risk] usage-monitor 快取延遲（2-min TTL）** → 在快取有效期內連續 dispatch 的 worker 會看到相同的 quota reading。D6 的前饋補償緩解此問題——每個 in-flight worker 的預估消耗會被扣除，即使 usage-monitor 尚未更新。

**[Risk] Extra usage 帳單超支** → D7 的 80% 安全閥防止超支。如果 extra usage 未啟用則完全不影響。

**[Trade-off] 滑動視窗無 active session** → resets_at 可能為 null 或過去時間（表示視窗尚未啟動）。此時該視窗的 quota 完全可用，不應構成限制。Controller 視為 cooldown=MIN_COOLDOWN。

## Migration Plan

1. **階段 0**：OpenSpec artifacts 完成（proposal、specs、design、tasks）
2. **階段 1**：在 `tribunal-quota-loop.sh` 加入 controller 函式（純新增，不影響現有邏輯）
3. **階段 2**：用 controller 取代主迴圈的 GO/STOP（功能切換）
4. **階段 3**：加觀測檔案（quota-history.jsonl、quota-controller.json）+ 更新 runbook
5. **部署**：push 到 main → VPS `git pull` → `systemctl --user restart tribunal-loop`
6. **觀察**：前 24 小時用 `tail quota-history.jsonl | jq .` 監控 controller 行為
7. **Rollback**：`systemctl --user stop tribunal-loop` → 加 `--legacy-quota` → restart

## Open Questions

- **Extra usage ($100/月) 要不要也納入 controller？** 目前只記錄到 history，不影響 cooldown。如果 extra usage 接近上限，可能需要額外的安全閥。暫時只觀測，不介入。
- **batch runner 是否也要用 controller？** 目前只修復壞掉的 `claude --usage`。batch runner 是 bounded 模式，用 controller 的意義不大（跑完就停）。暫時不動。
