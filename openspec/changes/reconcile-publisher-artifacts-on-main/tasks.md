## 1. 回歸合約

- [ ] 1.1 擴充 publisher fixture，證明全數有效的 no-diff 選取內容會原子地成為 `published`，並留下 `publicationMethod: "already_on_main"`、精確 `mainCommit`、更新時間，且沒有 synthetic batch／PR／merge metadata。
- [ ] 1.2 證明已收斂內容不會出現在下一輪選取，而後方仍可發布的 artifact 依然能入選。
- [ ] 1.3 覆蓋批次上限路徑，證明大於 `MAX_BATCH` 的 queue 會 deterministic 地選取且沒有 Broken pipe；並保留 invalid 或 changed sidecar 不得使用 shortcut 的覆蓋。

## 2. Publisher 實作

- [ ] 2.1 將 `MAX_BATCH` enforcement 移入 publishable-candidate collector，使其在設定上限後正常退出。
- [ ] 2.2 加入單次 temp-file／`jq reduce` ledger transaction，收斂所有通過驗證的 no-diff entry 並清除過時 lifecycle metadata。
- [ ] 2.3 只在 fresh `origin/main` materialization 與既有 validation 產生完全空白 staged diff 後執行 reconciliation；changed batch 保留既有 lifecycle。

## 3. 驗證

- [ ] 3.1 執行聚焦的 Tribunal publisher regression suite 與 shell static check。
- [ ] 3.2 不使用 bypass flag 執行 repo pre-commit／pre-push gate，並記錄任何僅限環境的限制。
