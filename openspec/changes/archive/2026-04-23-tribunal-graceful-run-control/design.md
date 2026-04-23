## Context

Tribunal 目前有 two-track runtime：batch runner（短命、批次）與 quota loop（長命、常駐）。真正適合「整天跑」的是 quota loop，但它現在只有 quota gating，沒有完整 lifecycle contract。

觀察到的現況：

- `tribunal-batch-runner.sh` 會因 `--max` 或 quota floor 結束
- `tribunal-quota-loop.sh` 會 `while true` 持續跑，但只 ignore `SIGHUP`
- quiet hours、no-article、quota-stop 都使用長 sleep（600s / 1800s）
- stop signal 沒有被定義為「drain current article, then exit」
- `tribunal-all-claude.sh` 雖然有 stage resume / article resume，但這是 crash recovery，不等於 graceful stop

本 change 要明確把「crash 可恢復」與「停止可預期」分開。

## Goals / Non-Goals

**Goals**
- tribunal 能以 quota loop 形式穩定常駐
- operator 能要求 graceful stop，而不是只能粗暴 kill
- stop 只在安全邊界生效
- sleep / wait 狀態能快速回應 stop
- systemd / wrapper 層跟 shell runtime 的行為一致

**Non-Goals**
- 不做 multi-worker
- 不做 article claiming
- 不處理 progress file 併發寫入
- 不處理 git parallel push / pull

## Key Decisions

### 1. 單 worker quota loop 是正式 daemon 入口

**Decision**：把 `tribunal-quota-loop.sh` 視為常駐 runtime SSOT；`tribunal-batch-runner.sh` 保留 one-shot / cron / manual batch 用途。

**Why**
- quota loop 已經具備「沒文章就等 / quota 不夠就停 / quota 恢復就繼續」的長跑骨架
- batch runner 的設計目的是 bounded run，不該硬被拉成 daemon
- daemon / one-shot 兩種模式應該各自存在，而不是用一個 script 混兩種責任

### 2. stop 採「request stop + drain」模型，不做即刻中止

**Decision**：收到 stop signal 或 control flag 後，runtime 只標記 `stop_requested=true`，不直接 `exit`。loop 在安全邊界觀察到 stop_requested 時退出。

安全邊界定義：
- article 尚未開始前
- article 完成後、下一篇尚未 dispatch 前
- no-article / quota-stop / quiet-hours wait 期間

**Rejected alternative**：收到 SIGTERM 立刻 `exit 0`
- 會讓 in-flight article 停在 judge / rewrite / build 半路
- 會把 crash recovery 誤當正常 stop，觀察性很差

### 3. 安全邊界以「article 為單位」，不是 stage 為單位

**Decision**：graceful stop 的最小 drain 單位是 current article，不是 current stage。

**Why**
- stage 中止仍然可能留下半套 rewrite / build / frontmatter write
- article 已經是現有 progress tracking 的自然單位
- 對 operator 來說「這篇跑完就停」比「可能停在 FactChecker attempt 2/2 中間」更可預期

### 4. stop control 需要雙通道：signal + file flag

**Decision**：同時支援：
- POSIX signal（SIGTERM / SIGINT）
- file-based control flag（例如 `.score-loop/control/stop-graceful`）

**Why**
- systemd / service stop 比較自然走 signal
- operator / script / cron 觸發停機時，用 file flag 比較透明、可觀測、可測試
- file flag 可作為「要求停止」的 durable state，避免 signal 丟失後無痕

### 5. 長 sleep 改成 interruptible wait

**Decision**：任何 >30s 的等待都不直接 `sleep 1800`；改成切片輪詢（例如每 10~30 秒醒一次），每次檢查 stop flag 與 quota / quiet-hours 狀態。

**Why**
- operator 發 stop 後不該還要等 30 分鐘
- 這也改善 daemon observability：log 會更準確反映目前在等什麼

### 6. stop semantics 需要明確狀態輸出

**Decision**：runtime 必須區分至少四種狀態並寫入 log / state：
- `running`
- `draining`
- `stopped_by_request`
- `stopped_by_quota` / `idle_wait`

**Why**
- 不然 log 看起來只像「怎麼又停了」
- 之後 parallel supervisor 也能沿用這套狀態名稱

## Risks / Trade-offs

### 1. graceful stop 會讓 stop latency 變長

如果當前 article 正在 rewrite + build，operator 要等這篇結束。這是刻意 trade-off：我們用 stop latency 換取 repo / article state 穩定。

### 2. 中途真的想硬停仍然需要 force kill

本 change 定義的是 graceful stop，不是禁止 hard kill。force kill 仍然可保留給 emergency，但不作為日常路徑。

### 3. batch runner 與 quota loop 的責任切分會更清楚，也意味著不能再把 batch runner 當 daemon 入口誤用

這是好事，不是壞事；只是文件與 runbook 要跟上。
