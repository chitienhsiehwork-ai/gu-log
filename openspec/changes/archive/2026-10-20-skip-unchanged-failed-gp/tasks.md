## 1. 實作

- [x] 1.1 `tribunal-helpers.sh` 新增 `tribunal_reader_input_fingerprint` 與 `tribunal_failed_input_unchanged`。
- [x] 1.2 `tribunal.sh` 在 GP 沒過關時把指紋寫進 `FAILED` 項目；非 GP 失敗清掉指紋。
- [x] 1.2a `init_article_progress` 在指紋改變時把嘗試次數與 stages 歸零。
- [x] 1.3 `tribunal-quota-loop.sh` 與 `tribunal-batch-runner.sh` 的選文邏輯跳過指紋未變的 `FAILED` 項目。
- [x] 1.4 `tests/tribunal-gp-score-only.test.ts` 覆蓋指紋寫入、內容未變時跳過、zh-tw／English 修改後重新選取、沒有指紋時照常選取、修改後嘗試次數歸零。
- [x] 1.5 `docs/tribunal-runbook.md` 補上 exit code 1 對 GP 的例外。

## 2. Archive

- [x] 2.1 把 delta 同步進 `openspec/specs/gp-source-preservation/`，change 移到 archive；同一個 PR 一起 commit。
