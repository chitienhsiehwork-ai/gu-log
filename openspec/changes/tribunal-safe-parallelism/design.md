## Context

目前 tribunal 是單 worker 思維設計：

- selection：先列 unscored article，再拿第一篇
- execution：`tribunal-all-claude.sh` 針對單篇執行，有 per-article flock
- state：所有文章共用 `scores/tribunal-progress.json`
- git：同一個 repo worktree 中 `git pull / commit / push`

這個設計在單 worker 下尚可接受；一旦同時跑兩份，問題會立刻浮現。

## Goals / Non-Goals

**Goals**
- 支援 2 個 tribunal workers 同時工作
- 不讓同一篇 article 被重複執行
- 不讓 skipped / collision 被誤記成 success
- progress state 具備併發安全
- git side effects 有隔離或 serialization
- stop 時可以停止派新工作並等待 workers drain

**Non-Goals**
- 不做任意數量 auto-scaling worker pool
- 不解決所有 possible distributed queue 問題（單機即可）
- 不重寫 tribunal judge / writer prompt 本身

## Key Decisions

### 1. 平行化的單位是 article，不是 stage

**Decision**：parallelism 在 article level 發生；每個 worker 一次處理一篇完整 article。

**Why**
- `tribunal-all-claude.sh` 已經以 article 為天然工作單位
- stage-level parallelism 會把單篇文章拆得過細，鎖與 git side effect 都更複雜
- article-level 也比較符合 graceful drain contract

### 2. Dispatch 必須改成 claim-based，而不是 scan-first pick-first

**Decision**：worker 在真正開始執行前，必須先對 article 做 atomic claim。只有 claim 成功的 worker 才能跑。

**Rejected alternative**：兩個 worker 都先列 unscored array，各拿第一篇，撞到 flock 再說
- 會產生大量假成功 / 空跑
- 上層無法分辨「這篇真的 PASS」還是「只是另一個 worker 在跑」

### 3. lock collision 必須回報為 skipped，不是 success

**Decision**：若 article 已被 claim 或已有 tribunal instance 執行，worker / runner MUST 回傳明確的 skip / already-running 狀態碼。

**Why**
- 目前 `tribunal-all-claude.sh` lock collision `exit 0` 會污染上層統計
- 並行系統裡 success / fail / skipped 必須是三個不同語意

### 4. Shared progress 要有序列化寫入

**Decision**：shared progress state 的最小要求是 global write lock；進階版可考慮 per-article progress files，但不是本 phase 必需。

**Why**
- 直接 jq → tmp → mv 在並行下會 lost update
- 兩 worker 版本先以 flock 包住 progress read-modify-write，是最小可行改法

### 5. Worker git execution 必須 worktree 隔離

**Decision**：每個 worker 使用獨立 git worktree；不得共用同一個 working tree 執行 rewrite / build / commit。

**Rejected alternative**：兩 worker 共用同一個 repo 目錄
- `git pull`, `git checkout`, `git commit`, `pnpm build` 彼此污染
- 這不是小 bug，是 architecture mismatch

### 6. Push / sync side effects 必須序列化

**Decision**：即使 workers 分別在獨立 worktree，push / mainline sync 仍需序列化。

可接受實作：
- global push lock
- 或單獨 sync coordinator 負責整合 commit/push

本 phase 不強制要求哪一種，只要求不可無鎖同時 push 共享分支。

### 7. Parallel supervisor 沿用 graceful drain contract

**Decision**：stop request 到來時，supervisor SHALL 停止 claim / dispatch 新 article，並等待所有 in-flight workers 完成 current article 後退出。

**Why**
- 與 Phase 1 一致
- operator mental model 清楚：兩個 worker 都跑完手上那篇就停

## Risks / Trade-offs

### 1. worktree isolation 讓 runtime 複雜度上升

這是真的，但比起 shared worktree 的不確定性，這是值得付出的複雜度。

### 2. 全域 progress lock 會限制極端擴展性

是，但目前目標只有 2 workers，不是高擴展 queue system。先求 correctness。

### 3. claim / skip / success state 變多，log 與觀測需要跟上

這是好事；並行系統需要更細緻的狀態，而不是假裝 everything is success。
