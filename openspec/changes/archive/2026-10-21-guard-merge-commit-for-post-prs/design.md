# Design

## 只有動到文章的 PR 改用 merge commit

會出事的只有 `post-versions.json` 的計數：它數的是碰過每篇文章的非 merge commit。沒動到文章的 PR（glossary、低風險 code）squash 不影響計數，所以維持原本的 squash，變動範圍只限出過事的那一類 PR。

## 沿用 `HAS_POST_CHANGE`

Guard 原本就用 `HAS_POST_CHANGE` 判斷 PR 有沒有動到 `src/content/posts/` 下的文章（決定 `post-versions.json` 能不能放行）。能被 guard 放行的文章路徑只有這一層的 `.mdx`，巢狀路徑會被 allowlist 擋掉，所以「被放行而且動到文章」跟 `HAS_POST_CHANGE=1` 是同一件事，不用另寫判斷。

## 明確傳旗標，不靠 repo 預設

Repo 同時允許 merge commit 與 squash。Guard 直接傳 `--merge` 或 `--squash`，不依賴 GitHub 的預設 merge method，設定被改也不會默默變回 squash。

## 測試

`scripts/tests/test-auto-merge-guard.sh` 用假的 `gh` 錄下 guard 實際傳出的參數，驗證文章 PR 用 `--merge`、沒動到文章的 PR 用 `--squash`、被拒的 PR 不會呼叫 `gh pr merge`。CI 的 unit-tests job 透過 `tests/shell-regression-ownership.test.ts` 執行這支測試。

## 取捨

- 合併後 main 上會多一個 merge commit，history 比 squash 長；換來的是 main 不會因為 manifest 變紅。
- 長期可以讓 manifest 的計數不受 merge method 影響（例如只看 main 的 first-parent 歷史）。做到之後，這條要求和 playbook 的對應規則都可以拿掉。
