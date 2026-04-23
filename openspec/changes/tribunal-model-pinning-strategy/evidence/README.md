# Evidence — tribunal-model-pinning-strategy

佐證 Opus 4.7 在翻譯 / scoring 上劣化的原始檔，支撐 `proposal.md` 的 claim。

## 檔案說明

### Ralph Loop 執行紀錄

- `ralph-sp175.log` — SP-175（Anthropic Opus 4.7 Prompting Best Practices）第一次 tribunal 跑分紀錄
- `ralph-sp175-v2.log` — SP-175 重跑紀錄
- `ralph-sp176.log` — SP-176 跑分紀錄（對照組：4.6 翻譯，tribunal 通過）

### SP-175 rewrite/rescore 四輪實驗

`sp-175-rewrite-rescore/`：

- `log-N.txt` — 第 N 輪 rewrite 過程 log（writer + scorer output）
- `score-N.json` — 第 N 輪 vibe judge 的結構化評分

關鍵發現：4.6 scorer 對 4.7 寫的版本判 composite 7（FAIL）；同版本的
4.7 scorer 判 composite 8（PASS）。同一篇文章、同一 rubric、分數差一
整級 — 這是「4.7 scorer 對自己寫法放水」的校準案例。

### CP-85 sanity check

`cp-85-4-7-sanity/cp-85_4-7.json` — CP-85 用 4.7 vibe scorer 跑出來的
評分。當時打 10/9/...（全站最高之一）但人工檢視覺得文章沒那麼好，跟
其他 4.6 scorer 跑的高分文章不同調 — 再次佐證 4.7 scorer 給分偏高。

## Provenance

這些檔本來住在 repo root 的 `.results/`（gitignored），屬於本地實驗
輸出。為了讓 proposal 的 claim 有可追佐證，移到本 change 的 evidence/
目錄，納入版本控管。

Timestamps 可從檔案內容看：SP-175 相關實驗在 2026-04-21/22，CP-85
sanity 日期見 JSON 內的 `timestamp` 欄位。
