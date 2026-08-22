## 1. 回歸合約

- [ ] 1.1 擴充發布器 fixture，證明全數有效的 no-diff 選取內容會原子地成為 `published`，並留下 `publicationMethod: "already_on_main"`、精確 `mainCommit`、更新時間，且沒有 synthetic 批次／PR／merge metadata。
- [ ] 1.2 證明已收斂內容不會出現在下一次 `--apply`，且下一次執行會實際選到後方有差異的成品並進入正常批次生命週期。
- [ ] 1.3 覆蓋批次上限路徑，證明大於 `MAX_BATCH` 的 queue 會 deterministic 地選取且沒有 Broken pipe，同時 dry-run report 仍計算完整 queue；並保留 invalid 或有差異的 sidecar 不得使用 shortcut 的覆蓋。
- [ ] 1.4 覆蓋最新 fetch 與同目錄 atomic replacement 失敗，證明發布器狀態帳本保持 byte-identical、不建立 remote lifecycle，且未完成 temp-file 會清理。

## 2. 發布器實作

- [ ] 2.1 將 optional limit enforcement 移入 publishable-candidate collector；`--apply` 選取傳入 `MAX_BATCH` 並正常退出，dry-run report 不傳 limit。
- [ ] 2.2 加入單次同目錄 temp-file／`jq reduce` 狀態帳本 transaction，完整 JSON 驗證後以同 filesystem rename 收斂所有通過驗證的 no-diff 項目、清除過時生命週期 metadata，失敗時保留原狀態帳本並清理 temp。
- [ ] 2.3 只在最新 `origin/main` materialization 與既有 validation 產生完全空白 staged diff 後執行 reconciliation；有差異的批次保留既有生命週期。

## 3. 驗證

- [ ] 3.1 執行聚焦的 Tribunal 發布器 regression suite 與 shell static check。
- [ ] 3.2 不使用 bypass flag 執行 repo pre-commit／pre-push gate，並記錄任何僅限環境的限制。
