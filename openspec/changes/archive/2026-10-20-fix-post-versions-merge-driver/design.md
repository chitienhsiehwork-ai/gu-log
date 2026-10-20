# Design

## 合併進來的 head 由 driver 自己交給 generator

Git 呼叫 merge driver 時還在算合併結果：`MERGE_HEAD` 還沒寫（實測 `.git/` 裡只有 `ORIG_HEAD` 和 `index.lock`），其他合併好的檔案也還沒寫進工作目錄。所以 generator 不能靠看 `MERGE_HEAD` 判斷「現在在合併」。

`git merge` 會替每個合併進來的 head 匯出 `GITHEAD_<oid>=<name>` 環境變數。Driver 從這裡抓 oid，用 `POST_VERSIONS_MERGE_HEADS` 傳給 generator。沒有這個變數時（例如手動 `git merge --no-commit` 之後再跑 script），照舊看 `MERGE_HEAD`。

## 文章路徑從 git tree 算

合併中時，文章路徑取各 tip 的 `git ls-tree` 聯集，扣掉相對 merge-base（`git merge-base --octopus`）在任一邊不見的路徑，這樣刪除和改名移走的檔案都會被扣掉。沒有共同祖先時就不扣。合併 commit 的 pre-commit（`--include-staged`）改用 `git ls-files`，因為那時 index 就是使用者解完衝突的結果，包含他自己 staged 的改名。

## Shallow clone：明確宣告才跳過

Vercel 拿不到完整 history，只能沿用 committed 檔案，所以用 `VERCEL` 辨識。GitHub Actions 的 `Build` job 也是 shallow checkout，但 freshness 已經由 full-history 的 unit test 擋，所以在 workflow 用 `POST_VERSIONS_ALLOW_SHALLOW=1` 明確 opt-in。其他情況一律 exit 1，並提示 `git fetch --unshallow origin`。

## 取捨

- `git rebase`／`cherry-pick` 不會匯出 `GITHEAD_*`，driver 在這些情境還是只看 `HEAD`。gu-log 的 worker 都用 merge 同步 main，先不處理。
- 本機在 shallow clone 跑 `pnpm build` 現在會失敗，要先 unshallow。比起安靜地用過時的版本號，這樣比較安全。
