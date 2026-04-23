## Why

目前 gu-log 已經同時存在兩條 tribunal 執行路徑：

- `scripts/tribunal-batch-runner.sh`：偏 one-shot / cron，處理一批後退出
- `scripts/tribunal-quota-loop.sh`：偏 long-running loop，理論上可整天跑

但實際行為還沒有被規格化。batch runner 會因 `--max` 或 quota floor 停止；quota loop 雖然會持續跑，但目前沒有明確的 graceful stop contract，也沒有定義「什麼叫安全邊界停機」。一旦 systemd stop、手動 kill、quiet-hours sleep、或長時間 idle wait 發生，中止時機仍是碰運氣。

這造成三個問題：

1. tribunal 無法被視為可預期的 daemon —— 只能靠「先跑再看會不會停」
2. operator 想停機時，缺少明確的 drain / stop 語意
3. 後續若要做 multi-worker safe parallelism，沒有穩定 lifecycle contract 可依賴

這個 change 先把 Phase 1 補齊：讓 tribunal 可以整天跑，也可以在不破壞 in-flight article 的前提下平順停下來。

## What Changes

### New capability: `tribunal-run-control`

定義 tribunal 常駐執行與 graceful stop 的 lifecycle contract：

- tribunal SHOULD 以 quota-aware loop 方式持續執行，而不是只靠 one-shot batch
- operator 發出 stop 請求時，系統 SHALL 進入 draining 模式，不再接新 article
- in-flight article SHALL 跑到安全邊界後才停止
- 長時間 sleep / quiet-hours wait SHALL 可被 stop 請求喚醒，不可卡 30 分鐘才發現要停
- daemon stop 行為（systemd / wrapper / signal）需要有明確規格，而不是依 shell 預設行為

### Scope boundary

這個 change 只處理單 worker lifecycle / stop control，不處理：

- 多 worker article dispatch
- article claiming / queue ownership
- parallel progress write locking
- multi-worktree git isolation

那些是 `tribunal-safe-parallelism` 的範圍。

## Impact

### Affected specs

- `tribunal-run-control`（new capability）

### Affected code / scripts

- `scripts/tribunal-quota-loop.sh`
- `scripts/tribunal-batch-runner.sh`
- `scripts/cc-tribunal-loop-wrapper.sh`
- `scripts/tribunal-loop.service`
- 可能新增 control / state 檔案於 `.score-loop/`

### Relationship to other OpenSpec changes

- 補上 `add-tribunal-ops-policy` 的程式行為層：ops-policy 定義「何時該停」，本 change 定義「怎麼停得漂亮」
- 是 `tribunal-safe-parallelism` 的前置依賴：parallel workers 需要先建立可預期的 run / drain / stop contract
