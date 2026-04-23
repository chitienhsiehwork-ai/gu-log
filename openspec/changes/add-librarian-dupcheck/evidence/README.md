# Evidence — add-librarian-dupcheck

佐證當前 dedup judge 品質還不夠當 block gate 的數據。

## 檔案說明

### `dedup-eval-20260421-205735.md`

2026-04-21 跑 `dedup-eval-harness`（見 `openspec/specs/dedup-eval-harness/`）
對 5 筆 fixture 的評測結果：

- **Overall accuracy**: 80%（4/5）
- **hard-dup**: precision 1.00 / recall 1.00 ✓
- **soft-dup**: precision n/a / **recall 0.00** ✗ ← 關鍵問題
- **intentional-series**: precision 1.00 / recall 1.00 ✓
- **clean-diff**: precision 0.67 / recall 1.00（有 1 篇誤判為 clean-diff）

### 為什麼這份報告決定先 revert dupCheck gate

看 confusion matrix：`soft-dup` 類的那筆 fixture（`cp-275-20260410-artificialanlys-gemma-4-google-token`）被判成 `clean-diff action=allow`。也就是說**如果 pipeline 把 dupCheck 當 block gate，soft-dup 類的文章會全部滑過去（0% recall）**，失去了這個 gate 原本的價值。

同時 clean-diff 類 precision 67% 意味著有 33% 機會誤殺合法文章。用一個「該抓的抓不到、不該擋的亂擋」的 judge 當 gate，比沒 gate 還糟。

所以在 `feat/tribunal-v2-daemon` PR 裡一併 revert 了 pipeline.ts 的
dupCheck-only FAIL 分支，等 judge 品質拉到 precision + recall 都 ≥ 90%
再開回去。歷史測試程式碼在 `git ref 29a8553e:tests/tribunal-v2/pipeline.test.ts`
可撿回。

## Provenance

本來住在 `scores/dedup-eval-20260421-205735.md`（位置容易跟 tribunal
runtime 分數混淆）。移到本 change 的 evidence/ 目錄，跟 proposal 的
decision 放一起。
