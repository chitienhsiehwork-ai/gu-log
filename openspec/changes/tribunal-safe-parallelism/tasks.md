## 1. 定義 article claiming contract

- [ ] 1.1 決定 article claim artifact 位置與格式（例如 `.score-loop/claims/<slug>.claim`）
- [ ] 1.2 實作 atomic claim helper，確保只有一個 worker 能 claim 成功
- [ ] 1.3 worker 完成 / 失敗 / 中止時正確釋放 claim
- [ ] 1.4 補 log / state，讓 operator 可看出 article 是 claimed、running、skipped、還是 completed

## 2. 修正 skip / collision semantics

- [ ] 2.1 修改 `tribunal-all-claude.sh` 的 lock collision path，回傳明確 skipped / already-running 狀態碼
- [ ] 2.2 修改上層 runner / supervisor，將 skipped 與 success 分開統計
- [ ] 2.3 確保 log 不會把 collision 誤寫成 PASS

## 3. 讓 shared progress 具備併發安全

- [ ] 3.1 為 `scores/tribunal-progress.json` 的 read-modify-write 加 global flock
- [ ] 3.2 檢查 stage progress、article status、topLevelAttempts 等所有寫入點都走同一套鎖
- [ ] 3.3 若需要，補 state helper，避免 script 內散落多份未上鎖 jq 寫入

## 4. 建立 worker worktree isolation

- [ ] 4.1 Worker worktree 位置定為 `~/clawd/projects/gu-log-worker-a` 與 `~/clawd/projects/gu-log-worker-b`（user 決定）
- [ ] 4.2 每個 worker 在自己的 worktree 執行 rewrite / build / git 操作
- [ ] 4.3 避免 worker 共用同一個 node_modules / build output 導致互相污染（必要時文件化限制）
- [ ] 4.4 文件化 worktree bootstrap / repair 流程
- [ ] 4.5 文件化 Mac → VPS 開發流程：Mac 本機寫程式 + 可在本機測的先測（claim race / flock stress / stop 時 drain）；push 到 remote 後用 `ssh clawd-vm` 進 `~/clawd/projects/gu-log/`，跑 `scripts/tribunal-worker-bootstrap.sh a` 與 `b` 建 worktree，`systemctl --user` 底下實跑 2 worker 做完整整合測試

## 5. 序列化 sync / push

- [ ] 5.1 為 push / mainline sync 加 global lock 或 coordinator
- [ ] 5.2 確保兩個 worker 不會同時對同一分支 push
- [ ] 5.3 明確定義 rebase / push failure 的 retry / backoff 路徑

## 6. 建立 parallel supervisor

- [ ] 6.1 在 quota-aware runtime 上新增 `--workers 2`（或等效 supervisor config）
- [ ] 6.2 supervisor 根據 quota / article backlog 維持最多 2 個 active workers
- [ ] 6.3 stop request 到來時，supervisor 停止派新工作並等待兩個 workers drain
- [ ] 6.4 log / state 顯示每個 worker 的 current article、phase、claim 狀態

## 7. 驗證

- [ ] 7.1 `openspec validate tribunal-safe-parallelism --strict` PASS
- [ ] 7.2 手動測試：兩 workers 同時啟動，不會 claim 同一篇 article
- [ ] 7.3 手動測試：故意製造 lock collision，runner 會記 skipped，不會記 PASS
- [ ] 7.4 手動測試：兩 workers 同時更新 progress，不會丟失任何寫入
- [ ] 7.5 手動測試：stop request 到來後，不再派新文章，兩 workers 跑完手上文章後退出
- [ ] 7.6 手動測試：兩 workers 的 git / build / push 互不污染
- [ ] 7.7 驗證完成後，若 production 不長期跑 2 worker，回 clawd-vm 清掉實驗用 worktree：`cd ~/clawd/projects/gu-log && git worktree remove ../gu-log-worker-a && git worktree remove ../gu-log-worker-b && git worktree list` 確認已清乾淨。若要長期維持 2 worker，worktree 保留並在 `CLAUDE.md` / runbook 文件化
