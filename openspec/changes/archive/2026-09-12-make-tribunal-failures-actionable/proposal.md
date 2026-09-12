## Why

部署中的 Tribunal 對 GP 強制禁止自動改寫，但有效 judge FAIL 仍會被 quota loop 重複派送，直到五次 top-level attempt 後誤標為 `EXHAUSTED`。同一份 reader-visible 內容沒有任何合法修復動作卻反覆評分，既浪費 quota，也把「需要人工判斷」混成「重試次數耗盡」。

## What Changes

- 對 policy 明確禁止自動修復的有效 GP judge FAIL，原子地寫入 current-version `NEEDS_REVIEW`、failed stage、穩定 reader revision 與 machine-readable reason；不增加 top-level attempt。
- current-version `NEEDS_REVIEW` 且 reader revision 未變時，manual runner、quota loop 與 bounded batch runner 均不再次呼叫 judge。
- reader-visible 內容變更、Tribunal contract version 變更，或 operator 明確 requeue 時才重新開案；requeue 本身不偽造內容變更或 PASS。
- publisher 與 status/monitoring surface 明確呈現 `NEEDS_REVIEW`；publisher 同時補上缺少的 Tribunal version 判定，只發布 current-version `PASS`。
- quota、timeout、runner error、malformed score 與其他 operational failure 維持原有可恢復語意；非 GP bounded rewrite/retry 不變。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `tribunal-24-7-operations`: 新增「沒有合法自動修復動作的內容 FAIL 必須進入 revision-bound `NEEDS_REVIEW`」之終態、requeue、scheduler 與可觀測性契約。

## Impact

- 影響 legacy canonical runtime：`scripts/tribunal.sh`、`scripts/tribunal-quota-loop.sh`、`scripts/tribunal-batch-runner.sh`、`scripts/tribunal-publisher.sh` 與監控輸出。
- 重用 `scripts/reader-revision-of-stdin.mjs` 的 reader-visible canonical hash，並以 pre-judge／pre-terminal compare 防止執行中內容漂移；不新增外部服務、資料庫或跨 provider fingerprint protocol。
- progress ledger 新增向後相容欄位與 exit code `3`；舊資料仍可讀，Tribunal version bump 仍能依現有機制重開。
- 新增 deterministic shell regressions，覆蓋單次 GP FAIL、同內容跳過、內容變更、明確 requeue、operational failure、non-GP 與 publisher fail-closed。
