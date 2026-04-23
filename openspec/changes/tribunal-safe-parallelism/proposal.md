## Why

讓 tribunal 跑整天只是 Phase 1。下一步是提升吞吐量：同時跑兩個 tribunal workers。

但目前的 runtime 還不具備 safe parallelism 條件。現況至少有四個風險：

1. article selection 不是 atomic claim —— 兩個 worker 可能挑到同一篇
2. `tribunal-all-claude.sh` 的 per-article flock collision 目前 `exit 0`，上層可能把「沒跑到」誤判成 success
3. `scores/tribunal-progress.json` 是共享檔案，沒有全域寫鎖，存在 lost update 風險
4. tribunal workers 若共用同一個 git worktree，`git pull / commit / push` 很容易互撞

所以這個 change 的目標不是「把 worker 數字改成 2」而已，而是定義 safe parallelism contract：怎麼 claim article、怎麼隔離 worker、怎麼 serialize shared git/progress side effects、以及 stop 時怎麼 drain。

## What Changes

### New capability: `tribunal-safe-parallelism`

定義 tribunal multi-worker runtime 的安全邊界與調度契約：

- runtime MAY 同時執行 2 個 workers
- 每篇 article 在任一時間 SHALL 只被一個 worker claim
- claim collision / lock collision SHALL 回報為 skipped / already-running，而不是 success
- shared progress state SHALL 具備併發安全
- git worktree 與 push/pull side effects SHALL 被隔離或序列化
- stop request 時 supervisor SHALL 停止派新工作，等待 in-flight workers drain

### Depends on `tribunal-graceful-run-control`

本 change 建立在 graceful run control 之上：parallel workers 的 drain / stop semantics 應沿用 Phase 1 的 lifecycle contract，而不是另發明一套。

## Impact

### Affected specs

- `tribunal-safe-parallelism`（new capability）

### Affected code / scripts

- `scripts/tribunal-quota-loop.sh` 或新的 supervisor runtime
- `scripts/tribunal-batch-runner.sh`（若共用 dispatch logic）
- `scripts/tribunal-all-claude.sh`
- `scores/tribunal-progress.json` 或替代 progress layout
- 可能新增 claim / lock / worker state 目錄於 `.score-loop/`
- 可能新增 worker worktree bootstrap / sync scripts

### Relationship to other OpenSpec changes

- 依賴 `tribunal-graceful-run-control`
- 補齊 current tribunal automation 缺少的 concurrency contract
