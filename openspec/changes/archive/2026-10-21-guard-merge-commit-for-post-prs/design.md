# Design

## 只有動到文章的 PR 改用 merge commit

會出事的只有 `post-versions.json` 的計數：它數的是碰過每篇文章的非 merge commit。沒動到文章的 PR（glossary、低風險 code）squash 不影響計數，所以維持原本的 squash，變動範圍只限出過事的那一類 PR。

## 看 PR 的所有路徑，含 rename 前的舊路徑

Guard 檢查 PR 的所有路徑（`POLICY_PATHS_JSON`，含 rename 前的舊路徑），只要有一條在 `src/content/posts/` 底下就用 merge commit。不直接沿用 `HAS_POST_CHANGE`：它只看新檔名，用途是決定 `post-versions.json` 能不能放行。PR 如果把文章 rename 移出 `src/content/posts/`，新檔名不在 posts 底下，沿用它就會 squash，跟 spec「修改 `src/content/posts/` 下檔案」的字面對不上。用 merge commit 合併不會讓任何計數出錯，所以判斷寧可寬一點；`HAS_POST_CHANGE` 原本的放行語意不動。

## 決定記進 audit log

Merge method 在寫 audit log 之前決定，紀錄裡的 `mergeMethod` 欄位在 allow 時是 `merge` 或 `squash`，deny 時是 `null`。之後要查某個文章 PR 是怎麼合的，看 `decisions.jsonl` 就好，不用翻 stdout。

## 明確傳旗標，不靠 repo 預設

Repo 同時允許 merge commit 與 squash。Guard 直接傳 `--merge` 或 `--squash`，不依賴 GitHub 的預設 merge method，設定被改也不會默默變回 squash。

## 測試

`scripts/tests/test-auto-merge-guard.sh` 用假的 `gh` 錄下 guard 實際傳出的參數，驗證文章 PR 和把文章 rename 移出 posts 的 PR 用 `--merge`、沒動到文章的 PR 用 `--squash`、被拒的 PR 不會呼叫 `gh pr merge`，並檢查 audit log 的 `mergeMethod`。CI 的 unit-tests job 透過 `tests/shell-regression-ownership.test.ts` 執行這支測試。

## 取捨

- 合併後 main 上會多一個 merge commit，history 比 squash 長；換來的是 main 不會因為 manifest 變紅。
- 長期可以讓 manifest 的計數不受 merge method 影響（例如只看 main 的 first-parent 歷史）。做到之後，這條要求和 playbook 的對應規則都可以拿掉。
