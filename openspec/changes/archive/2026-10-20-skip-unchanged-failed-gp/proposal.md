## Why

Tribunal 對 GP 只評分、不改寫（`gp-source-preservation`），所以 GP 沒過關之後，兩輪之間沒有任何動作會改變評審看到的內容。可是 daemon 的選文邏輯只跳過 `PASS` 與 `EXHAUSTED`，同一份沒改過的 GP 會被一再領回去重評，直到撞上 5 次上限變成 `EXHAUSTED`。#1098 的實際紀錄顯示兩種浪費：判決穩定時，同樣的缺陷被付費判五次；判決不穩定時，重擲骰子可能把缺陷洗成 PASS（GP-256、GP-251）。

## What Changes

- GP 沒過關時，`scripts/tribunal.sh` 在進度紀錄的 `FAILED` 項目寫下這次評審的讀者可見輸入指紋（zh-tw 與 English 檔的 reader revision，沿用 `scripts/reader-revision-of-stdin.mjs`，分數寫回不算變更）。
- `tribunal-quota-loop.sh` 與 `tribunal-batch-runner.sh` 的選文邏輯，遇到指紋仍相同的 `FAILED` 項目就跳過。內容改了、Tribunal 版本變了，或操作者手動對該篇跑 `tribunal.sh`，才會再評。
- 被修改過的 GP 再次進場時，`tribunal.sh` 把嘗試次數與各評審結果歸零，修好的內容從頭評，不會因為舊內容累積的次數直接變成 `EXHAUSTED`。
- 指紋算不出來時照舊選文（fail open），不會讓文章卡住。
- 非 GP 的有界改寫與重試不變：非 GP 失敗不寫指紋，既有欄位也會被清掉。
- 不新增狀態名稱：仍是 `FAILED`，publisher、監控與告警的分類都不用改。

## Capabilities

### Modified Capabilities
- `gp-source-preservation`：新增「沒改過的未過關 GP 不重評」要求。

## Impact

- 程式：`scripts/tribunal.sh`、`scripts/tribunal-helpers.sh`、`scripts/tribunal-quota-loop.sh`、`scripts/tribunal-batch-runner.sh`。
- 測試：`tests/tribunal-gp-score-only.test.ts`。
- 文件：`docs/tribunal-runbook.md` 的 exit code 說明。
- 關閉 #1098。#1099（FactChecker 來源 packet）落地後，來源 packet 的 hash 也應納入指紋。
