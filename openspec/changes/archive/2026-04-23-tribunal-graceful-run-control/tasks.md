## 1. Runtime / lifecycle 狀態整理

- [x] 1.1 盤點 `scripts/tribunal-quota-loop.sh` 內所有等待點（quota stop、no-article、quiet-hours、cooldown）
- [x] 1.2 決定 stop state / drain state 的命名與落檔位置（例如 `.score-loop/control/`、`.score-loop/state/`）
- [x] 1.3 明確區分 batch runner 與 quota loop 的用途，更新註解與 usage 說明

## 2. 實作 graceful stop control

- [x] 2.1 在 `scripts/tribunal-quota-loop.sh` 新增 signal handlers（SIGTERM / SIGINT）
- [x] 2.2 signal handler 只設 stop_requested 狀態，不直接 exit
- [x] 2.3 新增 file-based stop control（例如 `.score-loop/control/stop-graceful`）
- [x] 2.4 loop 每次 dispatch 前檢查 stop_requested / stop flag，若命中則不接新 article
- [x] 2.5 current article 完成後若 stop_requested=true，寫出 stopped-by-request log/state 並退出

## 3. 把長等待改成 interruptible wait

- [x] 3.1 將 quota-stop 的 `sleep 1800` 改為切片等待 + 每輪檢查 stop
- [x] 3.2 將 no-article 的 `sleep 1800` 改為切片等待 + 每輪檢查 stop
- [x] 3.3 將 quota unreadable 的 `sleep 600` 改為切片等待 + 每輪檢查 stop
- [x] 3.4 將 quiet-hours wait 改為切片等待 + 每輪檢查 stop
- [x] 3.5 保留短 cooldown（例如 10s）可直接 sleep，或統一走同一個 helper

## 4. 狀態觀測與 wrapper / service 對齊

- [x] 4.1 在 log 中加上 `running / draining / stopped_by_request / stopped_by_quota / idle_wait` 等明確狀態
- [x] 4.2 規格化 `scripts/cc-tribunal-loop-wrapper.sh` 的 stop 行為，確保 signal 會傳到 loop
- [x] 4.3 更新 `scripts/tribunal-loop.service`，設定合理的 stop timeout，讓 draining 有時間完成
- [x] 4.4 文件化「如何 graceful stop」與「何時會 force kill」

## 5. Batch runner 邊界修正

- [x] 5.1 確認 `scripts/tribunal-batch-runner.sh` 文件清楚標示 one-shot / bounded 用途
- [x] 5.2 避免 batch runner 被誤當 daemon 入口（usage / comments / wrapper 分流）
- [x] 5.3 若需要，補上 `--max` / bounded stop 說明與 log

## 6. 驗證

- [x] 6.1 `openspec validate tribunal-graceful-run-control --strict` PASS
- [x] 6.2 手動測試：啟動 quota loop，建立 stop flag，確認 current article 完成後退出
- [x] 6.3 手動測試：在 no-article / quota-stop wait 中建立 stop flag，確認 loop 可快速退出
- [x] 6.4 手動測試：`systemctl --user stop tribunal-loop`（或等效）時，確認進入 draining 而非立即中止
- [x] 6.5 確認 log / state 能區分 stopped_by_request vs stopped_by_quota
